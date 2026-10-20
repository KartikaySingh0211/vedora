export interface TranscodeJobData {
  videoId: string;
  userId: string;
  storageKey: string;
  bucketId?: string;
  resolutions: string[];
  title: string;
  slug: string;
  duration?: number;
}
