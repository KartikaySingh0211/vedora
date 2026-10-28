import { VedoraClientConfig, VideoMetadataInput, CompleteUploadInput, VideoRecord, VideoInitResult, UploadOptions } from './types';
export declare class VedoraClient {
    private readonly baseUrl;
    private readonly apiKey?;
    private readonly bearerToken?;
    constructor(config?: VedoraClientConfig);
    /**
     * Build authentication and content headers
     */
    private getHeaders;
    /**
     * Safe JSON fetch wrapper with typed Vedora errors
     */
    private request;
    /**
     * Video Management & Direct Upload API
     */
    readonly videos: {
        /**
         * Step 1: Initialize an upload, validate quotas, reserve storage, and get presigned parts
         */
        init: (metadata: VideoMetadataInput) => Promise<VideoInitResult>;
        /**
         * Step 3: Complete upload after cloud storage finishes, updating playlist counts
         */
        complete: (dto: CompleteUploadInput) => Promise<VideoRecord>;
        /**
         * List user videos with optional playlist filtering
         */
        list: (params?: {
            playlistId?: string;
        }) => Promise<VideoRecord[]>;
        /**
         * Fetch single video details by ID
         */
        get: (id: string) => Promise<VideoRecord>;
        /**
         * Delete video and release storage quota
         */
        delete: (id: string) => Promise<{
            success: boolean;
            id: string;
        }>;
        /**
         * End-to-end direct-to-cloud upload workflow:
         * 1. Request upload authorization from backend (/videos/init)
         * 2. Upload chunk parts directly to Cloudflare R2 / Storage
         * 3. Confirm completion with backend (/videos/complete)
         */
        upload: (file: File | Blob, metadata: VideoMetadataInput, options?: UploadOptions) => Promise<VideoRecord>;
    };
}
//# sourceMappingURL=client.d.ts.map