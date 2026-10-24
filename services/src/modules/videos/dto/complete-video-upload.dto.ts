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

export class CompletedPartDto {
  @IsInt()
  PartNumber: number;

  @IsString()
  ETag: string;
}

export class CompleteVideoUploadDto {
  @IsUUID('4', { message: 'videoId must be a valid UUID' })
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  storageKey: string;

  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Duration must be a non-negative integer' })
  duration: number;

  @IsOptional()
  @IsString()
  uploadId?: string;

  @IsOptional()
  @IsArray()
  parts?: CompletedPartDto[];
}
