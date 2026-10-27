import { ApiProperty } from '@nestjs/swagger';

export class StorageUploadResponseDto {
  @ApiProperty({
    description: 'Whether chunk write succeeded',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Part number written',
    example: 1,
  })
  partNumber: number;

  @ApiProperty({
    description: 'Upload session identifier',
    example: 'upl_9f83a2bc4e61d852',
  })
  uploadId: string;

  @ApiProperty({
    description: 'S3-compatible ETag checksum string generated for chunk',
    example: '"mock-etag-1-1730000000000"',
  })
  etag: string;
}
