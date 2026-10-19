import { Module } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyActivityService } from './api-key-activity.service';
import { DualAuthGuard } from '../../guards/dual-auth.guard';

@Module({
  controllers: [ApiKeyController],
  providers: [
    ApiKeyService,
    ApiKeyCacheService,
    ApiKeyActivityService,
    DualAuthGuard,
  ],
  exports: [ApiKeyService, ApiKeyCacheService, DualAuthGuard],
})
export class ApiKeyModule {}
