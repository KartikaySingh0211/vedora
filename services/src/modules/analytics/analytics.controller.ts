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
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnalyticsService, MetricsResult } from './analytics.service';
import { SegmentPingDto } from './dto/segment-ping.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('segment-ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Public playback heartbeat ingestion' })
  @ApiResponse({ status: 200, description: 'Segment ping acknowledged' })
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
  @ApiOperation({
    summary: 'Get aggregated analytics metrics for authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Metrics returned successfully' })
  async getMetrics(
    @CurrentUser('id') userId: string,
    @Query() query: AnalyticsQueryDto,
  ): Promise<MetricsResult> {
    return await this.analyticsService.getMetrics(userId, query);
  }
}
