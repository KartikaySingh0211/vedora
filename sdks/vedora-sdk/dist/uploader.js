"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFileDirectly = uploadFileDirectly;
const types_1 = require("./types");
/**
 * Upload file parts directly to cloud storage presigned endpoints
 * Does not proxy video payloads through the backend API
 */
async function uploadFileDirectly(file, uploadData, options) {
    if (!file || file.size <= 0) {
        throw new types_1.VedoraError('File cannot be empty', 'upload');
    }
    const { parts, partSize, key } = uploadData;
    if (!parts || parts.length === 0) {
        throw new types_1.VedoraError('No upload parts provided by storage provider', 'upload');
    }
    const completedParts = [];
    let uploadedBytes = 0;
    const startTime = Date.now();
    const maxRetries = options?.maxRetries ?? 3;
    for (const part of parts) {
        if (options?.signal?.aborted) {
            throw new types_1.VedoraError('Upload cancelled by user', 'upload');
        }
        const start = (part.partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        let attempt = 0;
        let etag = null;
        while (attempt <= maxRetries) {
            if (options?.signal?.aborted) {
                throw new types_1.VedoraError('Upload cancelled by user', 'upload');
            }
            try {
                const response = await fetch(part.url, {
                    method: 'PUT',
                    body: chunk,
                    signal: options?.signal,
                });
                if (!response.ok) {
                    // Do not retry 4xx client errors (unauthorized, quota, bad request)
                    if (response.status >= 400 &&
                        response.status < 500 &&
                        response.status !== 408 &&
                        response.status !== 429) {
                        throw new types_1.VedoraError(`Cloud storage rejected part ${part.partNumber} with HTTP ${response.status}`, 'upload', response.status);
                    }
                    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
                }
                const rawEtag = response.headers.get('etag');
                etag = rawEtag ? rawEtag.replace(/"/g, '') : `etag_${part.partNumber}`;
                break;
            }
            catch (err) {
                if (err instanceof types_1.VedoraError) {
                    throw err;
                }
                attempt++;
                if (attempt > maxRetries) {
                    throw new types_1.VedoraError(`Failed uploading part ${part.partNumber} after ${maxRetries} retries: ${err.message}`, 'upload', undefined, err);
                }
                // Bounded exponential backoff with jitter (1s, 2s, 4s capped at 8s)
                const delayMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 8000);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        completedParts.push({
            PartNumber: part.partNumber,
            ETag: etag || `etag_${part.partNumber}`,
        });
        uploadedBytes += chunk.size;
        // Safe telemetry calculations
        const elapsedSeconds = Math.max(0.1, (Date.now() - startTime) / 1000);
        const speedBps = Math.round(uploadedBytes / elapsedSeconds);
        const remainingBytes = Math.max(0, file.size - uploadedBytes);
        const etaSeconds = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;
        const percent = Math.min(100, Math.max(0, Math.round((uploadedBytes / file.size) * 100)));
        options?.onProgress?.({
            percent,
            uploadedBytes,
            totalBytes: file.size,
            speedBps,
            etaSeconds,
        });
    }
    return {
        completedParts,
        storageKey: key,
    };
}
//# sourceMappingURL=uploader.js.map