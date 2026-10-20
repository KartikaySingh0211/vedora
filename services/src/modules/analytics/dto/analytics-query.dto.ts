import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d'], {
    message: 'window must be one of: 7d, 30d, 90d',
  })
  window?: '7d' | '30d' | '90d' = '30d';

  @IsOptional()
  @IsUUID('4', { message: 'videoId must be a valid UUIDv4' })
  videoId?: string;
}
