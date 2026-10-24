export type VideoStatus =
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed';

export interface UploadProgress {
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number;
}

export interface VideoMetadataInput {
  title: string;
  slug: string;
  size?: number;
  resolutions?: ('720p' | '1080p')[];
  playlistId?: string;
  description?: string;
  tags?: string[];
  generateSubtitles?: boolean;
  includeWatermark?: boolean;
  duration?: number;
}

export interface CompleteUploadInput {
  videoId: string;
  storageKey: string;
  duration?: number;
  uploadId?: string;
  parts?: CompletedPart[];
}

export interface VideoRecord {
  id: string;
  userId: string;
  playlistId: string | null;
  title: string;
  slug: string;
  description: string | null;
  tags: string[];
  storageKey: string | null;
  bucketId: string | null;
  size: number;
  estimatedTranscodedSize: number;
  duration: number;
  status: VideoStatus;
  resolutions: string[];
  thumbnailUrl: string | null;
  generateSubtitles: boolean;
  includeWatermark: boolean;
  masterM3u8Key: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoragePart {
  partNumber: number;
  url: string;
}

export interface StorageInitiateData {
  objectId: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: StoragePart[];
}

export interface VideoInitResult {
  video: VideoRecord;
  uploadData: StorageInitiateData;
  bucketId: string;
}

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  maxRetries?: number;
  duration?: number;
}

export interface VedoraClientConfig {
  baseUrl?: string;
  apiKey?: string;
  bearerToken?: string | (() => Promise<string | null>);
}

export class VedoraError extends Error {
  constructor(
    message: string,
    public readonly phase: 'init' | 'upload' | 'complete' | 'general',
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'VedoraError';
  }
}
