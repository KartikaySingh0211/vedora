"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VedoraClient = void 0;
const types_1 = require("./types");
const uploader_1 = require("./uploader");
class VedoraClient {
    baseUrl;
    apiKey;
    bearerToken;
    constructor(config = {}) {
        this.baseUrl = (config.baseUrl || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
        this.apiKey = config.apiKey;
        this.bearerToken = config.bearerToken;
    }
    /**
     * Build authentication and content headers
     */
    async getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }
        if (this.bearerToken) {
            const token = typeof this.bearerToken === 'function'
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
    async request(endpoint, options = {}, phase = 'general') {
        const headers = await this.getHeaders();
        const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers: {
                    ...headers,
                    ...(options.headers || {}),
                },
            });
        }
        catch (err) {
            throw new types_1.VedoraError(`Network request failed to ${url}: ${err.message}`, phase, undefined, err);
        }
        let data;
        try {
            data = await response.json();
        }
        catch {
            data = { message: response.statusText };
        }
        if (!response.ok) {
            const errorMsg = data?.message ||
                data?.error ||
                response.statusText;
            const messageStr = Array.isArray(errorMsg) ? errorMsg.join(', ') : String(errorMsg);
            throw new types_1.VedoraError(messageStr, phase, response.status, data);
        }
        return data;
    }
    /**
     * Video Management & Direct Upload API
     */
    videos = {
        /**
         * Step 1: Initialize an upload, validate quotas, reserve storage, and get presigned parts
         */
        init: async (metadata) => {
            return this.request('/videos/init', {
                method: 'POST',
                body: JSON.stringify(metadata),
            }, 'init');
        },
        /**
         * Step 3: Complete upload after cloud storage finishes, updating playlist counts
         */
        complete: async (dto) => {
            return this.request('/videos/complete', {
                method: 'POST',
                body: JSON.stringify(dto),
            }, 'complete');
        },
        /**
         * List user videos with optional playlist filtering
         */
        list: async (params) => {
            const query = params?.playlistId
                ? `?playlistId=${encodeURIComponent(params.playlistId)}`
                : '';
            return this.request(`/videos${query}`, { method: 'GET' });
        },
        /**
         * Fetch single video details by ID
         */
        get: async (id) => {
            return this.request(`/videos/${encodeURIComponent(id)}`, {
                method: 'GET',
            });
        },
        /**
         * Delete video and release storage quota
         */
        delete: async (id) => {
            return this.request(`/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
        },
        /**
         * End-to-end direct-to-cloud upload workflow:
         * 1. Request upload authorization from backend (/videos/init)
         * 2. Upload chunk parts directly to OneMinute Cloud Storage
         * 3. Confirm completion with backend (/videos/complete)
         */
        upload: async (file, metadata, options) => {
            if (!file || file.size <= 0) {
                throw new types_1.VedoraError('A valid non-empty File or Blob is required for upload', 'init');
            }
            // 1. Initialize upload with file size and duration
            const initPayload = {
                ...metadata,
                size: file.size,
                duration: metadata.duration ?? options?.duration,
            };
            const initResult = await this.videos.init(initPayload);
            // 2. Direct upload to cloud storage
            const { storageKey, completedParts } = await (0, uploader_1.uploadFileDirectly)(file, initResult.uploadData, options);
            // 3. Complete upload registration
            const completedRecord = await this.videos.complete({
                videoId: initResult.video.id,
                storageKey,
                duration: options?.duration || 0,
                uploadId: initResult.uploadData?.uploadId,
                parts: completedParts,
            });
            return completedRecord;
        },
    };
}
exports.VedoraClient = VedoraClient;
//# sourceMappingURL=client.js.map