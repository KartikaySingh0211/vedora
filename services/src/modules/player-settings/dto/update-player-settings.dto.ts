import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlayerSettingsDto {
  @ApiPropertyOptional({
    description: 'Hex or RGB/RGBA accent brand color for player controls',
    example: '#3b82f6',
  })
  @IsString()
  @IsOptional()
  @Matches(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\([\d\s,.]+\))$/, {
    message: 'primaryColor must be a valid hex or rgb/rgba color string',
  })
  primaryColor?: string;

  @ApiPropertyOptional({
    description: 'Hex or RGB/RGBA background color for bottom control toolbar',
    example: 'rgba(0, 0, 0, 0.7)',
  })
  @IsString()
  @IsOptional()
  @Matches(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\([\d\s,.]+\))$/, {
    message: 'controlBarBg must be a valid hex or rgb/rgba color string',
  })
  controlBarBg?: string;

  @ApiPropertyOptional({
    description: 'Style preset for the center playback button',
    enum: ['default', 'minimal', 'glow'],
    example: 'glow',
  })
  @IsString()
  @IsOptional()
  @IsIn(['default', 'minimal', 'glow'], {
    message: 'playIconStyle must be one of: default, minimal, glow',
  })
  playIconStyle?: string;

  @ApiPropertyOptional({
    description: 'URL of uploaded custom watermark image (Pro/Business tiers)',
    nullable: true,
    example: 'https://cdn.vedora.com/watermarks/user_123.png',
  })
  @IsString()
  @IsOptional()
  watermarkUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Corner position of the player watermark overlay',
    enum: ['top-right', 'top-left', 'bottom-right'],
    example: 'bottom-right',
  })
  @IsString()
  @IsOptional()
  @IsIn(['top-right', 'top-left', 'bottom-right'], {
    message:
      'watermarkPosition must be one of: top-right, top-left, bottom-right',
  })
  watermarkPosition?: string;

  @ApiPropertyOptional({
    description: 'Opacity percentage of the watermark overlay (0 to 100)',
    example: 80,
    minimum: 0,
    maximum: 100,
  })
  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(100)
  watermarkOpacity?: number;

  @ApiPropertyOptional({
    description:
      'Whether closed caption subtitles should be enabled by default',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  enableSubtitles?: boolean;

  @ApiPropertyOptional({
    description: 'List of player control elements to render on the toolbar',
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
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  enabledControls?: string[];
}
