import {
  Controller,
  Get,
  Post,
  Delete,
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
import { ApiKeyService } from './api-key.service';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';

@ApiTags('API Keys')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-api-key',
  required: false,
  description: 'Vedora API Key',
})
@UseGuards(DualAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  @ApiOperation({ summary: "List current authenticated user's API keys" })
  @ApiResponse({ status: 200, description: 'List of API keys' })
  async listKeys(@CurrentUser('id') userId: string) {
    return this.apiKeyService.listApiKeys(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate a new API key (plaintext key returned only once)',
  })
  @ApiResponse({ status: 201, description: 'Newly generated API key' })
  async createKey(@CurrentUser('id') userId: string) {
    return this.apiKeyService.createApiKey(userId);
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'Revoke and regenerate an API key' })
  @ApiResponse({ status: 200, description: 'Regenerated API key' })
  async regenerateKey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.apiKeyService.regenerateApiKey(userId, id);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 200, description: 'Revocation confirmation' })
  async revokeKey(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.apiKeyService.revokeApiKey(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key (DELETE method)' })
  @ApiResponse({ status: 200, description: 'Revocation confirmation' })
  async deleteKey(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.apiKeyService.revokeApiKey(userId, id);
  }
}
