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
import { Throttle } from '@nestjs/throttler';
import {
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
import { ApiKeyService } from './api-key.service';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import {
  ApiKeyResponseDto,
  CreatedApiKeyResponseDto,
} from './dto/api-key-response.dto';
import {
  ActionSuccessResponseDto,
  ErrorResponseDto,
} from '../../common/dto/error-response.dto';

@ApiTags('API Keys')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@UseGuards(DualAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Get()
  @ApiOperation({
    summary: "List current authenticated user's API keys",
    description:
      'Retrieves metadata for all API keys created by the caller, including prefixes, creation dates, last-used timestamps, and revocation status.',
  })
  @ApiOkResponse({
    description: 'Array of user API key records',
    type: [ApiKeyResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Clerk Bearer token or x-api-key header',
    type: ErrorResponseDto,
  })
  async listKeys(
    @CurrentUser('id') userId: string,
  ): Promise<ApiKeyResponseDto[]> {
    return this.apiKeyService.listApiKeys(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({
    summary: 'Generate a new API key',
    description:
      'Creates a new API key with argon2 hashing. Returns the raw plaintext secret key exactly once. It cannot be retrieved again.',
  })
  @ApiCreatedResponse({
    description: 'Newly generated API key with plaintext secret',
    type: CreatedApiKeyResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required to generate an API key',
    type: ErrorResponseDto,
  })
  async createKey(
    @CurrentUser('id') userId: string,
  ): Promise<CreatedApiKeyResponseDto> {
    return this.apiKeyService.createApiKey(userId);
  }

  @Post(':id/regenerate')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({
    summary: 'Revoke and regenerate an API key',
    description:
      'Revokes the specified existing API key immediately and issues a newly generated key record under the same user account.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID or key identifier of the key to regenerate',
    example: 'd84b2591-4cf1-45d6-848e-28c04ec5cba7',
  })
  @ApiOkResponse({
    description: 'New API key generated in place of the revoked key',
    type: CreatedApiKeyResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'API key not found or not owned by the authenticated user',
    type: ErrorResponseDto,
  })
  async regenerateKey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<CreatedApiKeyResponseDto> {
    return this.apiKeyService.regenerateApiKey(userId, id);
  }

  @Post(':id/revoke')
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Marks the specified API key as revoked and purges it from local and Redis verification caches.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID or key identifier of the key to revoke',
    example: 'd84b2591-4cf1-45d6-848e-28c04ec5cba7',
  })
  @ApiOkResponse({
    description: 'Confirmation that the API key was successfully revoked',
    type: ActionSuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'API key not found or not owned by the authenticated user',
    type: ErrorResponseDto,
  })
  async revokeKey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<ActionSuccessResponseDto> {
    return this.apiKeyService.revokeApiKey(userId, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Revoke an API key (DELETE method alias)',
    description:
      'Standard REST DELETE alias for revoking an API key and invalidating cache entries.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID or key identifier of the key to revoke',
    example: 'd84b2591-4cf1-45d6-848e-28c04ec5cba7',
  })
  @ApiOkResponse({
    description: 'Confirmation that the API key was successfully revoked',
    type: ActionSuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'API key not found or not owned by the authenticated user',
    type: ErrorResponseDto,
  })
  async deleteKey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<ActionSuccessResponseDto> {
    return this.apiKeyService.revokeApiKey(userId, id);
  }
}
