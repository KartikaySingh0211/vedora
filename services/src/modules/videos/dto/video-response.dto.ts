import { ApiProperty } from '@nestjs/swagger';

export class StoragePartDto {
  @ApiProperty({
    description: '1-indexed sequential part number',
    example: 1,
  })
  partNumber: number;

  @ApiProperty({
    description:
      'Direct-to-cloud presigned upload URL or local upload endpoint where chunk binary should be PUT/POSTed',
    example:
      'http://localhost:8080/api/v1/storage/mock-upload?partNumber=1&uploadId=upl_9f83a2&key=videos%2Fvid-123%2Fraw.mp4',
  })
  url: string;
}

export class StorageInitiateResultDto {
  @ApiProperty({
    description: 'Object identifier in cloud storage',
    example: 'obj_1234567890abcdef',
  })
  objectId: string;

  @ApiProperty({
    description: 'Storage key path for the uploaded raw source video',
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4',
  })
  key: string;

  @ApiProperty({
    description: 'Multipart upload session ID',
    example: 'upl_9f83a2bc4e61d852',
  })
  uploadId: string;

  @ApiProperty({
    description: 'Recommended chunk size in bytes (e.g. 5242880 = 5MB)',
    example: 5242880,
  })
  partSize: number;

  @ApiProperty({
    description: 'List of pre-allocated upload parts and presigned upload URLs',
    type: [StoragePartDto],
  })
  parts: StoragePartDto[];
}

export class VideoResponseDto {
  @ApiProperty({
    description: 'Unique UUIDv4 identifier of the video',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({
    description: 'User ID of the video owner',
    example: 'user_2NNEqL2Kz9X4abcdef123456',
  })
  userId: string;

  @ApiProperty({
    description: 'UUID of the parent playlist if assigned, otherwise null',
    nullable: true,
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  playlistId: string | null;

  @ApiProperty({
    description: 'Title of the video',
    example: 'Vedora Direct Upload Tutorial',
  })
  title: string;

  @ApiProperty({
    description: 'URL-friendly unique slug',
    example: 'vedora-direct-upload-tutorial',
  })
  slug: string;

  @ApiProperty({
    description: 'Description or summary of the video content',
    nullable: true,
    example:
      'Step-by-step guide to multipart video ingestion and HLS streaming',
  })
  description: string | null;

  @ApiProperty({
    description: 'Tags for searching and organizing videos',
    type: [String],
    example: ['tutorial', 'streaming', 'hls'],
  })
  tags: string[];

  @ApiProperty({
    description: 'Storage key path of the raw source file in cloud storage',
    nullable: true,
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4',
  })
  storageKey: string | null;

  @ApiProperty({
    description: 'Cloud storage bucket ID where video assets are kept',
    nullable: true,
    example: '00000000-0000-0000-0000-000000000001',
  })
  bucketId: string | null;

  @ApiProperty({
    description: 'Raw source file size in bytes',
    example: 104857600,
  })
  size: number;

  @ApiProperty({
    description:
      'Reserved storage quota allowance in bytes for transcoding renditions (size * 1.5)',
    example: 157286400,
  })
  estimatedTranscodedSize: number;

  @ApiProperty({
    description:
      'Actual total storage size consumed by transcoded HLS renditions, populated upon transcoding completion',
    nullable: true,
    example: 142606336,
  })
  transcodedSize: number | null;

  @ApiProperty({
    description: 'Duration of the video in seconds',
    example: 120,
  })
  duration: number;

  @ApiProperty({
    description: 'Current lifecycle ingestion status of the video',
    enum: ['uploading', 'uploaded', 'processing', 'ready', 'failed'],
    example: 'ready',
  })
  status: 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';

  @ApiProperty({
    description: 'Configured HLS resolution outputs',
    type: [String],
    example: ['720p', '1080p'],
  })
  resolutions: string[];

  @ApiProperty({
    description: 'URL of generated thumbnail image',
    nullable: true,
    example:
      'https://cdn.vedora.com/thumbnails/3fa85f64-5717-4562-b3fc-2c963f66afa6.jpg',
  })
  thumbnailUrl: string | null;

  @ApiProperty({
    description: 'Whether subtitles should be automatically generated',
    example: true,
  })
  generateSubtitles: boolean;

  @ApiProperty({
    description: 'Whether player watermark overlay is enabled',
    example: false,
  })
  includeWatermark: boolean;

  @ApiProperty({
    description: 'Storage key path for the master HLS .m3u8 playlist file',
    nullable: true,
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/master.m3u8',
  })
  masterM3u8Key: string | null;

  @ApiProperty({
    description: 'Timestamp when video record was created',
    example: '2026-10-27T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when video record was last updated',
    example: '2026-10-27T12:05:00.000Z',
  })
  updatedAt: Date;
}

export class VideoInitResponseDto {
  @ApiProperty({
    description: 'Created video entity in uploading status',
    type: VideoResponseDto,
  })
  video: VideoResponseDto;

  @ApiProperty({
    description:
      'Direct-to-cloud multipart upload credentials, presigned URLs, and chunk instructions',
    type: StorageInitiateResultDto,
  })
  uploadData: StorageInitiateResultDto;

  @ApiProperty({
    description: 'Cloud storage bucket ID allocated for the upload',
    example: '00000000-0000-0000-0000-000000000001',
  })
  bucketId: string;
}
