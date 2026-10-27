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
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PlaylistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import {
  ActionSuccessResponseDto,
  ErrorResponseDto,
  ValidationErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('Playlists')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(DualAuthGuard)
@Controller('playlists')
export class PlaylistController {
  constructor(private readonly playlistService: PlaylistService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new playlist',
    description:
      'Creates a new playlist for the authenticated user. Enforces a maximum quota limit of 10 playlists per account using atomic PostgreSQL advisory locks.',
  })
  @ApiCreatedResponse({
    description: 'Playlist successfully created',
    type: PlaylistResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid playlist payload or account quota limit of 10 playlists exceeded',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async createPlaylist(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistService.createPlaylist(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List user playlists',
    description:
      'Retrieves all playlists belonging to the authenticated user, ordered by creation date descending with aggregated video counts.',
  })
  @ApiOkResponse({
    description: 'Array of playlists owned by the authenticated caller',
    type: [PlaylistResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async listPlaylists(
    @CurrentUser('id') userId: string,
  ): Promise<PlaylistResponseDto[]> {
    return this.playlistService.listPlaylists(userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get playlist details by ID',
    description:
      'Fetches metadata and video count for a specific playlist owned by the authenticated caller.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the playlist',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  @ApiOkResponse({
    description: 'Playlist record found',
    type: PlaylistResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Playlist not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async getPlaylist(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PlaylistResponseDto> {
    return this.playlistService.getPlaylist(userId, id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update playlist metadata',
    description:
      'Modifies the name or description of an existing playlist owned by the authenticated caller.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the playlist to update',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  @ApiOkResponse({
    description: 'Updated playlist details',
    type: PlaylistResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation failed on updated fields',
    type: ValidationErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Playlist not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async updatePlaylist(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistService.updatePlaylist(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a playlist',
    description:
      'Deletes the playlist and unlinks all contained videos (videos themselves are preserved in library).',
  })
  @ApiParam({
    name: 'id',
    description: 'UUIDv4 identifier of the playlist to delete',
    example: 'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d',
  })
  @ApiOkResponse({
    description: 'Confirmation that the playlist was removed',
    type: ActionSuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Playlist not found or not owned by caller',
    type: ErrorResponseDto,
  })
  async deletePlaylist(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ActionSuccessResponseDto> {
    return this.playlistService.deletePlaylist(userId, id);
  }
}
