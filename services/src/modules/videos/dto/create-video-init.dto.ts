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

export class CreateVideoInitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Slug must contain only lowercase alphanumeric characters and hyphens (e.g. my-awesome-video)',
  })
  slug: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'File size must be a positive integer greater than 0' })
  size: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsIn(['720p', '1080p'], {
    each: true,
    message: 'Resolutions can only contain 720p or 1080p',
  })
  resolutions?: string[];

  @IsOptional()
  @IsUUID('4', { message: 'playlistId must be a valid UUID' })
  playlistId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  generateSubtitles?: boolean;

  @IsOptional()
  @IsBoolean()
  includeWatermark?: boolean;
}
