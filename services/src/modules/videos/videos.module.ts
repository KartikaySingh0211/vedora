import { forwardRef, Module } from '@nestjs/common';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../../infra/storage/storage.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { UploadVideoGuard } from '../../guards/upload-video.guard';
import { TranscoderModule } from '../transcoder/transcoder.module';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    ApiKeyModule,
    forwardRef(() => TranscoderModule),
  ],
  controllers: [VideoController],
  providers: [VideoService, UploadVideoGuard],
  exports: [VideoService],
})
export class VideosModule {}
