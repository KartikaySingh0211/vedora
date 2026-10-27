import { ApiProperty } from '@nestjs/swagger';

export class PlayerSettingsResponseDto {
  @ApiProperty({
    description: 'Unique UUIDv4 identifier of the player settings record',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'User ID of the settings owner',
    example: 'user_2NNEqL2Kz9X4abcdef123456',
  })
  user_id: string;

  @ApiProperty({
    description: 'Primary brand accent color',
    example: '#3b82f6',
  })
  primary_color: string;

  @ApiProperty({
    description: 'Control bar background color',
    example: 'rgba(0, 0, 0, 0.7)',
  })
  control_bar_bg: string;

  @ApiProperty({
    description: 'Play icon style preset',
    example: 'default',
    enum: ['default', 'minimal', 'glow'],
  })
  play_icon_style: string;

  @ApiProperty({
    description: 'Custom watermark image URL if uploaded',
    nullable: true,
    example: null,
  })
  watermark_url: string | null;

  @ApiProperty({
    description: 'Watermark screen position',
    example: 'top-right',
    enum: ['top-right', 'top-left', 'bottom-right'],
  })
  watermark_position: string;

  @ApiProperty({
    description: 'Watermark opacity percentage (0 to 100)',
    example: 80,
  })
  watermark_opacity: number;

  @ApiProperty({
    description: 'Whether closed caption subtitles are enabled by default',
    example: true,
  })
  enable_subtitles: boolean;

  @ApiProperty({
    description: 'List of controls enabled in the player toolbar',
    type: [String],
    example: [
      'Play / Pause',
      '10s Backward',
      '10s Forward',
      'Full Screen',
      'Volume',
      'Progress',
      'Settings',
    ],
  })
  enabled_controls: string[];

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2026-10-27T12:00:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2026-10-27T12:00:00.000Z',
  })
  updated_at: Date;
}

export class PublicPlayerConfigResponseDto {
  @ApiProperty({
    description: 'UUIDv4 identifier of the video being played',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  videoId: string;

  @ApiProperty({
    description: 'Title of the video',
    example: 'Vedora Direct Upload Tutorial',
  })
  title: string;

  @ApiProperty({
    description:
      'HLS master playlist stream URL (.m3u8) or direct fallback MP4 playback URL',
    nullable: true,
    example:
      'http://localhost:8080/api/v1/storage/stream?key=videos%2F3fa85f64-5717-4562-b3fc-2c963f66afa6%2Fmaster.m3u8',
  })
  streamUrl: string | null;

  @ApiProperty({
    description: 'Primary accent color for player controls',
    example: '#3b82f6',
  })
  primaryColor: string;

  @ApiProperty({
    description: 'Background color styling for control bar',
    example: 'rgba(0, 0, 0, 0.7)',
  })
  controlBarBg: string;

  @ApiProperty({
    description: 'Play button icon style preset',
    example: 'default',
    enum: ['default', 'minimal', 'glow'],
  })
  playIconStyle: string;

  @ApiProperty({
    description: 'Watermark asset URL',
    nullable: true,
    example: 'https://cdn.vedora.com/branding/vedora-watermark.png',
  })
  watermarkUrl: string | null;

  @ApiProperty({
    description: 'Text watermark fallback if image not configured',
    nullable: true,
    example: 'Powered by Vedora',
  })
  watermarkText: string | null;

  @ApiProperty({
    description: 'Watermark corner placement',
    example: 'bottom-right',
    enum: ['top-right', 'top-left', 'bottom-right'],
  })
  watermarkPosition: string;

  @ApiProperty({
    description: 'Watermark opacity percentage (0 to 100)',
    example: 80,
  })
  watermarkOpacity: number;

  @ApiProperty({
    description: 'Whether subtitles/captions are enabled',
    example: true,
  })
  enableSubtitles: boolean;

  @ApiProperty({
    description: 'Active toolbar control names',
    type: [String],
    example: [
      'Play / Pause',
      '10s Backward',
      '10s Forward',
      'Full Screen',
      'Volume',
      'Progress',
    ],
  })
  enabledControls: string[];

  @ApiProperty({
    description:
      'True if video belongs to a Free tier account (mandatory watermark displayed)',
    example: true,
  })
  isFreeTier: boolean;
}
