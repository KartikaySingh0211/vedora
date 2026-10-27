import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { AnalyticsService, MetricsResult } from './analytics.service';
import { SegmentPingDto } from './dto/segment-ping.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import {
  MetricsResponseDto,
  SegmentPingResponseDto,
} from './dto/analytics-response.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('segment-ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public playback heartbeat ingestion',
    description:
      'Receives lightweight 10-second playback heartbeat pings from embedded video players. Buffers events into Redis for batch pipeline ingestion. Classifies client device, browser, and referrer automatically.',
  })
  @ApiHeader({
    name: 'user-agent',
    required: false,
    description:
      'Client browser user-agent header used for device classification',
    example:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  })
  @ApiHeader({
    name: 'referer',
    required: false,
    description: 'Originating webpage URL hosting the embedded video player',
    example: 'https://example.com/tutorials/intro',
  })
  @ApiHeader({
    name: 'cf-ipcountry',
    required: false,
    description: 'Cloudflare geographic two-letter country code',
    example: 'US',
  })
  @ApiOkResponse({
    description: 'Playback ping buffered or accepted',
    type: SegmentPingResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid ping payload structure or duration beyond server bounds',
    type: ValidationErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video record not found for videoId',
    type: ErrorResponseDto,
  })
  async ingestPing(
    @Body() dto: SegmentPingDto,
    @Headers('user-agent') userAgent: string,
    @Headers('referer') referer: string | undefined,
    @Headers('cf-ipcountry') cfCountry: string | undefined,
    @Ip() ip: string,
  ): Promise<{ acknowledged: boolean }> {
    return await this.analyticsService.ingestSegmentPing(
      dto,
      userAgent,
      ip,
      referer,
      cfCountry,
    );
  }

  @Get('metrics')
  @UseGuards(DualAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Get aggregated analytics metrics for authenticated user',
    description:
      'Calculates aggregated view counts, watch time minutes, audience device breakdown, browser share, daily view timeseries, and top performing videos.',
  })
  @ApiOkResponse({
    description: 'Aggregated analytics metrics returned successfully',
    type: MetricsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid time window or videoId query parameter',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async getMetrics(
    @CurrentUser('id') userId: string,
    @Query() query: AnalyticsQueryDto,
  ): Promise<MetricsResult> {
    return await this.analyticsService.getMetrics(userId, query);
  }
}
