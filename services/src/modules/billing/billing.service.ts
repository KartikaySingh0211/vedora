import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import * as crypto from 'crypto';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { PLAN_LIMITS, UserPlan } from '../../config/plans.config';
import { BillingWebhookDto } from './dto/billing-webhook.dto';

export interface SubscriptionResponse {
  id: string;
  userId: string;
  plan: string;
  displayName: string;
  status: string;
  allocatedMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  usagePercent: number;
  storageCapBytes: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null = null;
  private readonly webhookSecret: string;

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
    private readonly configService: ConfigService,
  ) {
    const stripeKey = this.configService.get<string>('billing.stripeSecretKey');
    if (stripeKey && !stripeKey.includes('placeholder')) {
      this.stripe = new Stripe(stripeKey);
    }

    this.webhookSecret =
      this.configService.get<string>('billing.stripeWebhookSecret') ||
      this.configService.get<string>('apiKeyDigestSecret') ||
      'vedora_stripe_default_webhook_secret_32b';
  }

  /**
   * Get subscription details for authenticated user, creating default Free tier if none exists.
   */
  async getSubscription(userId: string): Promise<SubscriptionResponse> {
    let [sub] = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.user_id, userId))
      .limit(1);

    if (!sub) {
      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const [created] = await this.db
        .insert(schema.subscriptions)
        .values({
          user_id: userId,
          plan: 'free',
          status: 'active',
          allocated_minutes: PLAN_LIMITS.free.allocatedPlaybackMinutes,
          used_minutes: 0,
          current_period_start: now,
          current_period_end: nextMonth,
        })
        .returning();
      sub = created;
    }

    const planKey = (
      sub.plan.toLowerCase() in PLAN_LIMITS ? sub.plan.toLowerCase() : 'free'
    ) as UserPlan;
    const planConfig = PLAN_LIMITS[planKey];

    const allocated =
      sub.allocated_minutes || planConfig.allocatedPlaybackMinutes;
    const used = sub.used_minutes || 0;
    const remaining = Math.max(0, allocated - used);
    const usagePercent =
      allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0;

    return {
      id: sub.id,
      userId: sub.user_id,
      plan: planKey,
      displayName: planConfig.displayName,
      status: sub.status,
      allocatedMinutes: allocated,
      usedMinutes: used,
      remainingMinutes: remaining,
      usagePercent,
      storageCapBytes: planConfig.storageCapBytes.toString(),
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
    };
  }

  /**
   * Process Stripe webhooks idempotently with signature verification.
   */
  async handleStripeWebhook(
    signature: string | undefined,
    rawBody: string | Buffer,
    payload: BillingWebhookDto,
  ): Promise<{ success: boolean; event: string }> {
    // 1. Verify webhook signature
    this.verifyWebhookSignature(signature, rawBody);

    const eventType = payload.type;
    const dataObj = payload.data?.object || {};

    this.logger.log(`Processing billing webhook event: ${eventType}`);

    switch (eventType) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await this.syncSubscription(dataObj);
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = dataObj.customer as string;
        if (customerId) {
          await this.db
            .update(schema.subscriptions)
            .set({
              plan: 'free',
              status: 'canceled',
              allocated_minutes: PLAN_LIMITS.free.allocatedPlaybackMinutes,
              updated_at: new Date(),
            })
            .where(eq(schema.subscriptions.stripe_customer_id, customerId));
        }
        break;
      }

      case 'invoice.paid': {
        // Reset playback minutes upon monthly renewal invoice
        const customerId = dataObj.customer as string;
        if (customerId) {
          await this.db
            .update(schema.subscriptions)
            .set({
              used_minutes: 0,
              updated_at: new Date(),
            })
            .where(eq(schema.subscriptions.stripe_customer_id, customerId));
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled billing webhook event type: ${eventType}`);
        break;
    }

    return { success: true, event: eventType };
  }

  /**
   * Synchronize subscription data from Stripe subscription object into database.
   */
  private async syncSubscription(
    dataObj: Record<string, unknown>,
  ): Promise<void> {
    const customerId =
      typeof dataObj.customer === 'string' ? dataObj.customer : null;
    const subscriptionId = typeof dataObj.id === 'string' ? dataObj.id : null;
    const status =
      typeof dataObj.status === 'string' ? dataObj.status : 'active';
    const metadata =
      typeof dataObj.metadata === 'object' && dataObj.metadata !== null
        ? (dataObj.metadata as Record<string, string>)
        : {};

    // Map plan identifier from metadata or items
    let plan: UserPlan = 'free';
    const planName = (
      metadata.plan ||
      metadata.vedora_plan ||
      ''
    ).toLowerCase();
    if (planName in PLAN_LIMITS) {
      plan = planName as UserPlan;
    } else {
      // Check price nickname/lookup_key
      const itemsObj = dataObj.items as
        { data?: Array<{ price?: { lookup_key?: string } }> } | undefined;
      const priceId = itemsObj?.data?.[0]?.price?.lookup_key || '';
      if (/business/i.test(priceId)) plan = 'business';
      else if (/pro/i.test(priceId)) plan = 'pro';
      else if (/starter/i.test(priceId)) plan = 'starter';
    }

    const startTs =
      typeof dataObj.current_period_start === 'number'
        ? dataObj.current_period_start
        : null;
    const endTs =
      typeof dataObj.current_period_end === 'number'
        ? dataObj.current_period_end
        : null;

    const currentPeriodStart = startTs ? new Date(startTs * 1000) : new Date();
    const currentPeriodEnd = endTs ? new Date(endTs * 1000) : null;

    const allocatedMinutes = PLAN_LIMITS[plan].allocatedPlaybackMinutes;

    // Find subscription by customerId or metadata.userId
    const userId = metadata.userId || metadata.user_id;

    if (customerId) {
      const [existing] = await this.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.stripe_customer_id, customerId))
        .limit(1);

      if (existing) {
        await this.db
          .update(schema.subscriptions)
          .set({
            plan,
            status,
            stripe_subscription_id: subscriptionId,
            allocated_minutes: allocatedMinutes,
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            updated_at: new Date(),
          })
          .where(eq(schema.subscriptions.id, existing.id));
        return;
      }
    }

    if (userId) {
      const [existingUserSub] = await this.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.user_id, userId))
        .limit(1);

      if (existingUserSub) {
        await this.db
          .update(schema.subscriptions)
          .set({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            status,
            allocated_minutes: allocatedMinutes,
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            updated_at: new Date(),
          })
          .where(eq(schema.subscriptions.user_id, userId));
      } else {
        await this.db.insert(schema.subscriptions).values({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          plan,
          status,
          allocated_minutes: allocatedMinutes,
          used_minutes: 0,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
        });
      }
    }
  }

  /**
   * Reset playback minutes for active subscriptions on monthly billing cycle.
   * Storage is explicitly preserved!
   */
  async resetMonthlyUsage(): Promise<number> {
    this.logger.log('Executing monthly playback minutes reset...');

    // Reset used_minutes = 0 across all subscriptions
    const res = await this.db
      .update(schema.subscriptions)
      .set({
        used_minutes: 0,
        updated_at: new Date(),
      })
      .returning({ id: schema.subscriptions.id });

    this.logger.log(
      `Monthly reset complete. Reset usage for ${res.length} subscriptions.`,
    );
    return res.length;
  }

  /**
   * Verify signature using Stripe SDK or HMAC timingSafeEqual.
   */
  verifyWebhookSignature(
    signatureHeader: string | undefined,
    rawPayload: string | Buffer,
  ): void {
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing stripe-signature header');
    }

    if (this.stripe && Buffer.isBuffer(rawPayload)) {
      try {
        this.stripe.webhooks.constructEvent(
          rawPayload,
          signatureHeader,
          this.webhookSecret,
        );
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Stripe constructEvent failed: ${msg}`);
      }
    }

    // HMAC verification fallback
    const payloadStr = Buffer.isBuffer(rawPayload)
      ? rawPayload.toString('utf-8')
      : String(rawPayload);

    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadStr)
      .digest('hex');

    const cleanSig = signatureHeader
      .replace(/^t=\d+,v1=/, '')
      .replace(/^sha256=/, '');
    const bufA = Buffer.from(computed);
    const bufB = Buffer.from(cleanSig);

    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return;
    }

    // Also accept exact signature match if signed
    if (signatureHeader.includes(computed)) {
      return;
    }

    throw new UnauthorizedException('Invalid stripe webhook signature');
  }
}
