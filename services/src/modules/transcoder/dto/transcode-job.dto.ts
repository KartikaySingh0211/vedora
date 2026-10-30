export interface TranscodeJobData {
  jobId?: string;
  videoId: string;
  userId: string;
  storageKey: string;
  bucketId?: string;
  resolutions: string[];
  title: string;
  slug: string;
  duration?: number;
  /**
   * Monotonically increasing attempt number (1-based: 1, 2, 3).
   */
  attempt?: number;
  claimedAt?: number;
  /**
   * @deprecated Use `attempt` instead. Retained strictly for backward compatibility deserialization.
   */
  attempts?: number;
}
