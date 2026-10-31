import {
  StorageInitiateData,
  CompletedPart,
  UploadOptions,
  VedoraError,
} from './types';

export interface UploadPartsResult {
  completedParts: CompletedPart[];
  storageKey: string;
}

/**
 * Upload file parts directly to cloud storage presigned endpoints
 * Does not proxy video payloads through the backend API
 */
export async function uploadFileDirectly(
  file: File | Blob,
  uploadData: StorageInitiateData,
  options?: UploadOptions,
): Promise<UploadPartsResult> {
  if (!file || file.size <= 0) {
    throw new VedoraError('File cannot be empty', 'upload');
  }

  const { parts, partSize, key } = uploadData;
  if (!parts || parts.length === 0) {
    throw new VedoraError('No upload parts provided by storage provider', 'upload');
  }

  const completedParts: CompletedPart[] = [];
  let uploadedBytes = 0;
  const startTime = Date.now();
  const maxRetries = options?.maxRetries ?? 3;

  // Track already uploaded parts to allow chunk resumption without duplicate network transfers.
  // Validate caller-supplied parts: require integer PartNumber within valid range and non-empty ETag.
  const existingPartsMap = new Map<number, string>();
  const validPartNumbers = new Set(parts.map((p) => p.partNumber));

  if (options?.existingParts && Array.isArray(options.existingParts)) {
    for (const p of options.existingParts) {
      if (
        p &&
        typeof p.PartNumber === 'number' &&
        Number.isInteger(p.PartNumber) &&
        validPartNumbers.has(p.PartNumber) &&
        typeof p.ETag === 'string' &&
        p.ETag.trim().length > 0
      ) {
        existingPartsMap.set(p.PartNumber, p.ETag.trim());
      }
    }
  }

  for (const part of parts) {
    if (options?.signal?.aborted) {
      throw new VedoraError('Upload cancelled by user', 'upload');
    }

    const start = (part.partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);

    // If chunk was already completed in a previous attempt, reuse its ETag and skip upload
    if (existingPartsMap.has(part.partNumber)) {
      const existingEtag = existingPartsMap.get(part.partNumber)!;
      completedParts.push({
        PartNumber: part.partNumber,
        ETag: existingEtag,
      });
      uploadedBytes += chunk.size;
      continue;
    }

    let attempt = 0;
    let etag: string | null = null;

    while (attempt <= maxRetries) {
      if (options?.signal?.aborted) {
        throw new VedoraError('Upload cancelled by user', 'upload');
      }

      try {
        const response = await fetch(part.url, {
          method: 'PUT',
          body: chunk,
          signal: options?.signal,
        });

        if (!response.ok) {
          // Do not retry 4xx client errors (unauthorized, quota, bad request)
          if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 408 &&
            response.status !== 429
          ) {
            throw new VedoraError(
              `Cloud storage rejected part ${part.partNumber} with HTTP ${response.status}`,
              'upload',
              response.status,
            );
          }
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }

        const rawEtag = response.headers.get('etag');
        etag = rawEtag ? rawEtag.replace(/"/g, '') : `etag_${part.partNumber}`;
        break;
      } catch (err: unknown) {
        if (err instanceof VedoraError) {
          throw err;
        }

        // If fetch was aborted via AbortSignal, throw immediately without retrying
        if (options?.signal?.aborted || (err as Error)?.name === 'AbortError') {
          throw new VedoraError('Upload cancelled by user', 'upload');
        }

        attempt++;
        if (attempt > maxRetries) {
          throw new VedoraError(
            `Failed uploading part ${part.partNumber} after ${maxRetries} retries: ${(err as Error).message}`,
            'upload',
            undefined,
            err,
          );
        }

        // Bounded exponential backoff with jitter
        const isTest = (globalThis as any).process?.env?.NODE_ENV === 'test';
        const baseDelay = isTest ? 5 : 1000;
        const delayMs = Math.min(
          baseDelay * Math.pow(2, attempt) + Math.random() * (isTest ? 2 : 200),
          8000,
        );
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
    const percent = Math.min(
      100,
      Math.max(0, Math.round((uploadedBytes / file.size) * 100)),
    );

    options?.onProgress?.({
      percent,
      uploadedBytes,
      totalBytes: file.size,
      speedBps,
      etaSeconds,
    });
  }

  completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

  return {
    completedParts,
    storageKey: key,
  };
}
