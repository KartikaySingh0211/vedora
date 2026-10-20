import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { AuthenticatedRequest } from './dual-auth.guard';
import {
  PLAN_LIMITS,
  SUPPORTED_RESOLUTIONS,
  calculateIncomingReservation,
  resolveUserPlan,
  GIB_BYTES,
  TIB_BYTES,
  UserPlan,
} from '../config/plans.config';

export interface UploadVideoRequest extends AuthenticatedRequest {
  userPlan?: UserPlan;
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

    // Maximum single file size sanity check: 100 GB
    const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024 * 1024;
    if (size > MAX_SINGLE_FILE_BYTES) {
      throw new BadRequestException(
        'File size exceeds maximum supported single-file ingestion limit of 100 GiB',
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

    // 4. Resolve user's actual plan from trusted server-side source
    const rawPlan =
      user.plan ||
      ((user as Record<string, unknown>).publicMetadata &&
        (
          (user as Record<string, unknown>).publicMetadata as Record<
            string,
            unknown
          >
        ).plan);
    const userPlan = resolveUserPlan(rawPlan);
    const planConfig = PLAN_LIMITS[userPlan];

    // 5. Reject unsupported resolution requests (e.g. 1080p on Free tier)
    if (resolutions.includes('1080p') && !planConfig.allow1080p) {
      throw new ForbiddenException(
        `1080p resolution is prohibited on the ${planConfig.displayName} plan. Please upgrade to Starter or higher.`,
      );
    }

    // 6. Calculate incoming storage reservation with safe BigInt integer math
    const rawSizeBytes = BigInt(size);
    const incomingReservation = calculateIncomingReservation(
      rawSizeBytes,
      resolutions,
    );

    // 7. Reject requests that exceed the applicable plan limit
    if (incomingReservation > planConfig.storageCapBytes) {
      const formattedLimit =
        planConfig.storageCapBytes >= TIB_BYTES
          ? `${Number(planConfig.storageCapBytes / TIB_BYTES)} TiB`
          : `${Number(planConfig.storageCapBytes / GIB_BYTES)} GiB`;

      throw new BadRequestException(
        `Incoming file size and transcoded reservation (${(
          Number(incomingReservation) /
          (1024 * 1024 * 1024)
        ).toFixed(2)} GiB) exceeds your entire ${
          planConfig.displayName
        } plan capacity of ${formattedLimit}.`,
      );
    }

    // 8. Attach validated metadata to request for downstream service use
    request.userPlan = userPlan;
    request.incomingReservation = incomingReservation;
    request.rawSizeBytes = rawSizeBytes;
    request.parsedResolutions = resolutions;

    return true;
  }
}
