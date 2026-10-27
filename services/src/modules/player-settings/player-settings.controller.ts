import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import {
  PlayerSettingsService,
  PublicPlayerConfig,
} from './player-settings.service';
import { UpdatePlayerSettingsDto } from './dto/update-player-settings.dto';
import {
  PlayerSettingsResponseDto,
  PublicPlayerConfigResponseDto,
} from './dto/player-settings-response.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import * as schema from '../../database/schema';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('Player Settings')
@Controller('player-settings')
export class PlayerSettingsController {
  constructor(private readonly playerSettingsService: PlayerSettingsService) {}

  @Get()
  @UseGuards(DualAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Get current user player settings',
    description:
      'Retrieves the customizable player styling, brand accent colors, controls, and watermark settings for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Player settings returned successfully',
    type: PlayerSettingsResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async getSettings(
    @CurrentUser('id') userId: string,
  ): Promise<schema.PlayerSettings> {
    return await this.playerSettingsService.getSettings(userId);
  }

  @Put()
  @UseGuards(DualAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Update current user player settings',
    description:
      'Updates player theme, brand colors, custom watermark preferences, and toolbar control visibility for the user.',
  })
  @ApiOkResponse({
    description: 'Player settings updated successfully',
    type: PlayerSettingsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed on styling parameters or color formats',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePlayerSettingsDto,
  ): Promise<schema.PlayerSettings> {
    return await this.playerSettingsService.updateSettings(userId, dto);
  }

  @Get('public/:videoId')
  @ApiOperation({
    summary: 'Get public player configuration for embed player',
    description:
      'Public endpoint consumed by iframe player embeds and SDK playback components. Resolves stream playback URLs and merges custom watermark/branding settings without authentication.',
  })
  @ApiParam({
    name: 'videoId',
    description: 'UUIDv4 identifier of the video to play',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Public player configuration and playback stream URL',
    type: PublicPlayerConfigResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Video record not found or inaccessible',
    type: ErrorResponseDto,
  })
  async getPublicPlayerConfig(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
  ): Promise<PublicPlayerConfig> {
    return await this.playerSettingsService.getPublicPlayerConfig(videoId);
  }
}
