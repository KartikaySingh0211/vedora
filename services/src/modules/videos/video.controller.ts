import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import { UploadVideoGuard } from '../../guards/upload-video.guard';
import type { UploadVideoRequest } from '../../guards/upload-video.guard';
import {
  VideoService,
  VideoResponse,
  VideoInitResponse,
} from './video.service';
import { CreateVideoInitDto } from './dto/create-video-init.dto';
import { CompleteVideoUploadDto } from './dto/complete-video-upload.dto';

@Controller('videos')
@UseGuards(DualAuthGuard)
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  /**
   * POST /api/v1/videos/init
   * Initialize and authorize a direct-to-cloud upload with quota enforcement
   */
  @Post('init')
  @UseGuards(UploadVideoGuard)
  @HttpCode(HttpStatus.CREATED)
  async initVideo(
    @CurrentUser('id') userId: string,
    @Req() req: UploadVideoRequest,
    @Body() dto: CreateVideoInitDto,
  ): Promise<VideoInitResponse> {
    const userPlan = req.userPlan || 'free';
    return await this.videoService.initVideo(userId, userPlan, dto);
  }

  /**
   * POST /api/v1/videos/complete
   * Confirm completion of direct-to-cloud upload
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async completeVideo(
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<VideoResponse> {
    return await this.videoService.completeVideo(userId, dto);
  }

  /**
   * GET /api/v1/videos
   * List videos for authenticated user with optional playlist filtering
   */
  @Get()
  async listVideos(
    @CurrentUser('id') userId: string,
    @Query('playlistId') playlistId?: string,
  ): Promise<VideoResponse[]> {
    return await this.videoService.listVideos(userId, playlistId);
  }

  /**
   * GET /api/v1/videos/:id
   * Fetch video details for authenticated owner
   */
  @Get(':id')
  async getVideo(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) videoId: string,
  ): Promise<VideoResponse> {
    return await this.videoService.getVideo(userId, videoId);
  }

  /**
   * DELETE /api/v1/videos/:id
   * Delete video, release storage quota, and update playlist counts
   */
  @Delete(':id')
  async deleteVideo(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) videoId: string,
  ): Promise<{ success: boolean; id: string }> {
    return await this.videoService.deleteVideo(userId, videoId);
  }
}
