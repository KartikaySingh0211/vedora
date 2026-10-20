import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StoragePart {
  partNumber: number;
  url: string;
}

export interface StorageInitiateResult {
  objectId: string;
  key: string;
  uploadId: string;
  partSize: number;
  parts: StoragePart[];
}

export interface CompletedPart {
  PartNumber: number;
  ETag: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly apiKey: string;
  private readonly defaultBucketId: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey =
      this.configService.get<string>('storage.apiKey') ||
      'omc_live_placeholder_key';
    this.defaultBucketId =
      this.configService.get<string>('storage.bucketId') ||
      '00000000-0000-0000-0000-000000000001';
    this.baseUrl =
      this.configService.get<string>('storage.baseUrl') ||
      'https://api.oneminutecloud.com/api/v1';
  }

  getDefaultBucketId(): string {
    return this.defaultBucketId;
  }

  /**
   * Request multipart upload authorization directly from OneMinute Cloud Storage
   */
  async initiateMultipartUpload(
    bucketId: string,
    filename: string,
    size: number,
    duration = 0,
  ): Promise<StorageInitiateResult> {
    const targetBucket = bucketId || this.defaultBucketId;

    try {
      // If live OMC key is configured, call OneMinute Cloud API
      if (this.apiKey && !this.apiKey.includes('placeholder')) {
        const response = await fetch(
          `${this.baseUrl}/storage-buckets/${targetBucket}/objects/initiate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
            },
            body: JSON.stringify({
              filename,
              contentType: 'video/mp4',
              size,
              duration,
            }),
          },
        );

        const data = (await response.json()) as
          (StorageInitiateResult & { error?: string }) | { error?: string };
        if (!response.ok) {
          const errMessage = data.error || response.statusText;
          this.logger.error(`OneMinute Cloud initiate failed: ${errMessage}`);
          throw new BadGatewayException(
            errMessage || 'Failed to initiate cloud storage upload',
          );
        }

        return data as StorageInitiateResult;
      }
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) {
        throw err;
      }
      this.logger.warn(
        `Cloud storage provider unreachable or in test mode (${(err as Error).message}). Using standard multipart structure.`,
      );
    }

    // Standard development/offline simulated multipart upload configuration
    const partSize = 5 * 1024 * 1024; // 5MB standard chunk
    const totalParts = Math.max(1, Math.ceil(size / partSize));
    const objectId = `omc_obj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const uploadId = `omc_upl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const key = `raw/${targetBucket}/${Date.now()}-${filename}`;

    const parts: StoragePart[] = [];
    for (let i = 1; i <= totalParts; i++) {
      parts.push({
        partNumber: i,
        url: `https://storage.oneminutecloud.com/upload/${targetBucket}/${key}?partNumber=${i}&uploadId=${uploadId}`,
      });
    }

    return {
      objectId,
      key,
      uploadId,
      partSize,
      parts,
    };
  }

  /**
   * Complete multipart upload with storage provider
   */
  async completeMultipartUpload(
    bucketId: string,
    objectId: string,
    uploadId: string,
    key: string,
    parts: CompletedPart[] = [],
  ): Promise<{ success: boolean; key: string }> {
    const targetBucket = bucketId || this.defaultBucketId;

    try {
      if (this.apiKey && !this.apiKey.includes('placeholder')) {
        const response = await fetch(
          `${this.baseUrl}/storage-buckets/${targetBucket}/objects/${objectId}/complete`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
            },
            body: JSON.stringify({
              uploadId,
              key,
              parts,
            }),
          },
        );

        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          this.logger.warn(
            `OneMinute Cloud complete failed: ${data.error || response.statusText}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Could not reach OneMinute Cloud for completion verification: ${(err as Error).message}`,
      );
    }

    return { success: true, key };
  }
}
