export type UserPlan = 'free' | 'starter' | 'pro' | 'business';

export interface PlanLimit {
  storageCapBytes: bigint;
  allow1080p: boolean;
  displayName: string;
}

export const GIB_BYTES = 1_073_741_824n;
export const TIB_BYTES = 1_099_511_627_776n;

export const PLAN_LIMITS: Record<UserPlan, PlanLimit> = {
  free: {
    storageCapBytes: 5n * GIB_BYTES, // 5,368,709,120 bytes (5 GiB)
    allow1080p: false,
    displayName: 'Free',
  },
  starter: {
    storageCapBytes: 250n * GIB_BYTES, // 268,435,456,000 bytes (250 GiB)
    allow1080p: true,
    displayName: 'Starter',
  },
  pro: {
    storageCapBytes: 600n * GIB_BYTES, // 644,245,094,400 bytes (600 GiB)
    allow1080p: true,
    displayName: 'Pro',
  },
  business: {
    storageCapBytes: 2n * TIB_BYTES, // 2,199,023,255,552 bytes (2 TiB)
    allow1080p: true,
    displayName: 'Business',
  },
};

export const DEFAULT_PLAN: UserPlan = 'free';

export const SUPPORTED_RESOLUTIONS = ['720p', '1080p'] as const;
export type SupportedResolution = (typeof SUPPORTED_RESOLUTIONS)[number];

/**
 * Calculate estimated transcoded output size using safe BigInt integer math:
 * - 720p-only encoding: 0.70x raw size (rawSize * 70 / 100)
 * - Multi-resolution encoding including 1080p: 1.75x raw size (rawSize * 175 / 100)
 */
export function calculateEstimatedTranscodedSize(
  rawSizeBytes: bigint,
  resolutions: string[] = ['720p'],
): bigint {
  const has1080p = resolutions.includes('1080p');
  if (has1080p) {
    return (rawSizeBytes * 175n) / 100n;
  }
  return (rawSizeBytes * 70n) / 100n;
}

/**
 * Calculate incoming storage reservation:
 * Incoming reservation = raw file size + estimated transcoded size
 */
export function calculateIncomingReservation(
  rawSizeBytes: bigint,
  resolutions: string[] = ['720p'],
): bigint {
  const estimatedTranscoded = calculateEstimatedTranscodedSize(
    rawSizeBytes,
    resolutions,
  );
  return rawSizeBytes + estimatedTranscoded;
}

/**
 * Resolve plan safely from user metadata or fallback to default Free tier
 */
export function resolveUserPlan(rawPlan?: unknown): UserPlan {
  if (typeof rawPlan === 'string') {
    const normalized = rawPlan.toLowerCase().trim();
    if (normalized in PLAN_LIMITS) {
      return normalized as UserPlan;
    }
  }
  return DEFAULT_PLAN;
}
