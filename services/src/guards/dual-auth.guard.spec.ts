import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DualAuthGuard } from './dual-auth.guard';
import { ApiKeyService } from '../modules/api-key/api-key.service';
import * as clerkBackend from '@clerk/backend';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('DualAuthGuard', () => {
  let guard: DualAuthGuard;
  let mockApiKeyService: { verifyApiKey: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockApiKeyService = {
      verifyApiKey: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'clerk.secretKey') return 'sk_test_mock_secret';
        return undefined;
      }),
    };

    guard = new DualAuthGuard(
      mockApiKeyService as unknown as ApiKeyService,
      mockConfigService as unknown as ConfigService,
    );
  });

  function createMockContext(headers: Record<string, string>): {
    context: ExecutionContext;
    request: Record<string, any>;
  } {
    const request: Record<string, any> = { headers };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  it('should throw UnauthorizedException when no headers are provided', async () => {
    const { context } = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should authenticate valid API key from x-api-key header', async () => {
    const { context, request } = createMockContext({
      'x-api-key': 'VDR_0123456789abcdef0123456789abcdef_secretVal',
    });

    mockApiKeyService.verifyApiKey.mockResolvedValueOnce({
      userId: 'user_456',
      keyId: '0123456789abcdef0123456789abcdef',
      uuid: '01234567-89ab-cdef-0123-456789abcdef',
    });

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
    expect(request.user).toEqual({ id: 'user_456' });
    expect(request.authType).toBe('api_key');
  });

  it('should reject invalid or revoked API key with 401', async () => {
    const { context } = createMockContext({
      'x-api-key': 'VDR_invalid_key_value',
    });

    mockApiKeyService.verifyApiKey.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should authenticate valid Clerk token from Authorization Bearer header', async () => {
    const { context, request } = createMockContext({
      authorization: 'Bearer valid_clerk_jwt_token',
    });

    (clerkBackend.verifyToken as jest.Mock).mockResolvedValueOnce({
      sub: 'user_clerk_789',
      email: 'user@example.com',
    });

    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
    expect(request.user).toEqual({
      id: 'user_clerk_789',
      email: 'user@example.com',
    });
    expect(request.authType).toBe('clerk');
  });

  it('should reject invalid Clerk token with 401', async () => {
    const { context } = createMockContext({
      authorization: 'Bearer expired_or_tampered_jwt',
    });

    (clerkBackend.verifyToken as jest.Mock).mockRejectedValueOnce(
      new Error('Token expired'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
