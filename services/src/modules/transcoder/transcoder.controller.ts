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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TranscoderService } from './transcoder.service';
import { TranscoderWebhookDto } from './dto/transcoder-webhook.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';

@ApiTags('Transcoder')
@Controller('transcoder')
export class TranscoderController {
  constructor(private readonly transcoderService: TranscoderService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook endpoint for external cloud transcoders' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleWebhook(
    @Headers('x-transcoder-signature') signature: string | undefined,
    @Body() dto: TranscoderWebhookDto,
  ): Promise<{ success: boolean; message: string }> {
    const rawPayload = JSON.stringify(dto);
    return await this.transcoderService.handleWebhook(
      signature,
      rawPayload,
      dto,
    );
  }

  @Post('process/:videoId')
  @UseGuards(DualAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger transcoding for an uploaded video' })
  async triggerProcessing(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ status: string; videoId: string }> {
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
