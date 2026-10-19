import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlaylistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';

@ApiTags('Playlists')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-api-key',
  required: false,
  description: 'Vedora API Key',
})
@UseGuards(DualAuthGuard)
@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new playlist for the authenticated user',
  })
  @ApiResponse({ status: 201, description: 'Playlist successfully created' })
  @ApiResponse({
    status: 400,
    description: 'Quota exceeded or invalid payload',
  })
  async createPlaylist(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePlaylistDto,
  ) {
    return this.playlistService.createPlaylist(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all playlists belonging to the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'List of playlists' })
  async listPlaylists(@CurrentUser('id') userId: string) {
    return this.playlistService.listPlaylists(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an individual playlist by ID' })
  @ApiResponse({ status: 200, description: 'Playlist details' })
  @ApiResponse({ status: 404, description: 'Playlist not found' })
  async getPlaylist(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playlistService.getPlaylist(userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update playlist name and/or description' })
  @ApiResponse({ status: 200, description: 'Updated playlist' })
  @ApiResponse({ status: 404, description: 'Playlist not found' })
  async updatePlaylist(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistService.updatePlaylist(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a playlist' })
  @ApiResponse({ status: 200, description: 'Deletion confirmation' })
  @ApiResponse({ status: 404, description: 'Playlist not found' })
  async deletePlaylist(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playlistService.deletePlaylist(userId, id);
  }
}
