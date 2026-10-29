import {
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UploadVideoGuard } from './upload-video.guard';
import type { UploadVideoRequest } from './upload-video.guard';

describe('UploadVideoGuard', () => {
  let guard: UploadVideoGuard;

  beforeEach(() => {
    guard = new UploadVideoGuard();
  });

  const createMockContext = (
    user?: { id?: string; [key: string]: unknown },
    body?: Record<string, unknown>,
  ): ExecutionContext => {
    const request = {
      user: user && user.id ? { id: user.id, ...user } : undefined,
      body,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('should throw UnauthorizedException when user is missing', () => {
    const context = createMockContext(undefined, { size: 1000 });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw BadRequestException when body is missing or size is invalid', () => {
    const context1 = createMockContext({ id: 'user_1' }, undefined);
    expect(() => guard.canActivate(context1)).toThrow(BadRequestException);

    const context2 = createMockContext({ id: 'user_1' }, { size: -50 });
    expect(() => guard.canActivate(context2)).toThrow(BadRequestException);

    const context3 = createMockContext({ id: 'user_1' }, { size: 0 });
    expect(() => guard.canActivate(context3)).toThrow(BadRequestException);

    const context4 = createMockContext({ id: 'user_1' }, { size: 12.34 });
    expect(() => guard.canActivate(context4)).toThrow(BadRequestException);
  });

  it('should throw BadRequestException when unsupported resolution is requested', () => {
    const context = createMockContext(
      { id: 'user_1' },
      { size: 1000, resolutions: ['4k'] },
    );
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it('should allow 1080p resolution ceiling for all open-source users', () => {
    const context = createMockContext(
      { id: 'user_1' },
      { size: 1000, resolutions: ['1080p'] },
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject upload when single file exceeds maximum upload limit', () => {
    // 101 GiB exceeds the 100 GiB maximum limit
    const overLimit = 101 * 1024 * 1024 * 1024;
    const context = createMockContext(
      { id: 'user_1' },
      { size: overLimit, resolutions: ['720p'] },
    );
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it('should accept valid upload within limits and populate request metadata', () => {
    const request: UploadVideoRequest = {
      user: { id: 'user_1' },
      body: { size: 100 * 1024 * 1024, resolutions: ['720p'] }, // 100 MB
    } as unknown as UploadVideoRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(request.rawSizeBytes).toBe(104857600n);
    expect(request.incomingReservation).toBe(178257920n);
    expect(request.parsedResolutions).toEqual(['720p']);
  });
});
