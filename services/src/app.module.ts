import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { ApiKeyModule } from './modules/api-key/api-key.module';
import { PlaylistModule } from './modules/playlist/playlist.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    HealthModule,
    ApiKeyModule,
    PlaylistModule,
  ],
})
export class AppModule {}
