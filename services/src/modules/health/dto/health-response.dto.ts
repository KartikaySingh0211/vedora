import { ApiProperty } from '@nestjs/swagger';

export class HealthDependenciesDto {
  @ApiProperty({
    description: 'PostgreSQL database connection status',
    example: 'up',
    enum: ['up', 'down'],
  })
  database: string;

  @ApiProperty({
    description: 'Redis cache and buffer connection status',
    example: 'up',
    enum: ['up', 'down (fallback to db active)'],
  })
  redis: string;
}

export class HealthResponseDto {
  @ApiProperty({
    description: 'Overall system health status',
    example: 'ok',
    enum: ['ok', 'degraded'],
  })
  status: string;

  @ApiProperty({
    description: 'Service identifier',
    example: 'vedora-services',
  })
  service: string;

  @ApiProperty({
    description: 'Service version',
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp of health evaluation',
    example: '2026-10-27T12:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Underlying infrastructure dependencies status',
    type: HealthDependenciesDto,
  })
  dependencies: HealthDependenciesDto;
}
