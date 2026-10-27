import { ApiProperty } from '@nestjs/swagger';

export class PlaylistResponseDto {
  @ApiProperty({
    description: 'Unique UUID identifier of the playlist',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  id: string;

  @ApiProperty({
    description: 'User ID of the playlist creator/owner',
    example: 'user_2NNEqL2Kz9X4abcdef123456',
  })
  userId: string;

  @ApiProperty({
    description: 'Name of the playlist',
    example: 'Frontend Architecture Masterclass',
  })
  name: string;

  @ApiProperty({
    description: 'Description or notes for the playlist',
    nullable: true,
    example: 'Curated deep-dives into modern web development and streaming',
  })
  description: string | null;

  @ApiProperty({
    description: 'Maximum videos allowed in this playlist (defaults to 100)',
    example: 100,
  })
  playlistLimit: number;

  @ApiProperty({
    description: 'Total active videos currently contained in this playlist',
    example: 5,
  })
  totalVideos: number;

  @ApiProperty({
    description: 'Date and time the playlist was created',
    example: '2026-10-27T12:00:00.000Z',
  })
  createdAt: Date;
}
