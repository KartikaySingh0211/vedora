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

export class TranscoderWebhookDto {
  @IsUUID('4', { message: 'videoId must be a valid UUIDv4' })
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  masterKey: string;

  @IsInt()
  @Min(0)
  totalDuration: number;

  @IsArray()
  @IsString({ each: true })
  renditions: string[];

  @IsInt()
  @Min(0)
  transcodedSize: number;

  @IsIn(['completed', 'failed'])
  status: 'completed' | 'failed';

  @IsString()
  @IsOptional()
  errorMessage?: string;
}
