import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { Request } from 'express';
import { ApiKeyService } from '../modules/api-key/api-key.service';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    [key: string]: unknown;
  };
  authType?: 'clerk' | 'api_key';
  apiKeyInfo?: {
    userId: string;
    keyId: string;
    uuid: string;
  };
}

@Injectable()
export class DualAuthGuard implements CanActivate {
  private readonly logger = new Logger(DualAuthGuard.name);
  private readonly clerkSecretKey?: string;

  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly configService: ConfigService,
  ) {
    this.clerkSecretKey = this.configService.get<string>('clerk.secretKey');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 1. Check for x-api-key header
    const rawApiKey = request.headers['x-api-key'];
    const apiKeyHeader = Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey;

    // 2. Check for Authorization header
    const authHeader = request.headers.authorization;
    let bearerToken: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      bearerToken = authHeader.substring(7).trim();
    }

    // Determine credential to verify:
    // If x-api-key is present, or if Bearer token starts with VDR_, verify as Vedora API Key
    if (apiKeyHeader || (bearerToken && bearerToken.startsWith('VDR_'))) {
      const plaintextKey = apiKeyHeader || bearerToken;
      if (!plaintextKey) {
        throw new UnauthorizedException('Missing API key');
      }

      const result = await this.apiKeyService.verifyApiKey(plaintextKey);
      if (!result) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }

      request.user = { id: result.userId };
      request.authType = 'api_key';
      request.apiKeyInfo = result;
      return true;
    }

    // Otherwise, verify as Clerk JWT token
    if (bearerToken) {
      if (!this.clerkSecretKey) {
        this.logger.error('CLERK_SECRET_KEY is not configured on the server');
        throw new UnauthorizedException(
          'Authentication service is misconfigured',
        );
      }

      try {
        const payload = await verifyToken(bearerToken, {
          secretKey: this.clerkSecretKey,
        });

        if (!payload || !payload.sub) {
          throw new UnauthorizedException('Invalid token payload');
        }

        request.user = {
          id: payload.sub,
          email: (payload as Record<string, unknown>).email as
            string | undefined,
        };
        request.authType = 'clerk';
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Clerk token verification failed: ${msg}`);
        throw new UnauthorizedException(
          'Invalid or expired authentication token',
        );
      }
    }

    throw new UnauthorizedException(
      'Missing authentication credentials. Please provide a Bearer token or x-api-key.',
    );
  }
}
