import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { RedisModule } from '../../infra/redis/redis.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { TranscoderService } from './transcoder.service';
import { TranscoderController } from './transcoder.controller';
import { TranscoderProcessor } from './transcoder.processor';

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule, ApiKeyModule],
  controllers: [TranscoderController],
  providers: [TranscoderService, TranscoderProcessor],
  exports: [TranscoderService],
})
export class TranscoderModule {}
