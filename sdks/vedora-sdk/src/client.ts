import {
  VedoraClientConfig,
  VideoMetadataInput,
  CompleteUploadInput,
  VideoRecord,
  VideoInitResult,
  UploadOptions,
  VedoraError,
} from './types';
import { uploadFileDirectly } from './uploader';

export class VedoraClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly bearerToken?: string | (() => Promise<string | null>);

  constructor(config: VedoraClientConfig = {}) {
    this.baseUrl = (config.baseUrl || 'http://localhost:8080/api/v1').replace(
      /\/+$/,
      '',
    );
    this.apiKey = config.apiKey;
    this.bearerToken = config.bearerToken;
  }

  /**
   * Build authentication and content headers
   */
  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    if (this.bearerToken) {
      const token =
        typeof this.bearerToken === 'function'
          ? await this.bearerToken()
          : this.bearerToken;

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Safe JSON fetch wrapper with typed Vedora errors
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    phase: 'init' | 'upload' | 'complete' | 'general' = 'general',
  ): Promise<T> {
    const headers = await this.getHeaders();
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...((options.headers as Record<string, string>) || {}),
        },
      });
    } catch (err: unknown) {
      throw new VedoraError(
        `Network request failed to ${url}: ${(err as Error).message}`,
        phase,
        undefined,
        err,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = { message: response.statusText };
    }

    if (!response.ok) {
      const errorMsg =
        (data as { message?: string | string[]; error?: string })?.message ||
        (data as { error?: string })?.error ||
        response.statusText;

      const messageStr = Array.isArray(errorMsg) ? errorMsg.join(', ') : String(errorMsg);

      throw new VedoraError(
        messageStr,
        phase,
        response.status,
        data,
      );
    }

    return data as T;
  }

  /**
   * Video Management & Direct Upload API
   */
  public readonly videos = {
    /**
     * Step 1: Initialize an upload, validate quotas, reserve storage, and get presigned parts
     */
    init: async (metadata: VideoMetadataInput): Promise<VideoInitResult> => {
      return this.request<VideoInitResult>(
        '/videos/init',
        {
          method: 'POST',
          body: JSON.stringify(metadata),
        },
        'init',
      );
    },

    /**
     * Step 3: Complete upload after cloud storage finishes, updating playlist counts
     */
    complete: async (dto: CompleteUploadInput): Promise<VideoRecord> => {
      return this.request<VideoRecord>(
        '/videos/complete',
        {
          method: 'POST',
          body: JSON.stringify(dto),
        },
        'complete',
      );
    },

    /**
     * List user videos with optional playlist filtering
     */
    list: async (params?: { playlistId?: string }): Promise<VideoRecord[]> => {
      const query = params?.playlistId
        ? `?playlistId=${encodeURIComponent(params.playlistId)}`
        : '';
      return this.request<VideoRecord[]>(`/videos${query}`, { method: 'GET' });
    },

    /**
     * Fetch single video details by ID
     */
    get: async (id: string): Promise<VideoRecord> => {
      return this.request<VideoRecord>(`/videos/${encodeURIComponent(id)}`, {
        method: 'GET',
      });
    },

    /**
     * Delete video and release storage quota
     */
    delete: async (id: string): Promise<{ success: boolean; id: string }> => {
      return this.request<{ success: boolean; id: string }>(
        `/videos/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    /**
     * End-to-end direct-to-cloud upload workflow:
     * 1. Request upload authorization from backend (/videos/init)
     * 2. Upload chunk parts directly to OneMinute Cloud Storage
     * 3. Confirm completion with backend (/videos/complete)
     */
    upload: async (
      file: File | Blob,
      metadata: VideoMetadataInput,
      options?: UploadOptions,
    ): Promise<VideoRecord> => {
      if (!file || file.size <= 0) {
        throw new VedoraError(
          'A valid non-empty File or Blob is required for upload',
          'init',
        );
      }

      // 1. Initialize upload with file size
      const initPayload: VideoMetadataInput = {
        ...metadata,
        size: file.size,
      };

      const initResult = await this.videos.init(initPayload);

      // 2. Direct upload to cloud storage
      const { storageKey } = await uploadFileDirectly(
        file,
        initResult.uploadData,
        options,
      );

      // 3. Complete upload registration
      const completedRecord = await this.videos.complete({
        videoId: initResult.video.id,
        storageKey,
        duration: options?.duration || 0,
      });

      return completedRecord;
    },
  };
}
