import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { PlayerSettingsService } from './player-settings.service';
import { PlayerSettingsController } from './player-settings.controller';

@Module({
  imports: [DatabaseModule, StorageModule, ApiKeyModule],
  controllers: [PlayerSettingsController],
  providers: [PlayerSettingsService],
  exports: [PlayerSettingsService],
})
export class PlayerSettingsModule {}
