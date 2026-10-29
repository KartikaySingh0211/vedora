import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  Matches,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVideoInitDto {
  @ApiProperty({
    description: 'Human-readable title of the video',
    example: 'Vedora Direct Upload Tutorial',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description:
      'URL-safe slug identifier containing only lowercase letters, numbers, and hyphens',
    example: 'vedora-direct-upload-tutorial',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Slug must contain only lowercase alphanumeric characters and hyphens (e.g. my-awesome-video)',
  })
  slug: string;

  @ApiProperty({
    description:
      'Raw source file size in bytes. Must be greater than 0 and within technical ingestion limits',
    example: 104857600,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'File size must be a positive integer greater than 0' })
  size: number;

  @ApiPropertyOptional({
    description: 'Estimated or known duration of the video in seconds',
    example: 120,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration?: number;

  @ApiPropertyOptional({
    description:
      'Requested maximum output HLS rendition resolution ceiling (360p, 480p, 720p, 1080p). Automatically generates full ladder up to this ceiling.',
    example: ['720p'],
    type: [String],
    enum: ['360p', '480p', '720p', '1080p'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['360p', '480p', '720p', '1080p'], {
    each: true,
    message: 'Resolutions can only contain 360p, 480p, 720p, or 1080p',
  })
  resolutions?: string[];

  @ApiPropertyOptional({
    description:
      'Optional UUID of an existing playlist owned by the user to associate this video with',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'playlistId must be a valid UUID' })
  playlistId?: string;

  @ApiPropertyOptional({
    description: 'Detailed description or notes about the video content',
    example:
      'In-depth demonstration of multipart upload pipeline and HLS transcode ladder',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Search and categorization tags',
    example: ['tutorial', 'streaming', 'hls'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Flag indicating whether subtitle track processing should be enabled',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  generateSubtitles?: boolean;

  @ApiPropertyOptional({
    description:
      'Whether the video playback player should display custom branding watermark',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  includeWatermark?: boolean;
}
