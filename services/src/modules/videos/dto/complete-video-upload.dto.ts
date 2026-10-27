import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  IsOptional,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompletedPartDto {
  @ApiProperty({
    description: '1-indexed sequential part number of the uploaded chunk',
    example: 1,
    minimum: 1,
  })
  @IsInt()
  PartNumber: number;

  @ApiProperty({
    description:
      'ETag identifier returned by storage upon completing this chunk upload',
    example: '"mock-etag-1-1730000000000"',
  })
  @IsString()
  ETag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({
    description:
      'UUIDv4 identifier of the video returned during initialization',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'videoId must be a valid UUID' })
  @IsNotEmpty()
  videoId: string;

  @ApiProperty({
    description: 'Storage object key assigned during initialization',
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4',
  })
  @IsString()
  @IsNotEmpty()
  storageKey: string;

  @ApiProperty({
    description:
      'Total video duration in seconds detected by client file reader',
    example: 120,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Duration must be a non-negative integer' })
  duration: number;

  @ApiPropertyOptional({
    description:
      'Cloud storage multipart upload ID if using S3/OneMinuteCloud provider',
    example: 'upload_session_abc123',
  })
  @IsOptional()
  @IsString()
  uploadId?: string;

  @ApiPropertyOptional({
    description: 'List of completed part numbers and corresponding ETags',
    type: [CompletedPartDto],
  })
  @IsOptional()
  @IsArray()
  parts?: CompletedPartDto[];
}
