import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingService } from './billing.service';

@Injectable()
export class BillingCycleCron {
  private readonly logger = new Logger(BillingCycleCron.name);

  constructor(private readonly billingService: BillingService) {}

  /**
   * Midnight UTC on the 1st of each month:
   * Reconciles completed period and resets playback-minute usage for active subscriptions.
   * Storage is explicitly preserved.
   */
  @Cron('0 0 1 * *', { timeZone: 'UTC' })
  async handleMonthlyBillingReset(): Promise<void> {
    this.logger.log('Running monthly billing reset cron worker...');
    try {
      const resetCount = await this.billingService.resetMonthlyUsage();
      this.logger.log(
        `Billing reset successfully processed for ${resetCount} accounts.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Monthly billing cycle reset failed: ${msg}`);
    }
  }
}
