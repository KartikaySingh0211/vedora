import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiHeader,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { TranscoderService } from './transcoder.service';
import { TranscoderWebhookDto } from './dto/transcoder-webhook.dto';
import {
  TranscoderProcessResponseDto,
  TranscoderWebhookResponseDto,
} from './dto/transcoder-response.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('Transcoder')
@Controller('transcoder')
export class TranscoderController {
  constructor(private readonly transcoderService: TranscoderService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook endpoint for external cloud transcoders',
    description:
      'Receives job completion or failure callbacks from external transcoding workers. Verifies authenticity using HMAC-SHA256 signature in x-transcoder-signature header.',
  })
  @ApiHeader({
    name: 'x-transcoder-signature',
    required: true,
    description:
      'HMAC-SHA256 signature calculated over raw payload using transcoder secret',
    example: 'a6b28f1e948c2...39e',
  })
  @ApiOkResponse({
    description:
      'Webhook successfully verified and video status updated to ready or failed',
    type: TranscoderWebhookResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid webhook payload structure',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'HMAC signature missing or mismatch',
    type: ErrorResponseDto,
  })
  async handleWebhook(
    @Headers('x-transcoder-signature') signature: string | undefined,
    @Body() dto: TranscoderWebhookDto,
  ): Promise<TranscoderWebhookResponseDto> {
    const rawPayload = JSON.stringify(dto);
    return await this.transcoderService.handleWebhook(
      signature,
      rawPayload,
      dto,
    );
  }

  @Post('process/:videoId')
  @UseGuards(DualAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger manual transcoding for an uploaded video',
    description:
      'Submits an asynchronous HLS transcoding job to the BullMQ transcode queue for a previously uploaded video.',
  })
  @ApiParam({
    name: 'videoId',
    description: 'UUIDv4 identifier of the video to transcode',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @ApiAcceptedResponse({
    description: 'Transcoding job enqueued in background processing queue',
    type: TranscoderProcessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video record not found or not owned by user',
    type: ErrorResponseDto,
  })
  async triggerProcessing(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
    @CurrentUser('id') userId: string,
  ): Promise<TranscoderProcessResponseDto> {
    await this.transcoderService.enqueueTranscodeJob({
      videoId,
      userId,
      storageKey: `videos/${videoId}/raw.mp4`,
      resolutions: ['720p'],
      title: 'Manual Transcode',
      slug: 'manual-transcode',
    });

    return { status: 'enqueued', videoId };
  }
}
