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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
import {
  VideoInitResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import {
  ActionSuccessResponseDto,
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('Videos')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(DualAuthGuard)
@Controller('videos')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  /**
   * POST /api/v1/videos/init
   * Initialize and authorize a direct-to-cloud upload with quota enforcement
   */
  @Post('init')
  @UseGuards(UploadVideoGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initialize direct-to-cloud video upload',
    description:
      'Creates a pending video record, acquires an atomic PostgreSQL advisory quota lock, reserves storage allowance (raw size + estimated transcoding overhead), and returns multipart presigned upload URLs.',
  })
  @ApiCreatedResponse({
    description:
      'Video record created and upload session initialized with presigned part URLs',
    type: VideoInitResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed on video parameters or slug format',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description:
      'Video file size exceeds maximum single file ingestion limit',
    type: ErrorResponseDto,
  })
  async initVideo(
    @CurrentUser('id') userId: string,
    @Req() req: UploadVideoRequest,
    @Body() dto: CreateVideoInitDto,
  ): Promise<VideoInitResponse> {
    return await this.videoService.initVideo(userId, dto);
  }

  /**
   * POST /api/v1/videos/complete
   * Confirm completion of direct-to-cloud upload
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete video upload and trigger transcoding',
    description:
      'Completes multipart upload session, marks video status as "uploaded", and automatically enqueues background HLS transcoding job.',
  })
  @ApiOkResponse({
    description: 'Video upload confirmed and processing job queued',
    type: VideoResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid upload completion payload or missing parts',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video not found or not owned by authenticated user',
    type: ErrorResponseDto,
  })
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
  @ApiOperation({
    summary: 'List user videos',
    description:
      'Retrieves all video assets owned by the caller, optionally filtered by playlistId, sorted by creation date descending.',
  })
  @ApiQuery({
    name: 'playlistId',
    required: false,
    description: 'Optional playlist UUID filter',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  @ApiOkResponse({
    description: 'Array of video records',
    type: [VideoResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
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
  @ApiOperation({
    summary: 'Get video details by ID',
    description:
      'Fetches complete metadata, transcoding status, HLS master manifest key, and resolution outputs for a specific video.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the video',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'Video details found',
    type: VideoResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async getVideo(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) videoId: string,
  ): Promise<VideoResponse> {
    return await this.videoService.getVideo(userId, videoId);
  }

  /**
   * POST /api/v1/videos/:id/retry
   * Safely retries a failed video transcode job
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry failed video transcoding',
    description:
      'Resets attempt accounting and enqueues a fresh transcoding job for a video currently in terminal failed status.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the video to retry',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'Transcoding job re-enqueued successfully',
    type: VideoResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Video is not in failed status',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async retryTranscode(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) videoId: string,
  ): Promise<VideoResponse> {
    return await this.videoService.retryTranscode(videoId, userId);
  }

  /**
   * DELETE /api/v1/videos/:id
   * Delete video, release storage quota, and update playlist counts
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete video and release storage quota',
    description:
      'Deletes video record, purges raw and transcoded assets from cloud storage, releases reserved storage quota, and updates parent playlist video counter.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the video to delete',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiOkResponse({
    description: 'Video successfully deleted and storage quota released',
    type: ActionSuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async deleteVideo(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) videoId: string,
  ): Promise<{ success: boolean; id: string }> {
    return await this.videoService.deleteVideo(userId, videoId);
  }
}
