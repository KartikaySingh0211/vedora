import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TranscoderService } from './transcoder.service';

@Injectable()
export class TranscoderProcessor implements OnModuleInit {
  private readonly logger = new Logger(TranscoderProcessor.name);

  constructor(private readonly transcoderService: TranscoderService) {}

  onModuleInit(): void {
    this.logger.log('TranscoderProcessor background worker initialized.');
  }

  /**
   * Periodic queue polling worker to process pending transcoding jobs.
   */
  @Interval(4000)
  async handleQueuePolling(): Promise<void> {
    try {
      await this.transcoderService.processNextJob();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Transcoder worker polling error: ${msg}`);
    }
  }
}
