import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';

@Injectable()
export class AnalyticsProcessor implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  onModuleInit(): void {
    this.logger.log('AnalyticsProcessor buffer worker initialized.');
  }

  /**
   * Periodically drain Redis analytics buffer and batch-insert into PostgreSQL.
   */
  @Interval(5000)
  async handleBufferFlush(): Promise<void> {
    try {
      const flushedCount = await this.analyticsService.flushBuffer();
      if (flushedCount > 0) {
        this.logger.debug(
          `Flushed ${flushedCount} analytics events to PostgreSQL`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Error during analytics buffer flush: ${msg}`);
    }
  }
}
