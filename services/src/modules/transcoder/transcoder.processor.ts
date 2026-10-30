import {
  Injectable,
  Logger,
  OnModuleInit,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TranscoderService } from './transcoder.service';

@Injectable()
export class TranscoderProcessor
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TranscoderProcessor.name);

  constructor(private readonly transcoderService: TranscoderService) {}

  onModuleInit(): void {
    const role = process.env.APP_ROLE || 'monolith';
    this.logger.log(`TranscoderProcessor initialized with APP_ROLE=${role}.`);
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    await this.transcoderService.shutdown(signal);
  }

  /**
   * Periodic queue polling worker to process pending transcoding jobs.
   * Active only when APP_ROLE is 'worker' or 'monolith'. Concurrency is bounded to 1.
   */
  @Interval(4000)
  async handleQueuePolling(): Promise<void> {
    const role = process.env.APP_ROLE || 'monolith';
    if (role === 'api') {
      return;
    }

    try {
      await this.transcoderService.processNextJob();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Transcoder worker polling error: ${msg}`);
    }
  }

  /**
   * Periodic background sweeper to reconcile stale dispatches, stranded uploads, and expired worker leases.
   * Active only when APP_ROLE is 'worker' or 'monolith'.
   */
  @Interval(60000)
  async handleRecoverySweeper(): Promise<void> {
    const role = process.env.APP_ROLE || 'monolith';
    if (role === 'api') {
      return;
    }

    try {
      await this.transcoderService.recoverStuckJobs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Transcoder recovery sweeper error: ${msg}`);
    }
  }
}
