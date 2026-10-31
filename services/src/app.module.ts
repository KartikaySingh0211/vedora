import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { PlaylistModule } from './modules/playlist/playlist.module';
import { StorageModule } from './infra/storage/storage.module';
import { VideosModule } from './modules/videos/videos.module';
import { TranscoderModule } from './modules/transcoder/transcoder.module';
import { PlayerSettingsModule } from './modules/player-settings/player-settings.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AppThrottlerGuard } from './guards/app-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 120,
      },
    ]),
    DatabaseModule,
    RedisModule,
    StorageModule,
    HealthModule,
    ApiKeyModule,
    PlaylistModule,
    VideosModule,
    TranscoderModule,
    PlayerSettingsModule,
    AnalyticsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
