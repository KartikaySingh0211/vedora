/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { BillingService } from './billing.service';
import { DRIZZLE_DB } from '../../database/database.module';

describe('BillingService', () => {
  let service: BillingService;
  let mockDb: any;
  let mockConfigService: any;

  const testSecret = 'stripe_test_secret_key_32chars_len!';

  const mockSub = {
    id: 'sub-1',
    user_id: 'user_1',
    stripe_customer_id: 'cus_123',
    stripe_subscription_id: 'sub_123',
    plan: 'pro',
    status: 'active',
    allocated_minutes: 22000,
    used_minutes: 4500,
    current_period_start: new Date(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mockSub]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockSub]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultVal?: any) => {
        if (
          key === 'billing.stripeWebhookSecret' ||
          key === 'apiKeyDigestSecret'
        ) {
          return testSecret;
        }
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSubscription', () => {
    it('should return subscription details with allocated, used, and remaining minutes', async () => {
      const res = await service.getSubscription('user_1');
      expect(res.plan).toBe('pro');
      expect(res.allocatedMinutes).toBe(22000);
      expect(res.usedMinutes).toBe(4500);
      expect(res.remainingMinutes).toBe(17500);
      expect(res.usagePercent).toBe(20);
    });

    it('should create default Free tier with 1,000 minutes if none exists', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no subscription found
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'sub-new',
          user_id: 'user_new',
          plan: 'free',
          status: 'active',
          allocated_minutes: 1000,
          used_minutes: 0,
        },
      ]);

      const res = await service.getSubscription('user_new');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(res.plan).toBe('free');
      expect(res.allocatedMinutes).toBe(1000);
      expect(res.usedMinutes).toBe(0);
      expect(res.remainingMinutes).toBe(1000);
    });
  });

  describe('handleStripeWebhook', () => {
    const payload = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_stripe_1',
          customer: 'cus_123',
          status: 'active',
          metadata: { plan: 'pro', userId: 'user_1' },
          current_period_start: 1700000000,
          current_period_end: 1702592000,
        },
      },
    };
    const rawPayload = JSON.stringify(payload);

    function createValidSig(raw: string): string {
      return crypto.createHmac('sha256', testSecret).update(raw).digest('hex');
    }

    it('should reject webhooks with missing or invalid signature', async () => {
      await expect(
        service.handleStripeWebhook(undefined, rawPayload, payload),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.handleStripeWebhook('invalid_sig', rawPayload, payload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should process customer.subscription.updated and update plan entitlements', async () => {
      const sig = createValidSig(rawPayload);
      const res = await service.handleStripeWebhook(sig, rawPayload, payload);

      expect(res.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'pro',
          allocated_minutes: 22000,
        }),
      );
    });

    it('should downgrade on customer.subscription.deleted to free tier', async () => {
      const deletePayload = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            customer: 'cus_123',
          },
        },
      };
      const rawDel = JSON.stringify(deletePayload);
      const sig = createValidSig(rawDel);

      const res = await service.handleStripeWebhook(sig, rawDel, deletePayload);
      expect(res.success).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          status: 'canceled',
          allocated_minutes: 1000,
        }),
      );
    });

    it('should reset used_minutes to 0 on invoice.paid', async () => {
      const invoicePayload = {
        type: 'invoice.paid',
        data: {
          object: {
            customer: 'cus_123',
          },
        },
      };
      const rawInv = JSON.stringify(invoicePayload);
      const sig = createValidSig(rawInv);

      const res = await service.handleStripeWebhook(
        sig,
        rawInv,
        invoicePayload,
      );
      expect(res.success).toBe(true);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          used_minutes: 0,
        }),
      );
    });
  });

  describe('resetMonthlyUsage', () => {
    it('should reset used_minutes to 0 across subscriptions', async () => {
      mockDb.returning.mockResolvedValueOnce([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);
      const count = await service.resetMonthlyUsage();
      expect(count).toBe(2);
      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({ used_minutes: 0 }),
      );
    });
  });
});
