import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class UpdatePlayerSettingsDto {
  @IsString()
  @IsOptional()
  @Matches(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\([\d\s,.]+\))$/, {
    message: 'primaryColor must be a valid hex or rgb/rgba color string',
  })
  primaryColor?: string;

  @IsString()
  @IsOptional()
  @Matches(/^(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})|rgba?\([\d\s,.]+\))$/, {
    message: 'controlBarBg must be a valid hex or rgb/rgba color string',
  })
  controlBarBg?: string;

  @IsString()
  @IsOptional()
  @IsIn(['default', 'minimal', 'glow'], {
    message: 'playIconStyle must be one of: default, minimal, glow',
  })
  playIconStyle?: string;

  @IsString()
  @IsOptional()
  watermarkUrl?: string | null;

  @IsString()
  @IsOptional()
  @IsIn(['top-right', 'top-left', 'bottom-right'], {
    message:
      'watermarkPosition must be one of: top-right, top-left, bottom-right',
  })
  watermarkPosition?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(100)
  watermarkOpacity?: number;

  @IsBoolean()
  @IsOptional()
  enableSubtitles?: boolean;
}
