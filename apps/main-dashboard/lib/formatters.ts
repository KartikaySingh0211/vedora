/**
 * Shared formatting utilities for Vedora Dashboard.
 * Centralizes byte-to-human conversion, video time formatting, and number displays.
 */

/**
 * Format raw byte counts into human-readable strings (e.g., "1.5 MB", "2.4 GB").
 */
export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const normalizedIndex = Math.min(i, sizes.length - 1);
  return `${(bytes / Math.pow(k, normalizedIndex)).toFixed(1)} ${sizes[normalizedIndex]}`;
}

/**
 * Format video duration in seconds into standard "M:SS" or "H:MM:SS" strings.
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? "0" : ""}${mins}:${secs < 10 ? "0" : ""}${secs}`;
  }
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/**
 * Format numbers with locale-aware grouping (e.g. 12840 -> "12,840").
 */
export function formatNumber(value: number): string {
  if (isNaN(value)) return "0";
  return value.toLocaleString();
}
