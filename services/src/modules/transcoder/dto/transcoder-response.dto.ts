import { ApiProperty } from '@nestjs/swagger';

export class TranscoderWebhookResponseDto {
  @ApiProperty({
    description: 'Whether webhook payload was successfully parsed and applied',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Descriptive status outcome message',
    example: 'Webhook processed successfully',
  })
  message: string;
}

export class TranscoderProcessResponseDto {
  @ApiProperty({
    description: 'Current queueing status of the transcode job',
    example: 'enqueued',
    enum: ['enqueued'],
  })
  status: string;

  @ApiProperty({
    description: 'UUIDv4 identifier of the video submitted for transcoding',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  videoId: string;
}
