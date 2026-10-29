export const GIB_BYTES = 1_073_741_824n;
export const TIB_BYTES = 1_099_511_627_776n;

/**
 * Open-Source Technical Safeguards for Video Ingestion & Quotas
 * Replaces commercial subscription plans with sensible abuse prevention.
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 10n * GIB_BYTES; // 10 GiB single file default
export const ABSOLUTE_MAX_FILE_SIZE_BYTES = 100n * GIB_BYTES; // 100 GiB sanity ceiling
export const DEFAULT_USER_STORAGE_CAP_BYTES = 500n * GIB_BYTES; // 500 GiB user quota default

export function getMaxUploadFileSizeBytes(): bigint {
  const envVal = process.env.MAX_UPLOAD_FILE_SIZE_BYTES;
  if (envVal) {
    try {
      const parsed = BigInt(envVal);
      if (parsed > 0n && parsed <= ABSOLUTE_MAX_FILE_SIZE_BYTES) {
        return parsed;
      }
    } catch {
      // fallback to default
    }
  }
  return DEFAULT_MAX_FILE_SIZE_BYTES;
}

export function getUserStorageCapBytes(): bigint {
  const envVal = process.env.MAX_USER_STORAGE_CAP_BYTES;
  if (envVal) {
    try {
      const parsed = BigInt(envVal);
      if (parsed > 0n) {
        return parsed;
      }
    } catch {
      // fallback to default
    }
  }
  return DEFAULT_USER_STORAGE_CAP_BYTES;
}

export const SUPPORTED_RESOLUTIONS = [
  '360p',
  '480p',
  '720p',
  '1080p',
] as const;
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
