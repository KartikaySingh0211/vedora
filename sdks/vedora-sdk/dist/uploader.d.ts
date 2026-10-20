import { StorageInitiateData, CompletedPart, UploadOptions } from './types';
export interface UploadPartsResult {
    completedParts: CompletedPart[];
    storageKey: string;
}
/**
 * Upload file parts directly to cloud storage presigned endpoints
 * Does not proxy video payloads through the backend API
 */
export declare function uploadFileDirectly(file: File | Blob, uploadData: StorageInitiateData, options?: UploadOptions): Promise<UploadPartsResult>;
//# sourceMappingURL=uploader.d.ts.map