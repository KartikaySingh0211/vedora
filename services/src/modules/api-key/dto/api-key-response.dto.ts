import { ApiProperty } from '@nestjs/swagger';

export class ApiKeyResponseDto {
  @ApiProperty({
    description: 'Unique UUID identifier of the API key',
    example: 'd84b2591-4cf1-45d6-848e-28c04ec5cba7',
  })
  id: string;

  @ApiProperty({
    description:
      'Human-readable prefix of the API key for identification (e.g. ved_live_abc12345)',
    example: 'ved_live_d84b2591',
  })
  prefix: string;

  @ApiProperty({
    description: 'Date and time the API key was created',
    example: '2026-10-27T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description:
      'Timestamp when this API key was last used for authentication, or null if unused',
    nullable: true,
    example: '2026-10-27T12:30:00.000Z',
  })
  lastUsedAt: Date | null;

  @ApiProperty({
    description:
      'Timestamp when this API key was revoked, or null if currently active',
    nullable: true,
    example: null,
  })
  revokedAt: Date | null;
}

export class CreatedApiKeyResponseDto {
  @ApiProperty({
    description: 'Unique UUID identifier of the created API key',
    example: 'd84b2591-4cf1-45d6-848e-28c04ec5cba7',
  })
  id: string;

  @ApiProperty({
    description:
      'Full plaintext secret API key. WARNING: Returned only once upon creation. Store securely.',
    example:
      'ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b',
  })
  key: string;

  @ApiProperty({
    description: 'Key prefix for public reference and logs',
    example: 'ved_live_d84b2591',
  })
  prefix: string;

  @ApiProperty({
    description: 'Date and time the API key was created',
    example: '2026-10-27T12:00:00.000Z',
  })
  createdAt: Date;
}
