import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  PlayerSettingsService,
  PublicPlayerConfig,
} from './player-settings.service';
import { UpdatePlayerSettingsDto } from './dto/update-player-settings.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import * as schema from '../../database/schema';

@ApiTags('Player Settings')
@Controller('player-settings')
export class PlayerSettingsController {
  constructor(private readonly playerSettingsService: PlayerSettingsService) {}

  @Get()
  @UseGuards(DualAuthGuard)
  @ApiOperation({ summary: 'Get current user player settings' })
  @ApiResponse({ status: 200, description: 'Player settings returned' })
  async getSettings(
    @CurrentUser('id') userId: string,
  ): Promise<schema.PlayerSettings> {
    return await this.playerSettingsService.getSettings(userId);
  }

  @Put()
  @UseGuards(DualAuthGuard)
  @ApiOperation({ summary: 'Update current user player settings' })
  @ApiResponse({ status: 200, description: 'Player settings updated' })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePlayerSettingsDto,
  ): Promise<schema.PlayerSettings> {
    return await this.playerSettingsService.updateSettings(userId, dto);
  }

  @Get('public/:videoId')
  @ApiOperation({ summary: 'Get public player configuration for embed player' })
  @ApiResponse({ status: 200, description: 'Public configuration returned' })
  async getPublicPlayerConfig(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
  ): Promise<PublicPlayerConfig> {
    return await this.playerSettingsService.getPublicPlayerConfig(videoId);
  }
}
