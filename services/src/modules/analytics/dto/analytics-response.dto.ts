import { ApiProperty } from '@nestjs/swagger';

export class SegmentPingResponseDto {
  @ApiProperty({
    description: 'Whether the playback heartbeat was buffered or persisted',
    example: true,
  })
  acknowledged: boolean;
}

export class DeviceBreakdownDto {
  @ApiProperty({
    description: 'Device type classification (desktop, mobile, tablet)',
    example: 'desktop',
  })
  name: string;

  @ApiProperty({
    description: 'Count or percentage of views from this device type',
    example: 65,
  })
  value: number;

  @ApiProperty({
    description: 'UI chart display color',
    example: '#3b82f6',
  })
  color: string;
}

export class BrowserBreakdownDto {
  @ApiProperty({
    description: 'Detected browser name (Chrome, Safari, Firefox, Edge, Other)',
    example: 'Chrome',
  })
  browser: string;

  @ApiProperty({
    description: 'Percentage share of playback sessions',
    example: 72.5,
  })
  share: number;
}

export class ViewsOverTimeDto {
  @ApiProperty({
    description: 'ISO-8601 day date (YYYY-MM-DD)',
    example: '2026-10-27',
  })
  date: string;

  @ApiProperty({
    description: 'Total video play views recorded on this date',
    example: 142,
  })
  views: number;
}

export class TopVideoMetricDto {
  @ApiProperty({
    description: 'Video UUID identifier',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({
    description: 'Video title',
    example: 'Vedora Direct Upload Tutorial',
  })
  title: string;

  @ApiProperty({
    description: 'Total aggregated views for this video in the query window',
    example: 850,
  })
  views: number;

  @ApiProperty({
    description: 'Total watch time consumed in minutes',
    example: 1250,
  })
  watchTimeMinutes: number;

  @ApiProperty({
    description: 'Average watch session duration in seconds',
    example: 88,
  })
  avgDurationSeconds: number;
}

export class CountryBreakdownDto {
  @ApiProperty({
    description: 'Two-letter ISO country code or country name',
    example: 'US',
  })
  country: string;

  @ApiProperty({
    description: 'Unique visitors count from this country',
    example: 45,
  })
  visitors: number;
}

export class TopReferrerDto {
  @ApiProperty({
    description: 'Originating domain or pathname where videos were requested',
    example: 'example.com/tutorials',
  })
  pathname: string;

  @ApiProperty({
    description: 'Total request count from this referrer',
    example: 120,
  })
  requests: number;
}

export class MetricsResponseDto {
  @ApiProperty({
    description: 'Total views across user videos in the requested time window',
    example: 1250,
  })
  totalViews: number;

  @ApiProperty({
    description: 'Total seconds watched across all sessions',
    example: 110000,
  })
  totalWatchTimeSeconds: number;

  @ApiProperty({
    description: 'Total minutes watched across all viewing sessions',
    example: 1833,
  })
  totalWatchTimeMinutes: number;

  @ApiProperty({
    description: 'Count of unique pseudonymous viewing sessions',
    example: 940,
  })
  uniqueViewers: number;

  @ApiProperty({
    description: 'Average watch duration per view in seconds',
    example: 88,
  })
  avgDurationSeconds: number;

  @ApiProperty({
    description: 'Audience breakdown by device category',
    type: [DeviceBreakdownDto],
  })
  deviceBreakdown: DeviceBreakdownDto[];

  @ApiProperty({
    description: 'Audience breakdown by browser client',
    type: [BrowserBreakdownDto],
  })
  browserBreakdown: BrowserBreakdownDto[];

  @ApiProperty({
    description: 'Daily timeseries views over the query window',
    type: [ViewsOverTimeDto],
  })
  viewsOverTime: ViewsOverTimeDto[];

  @ApiProperty({
    description: 'Top performing videos ranked by view count',
    type: [TopVideoMetricDto],
  })
  topVideos: TopVideoMetricDto[];

  @ApiProperty({
    description: 'Audience breakdown by geographic visitor country',
    type: [CountryBreakdownDto],
    required: false,
  })
  countryBreakdown?: CountryBreakdownDto[];

  @ApiProperty({
    description: 'Top requested domains or referrers',
    type: [TopReferrerDto],
    required: false,
  })
  topReferrers?: TopReferrerDto[];
}
