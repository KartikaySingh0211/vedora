import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TranscoderWebhookDto {
  @ApiProperty({
    description: 'UUIDv4 identifier of the video being transcoded',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'videoId must be a valid UUIDv4' })
  @IsNotEmpty()
  videoId: string;

  @ApiProperty({
    description: 'Cloud storage key for generated master HLS m3u8 playlist',
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/master.m3u8',
  })
  @IsString()
  @IsNotEmpty()
  masterKey: string;

  @ApiProperty({
    description: 'Total duration of transcoded media in seconds',
    example: 120,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  totalDuration: number;

  @ApiProperty({
    description: 'Array of generated resolution rendition keys or names',
    type: [String],
    example: ['720p', '1080p'],
  })
  @IsArray()
  @IsString({ each: true })
  renditions: string[];

  @ApiProperty({
    description:
      'Total combined storage size in bytes of all transcoded TS segments and manifests',
    example: 142606336,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  transcodedSize: number;

  @ApiProperty({
    description: 'Final status of transcoding job',
    enum: ['completed', 'failed'],
    example: 'completed',
  })
  @IsIn(['completed', 'failed'])
  status: 'completed' | 'failed';

  @ApiProperty({
    description: 'Execution attempt number of the transcode job',
    example: 1,
    minimum: 1,
  })
  @IsInt({ message: 'attempt must be an integer' })
  @Min(1, { message: 'attempt must be a positive integer greater than or equal to 1' })
  @IsNotEmpty({ message: 'attempt is mandatory for transcode webhooks' })
  attempt: number;

  @ApiPropertyOptional({
    description: 'Error diagnostics message if status is failed',
    example: 'Unsupported codec in source container',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string;
}
