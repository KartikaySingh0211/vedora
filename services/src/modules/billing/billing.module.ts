import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingCycleCron } from './billing-cycle.cron';

@Module({
  imports: [DatabaseModule, ApiKeyModule],
  controllers: [BillingController],
  providers: [BillingService, BillingCycleCron],
  exports: [BillingService],
})
export class BillingModule {}
