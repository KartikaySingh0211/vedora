import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuthenticatedRequest } from './dual-auth.guard';
import {
  SUPPORTED_RESOLUTIONS,
  calculateIncomingReservation,
  getMaxUploadFileSizeBytes,
  getUserStorageCapBytes,
  GIB_BYTES,
  TIB_BYTES,
} from '../config/plans.config';

export interface UploadVideoRequest extends AuthenticatedRequest {
  incomingReservation?: bigint;
  rawSizeBytes?: bigint;
  parsedResolutions?: string[];
}

@Injectable()
export class UploadVideoGuard implements CanActivate {
  private readonly logger = new Logger(UploadVideoGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<UploadVideoRequest>();

    // 1. Verify authenticated owner exists
    const user = request.user;
    if (!user || !user.id) {
      throw new UnauthorizedException(
        'Authentication required to upload media',
      );
    }

    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body is required');
    }

    const size = body.size;
    const rawResolutions = body.resolutions;

    // 2. Validate supplied file size as a positive safe integer within supported limits
    if (
      size === undefined ||
      size === null ||
      typeof size !== 'number' ||
      !Number.isInteger(size) ||
      size <= 0
    ) {
      throw new BadRequestException(
        'Invalid file size. Size must be a positive integer in bytes.',
      );
    }

    // Maximum single file size technical safeguard
    const maxFileSizeBytes = getMaxUploadFileSizeBytes();
    if (BigInt(size) > maxFileSizeBytes) {
      const maxGb = (Number(maxFileSizeBytes) / Number(GIB_BYTES)).toFixed(1);
      throw new BadRequestException(
        `File size exceeds maximum supported single-file ingestion limit of ${maxGb} GiB`,
      );
    }

    // 3. Validate requested resolutions
    const resolutions: string[] =
      Array.isArray(rawResolutions) && rawResolutions.length > 0
        ? (rawResolutions as unknown[]).map(String)
        : ['720p'];

    for (const res of resolutions) {
      if (
        !SUPPORTED_RESOLUTIONS.includes(
          res as (typeof SUPPORTED_RESOLUTIONS)[number],
        )
      ) {
        throw new BadRequestException(
          `Unsupported resolution: '${res}'. Supported resolutions are: ${SUPPORTED_RESOLUTIONS.join(
            ', ',
          )}`,
        );
      }
    }

    // 4. Calculate incoming storage reservation with safe BigInt integer math
    const rawSizeBytes = BigInt(size);
    const incomingReservation = calculateIncomingReservation(
      rawSizeBytes,
      resolutions,
    );

    // 5. Reject requests that exceed the system user storage capacity cap
    const userStorageCapBytes = getUserStorageCapBytes();
    if (incomingReservation > userStorageCapBytes) {
      const formattedLimit =
        userStorageCapBytes >= TIB_BYTES
          ? `${Number(userStorageCapBytes / TIB_BYTES)} TiB`
          : `${Number(userStorageCapBytes / GIB_BYTES)} GiB`;

      throw new BadRequestException(
        `Incoming file size and transcoded reservation (${(
          Number(incomingReservation) /
          Number(GIB_BYTES)
        ).toFixed(2)} GiB) exceeds user storage capacity limit of ${formattedLimit}.`,
      );
    }

    // 6. Attach validated metadata to request for downstream service use
    request.incomingReservation = incomingReservation;
    request.rawSizeBytes = rawSizeBytes;
    request.parsedResolutions = resolutions;

    return true;
  }
}
