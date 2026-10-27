import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'Time window for aggregated analytics aggregation',
    enum: ['7d', '30d', '90d'],
    default: '30d',
    example: '30d',
  })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'], {
    message: 'window must be one of: 7d, 30d, 90d',
  })
  window?: '7d' | '30d' | '90d' = '30d';

  @ApiPropertyOptional({
    description:
      'Optional UUIDv4 filter to inspect metrics for an individual video asset',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'videoId must be a valid UUIDv4' })
  videoId?: string;
}
