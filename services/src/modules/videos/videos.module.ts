import { Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { UploadVideoGuard } from '../../guards/upload-video.guard';

@Module({
  imports: [DatabaseModule, StorageModule, ApiKeyModule],
  controllers: [VideoController],
  providers: [VideoService, UploadVideoGuard],
  exports: [VideoService],
})
export class VideosModule {}
