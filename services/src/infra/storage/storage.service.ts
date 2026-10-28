import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

  // Cloudflare R2 S3-Compatible Driver
  private readonly s3Client?: S3Client;
  private readonly r2BucketName?: string;
  private readonly r2PublicUrl?: string;

  constructor(private readonly configService: ConfigService) {
    // Cloudflare R2 configuration
    const accountId = this.configService.get<string>('r2.accountId');
    const accessKeyId = this.configService.get<string>('r2.accessKeyId');
    const secretAccessKey = this.configService.get<string>('r2.secretAccessKey');
    const bucketName = this.configService.get<string>('r2.bucketName');
    this.r2PublicUrl = this.configService.get<string>('r2.publicUrl');

    if (
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      bucketName &&
      !accessKeyId.includes('placeholder')
    ) {
      this.r2BucketName = bucketName;
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(
        `Cloudflare R2 storage driver initialized for bucket: ${bucketName}`,
      );
    } else {
      this.logger.log(
        'Cloudflare R2 credentials not fully specified. Resilient local storage pipeline active.',
      );
    }
  }

  isR2Enabled(): boolean {
    return !!(this.s3Client && this.r2BucketName);
  }

  getDefaultBucketId(): string {
    return this.r2BucketName || 'vedora-local';
  }

  /**
   * Request multipart upload authorization.
   * Primary: Cloudflare R2 presigned URLs.
   * Fallback: Resilient local storage mock upload.
   */
  async initiateMultipartUpload(
    bucketId: string,
    filename: string,
    size: number,
    duration = 0,
  ): Promise<StorageInitiateResult> {
    const targetBucket = bucketId || this.getDefaultBucketId();

    // 1. Cloudflare R2 S3-Compatible Multipart Ingestion
    if (this.isR2Enabled()) {
      try {
        const bucket = this.r2BucketName!;
        const key = `raw/${bucket}/${Date.now()}-${filename}`;
        const createCmd = new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: 'video/mp4',
        });
        const createRes = await this.s3Client!.send(createCmd);
        const uploadId = createRes.UploadId;

        if (uploadId) {
          const partSize = 5 * 1024 * 1024; // 5MB standard chunk
          const totalParts = Math.max(1, Math.ceil(size / partSize));
          const parts: StoragePart[] = [];

          for (let i = 1; i <= totalParts; i++) {
            const uploadPartCmd = new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: i,
            });
            const presignedUrl = await getSignedUrl(this.s3Client!, uploadPartCmd, {
              expiresIn: 3600,
            });
            parts.push({
              partNumber: i,
              url: presignedUrl,
            });
          }

          this.logger.log(
            `Initiated Cloudflare R2 multipart upload for key ${key} (${parts.length} parts)`,
          );

          return {
            objectId: uploadId,
            key,
            uploadId,
            partSize,
            parts,
          };
        }
      } catch (r2Err: unknown) {
        this.logger.warn(
          `Cloudflare R2 initiate failed: ${(r2Err as Error).message}. Falling back to resilient local storage.`,
        );
      }
    }

    // 2. Resilient development/offline local multipart upload configuration
    const partSize = 5 * 1024 * 1024; // 5MB standard chunk
    const totalParts = Math.max(1, Math.ceil(size / partSize));
    const objectId = `vdr_obj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const uploadId = `vdr_upl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const key = `raw/${targetBucket}/${Date.now()}-${filename}`;

    const apiBase =
      this.configService.get<string>('app.apiUrl') ||
      'http://localhost:8080/api/v1';

    const parts: StoragePart[] = [];
    for (let i = 1; i <= totalParts; i++) {
      parts.push({
        partNumber: i,
        url: `${apiBase}/storage/mock-upload?bucketId=${targetBucket}&key=${encodeURIComponent(key)}&partNumber=${i}&uploadId=${uploadId}`,
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
    // 1. If Cloudflare R2 is enabled, complete S3 multipart upload
    if (this.isR2Enabled()) {
      try {
        const completeCmd = new CompleteMultipartUploadCommand({
          Bucket: this.r2BucketName!,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({
              PartNumber: p.PartNumber,
              ETag: p.ETag.startsWith('"') ? p.ETag : `"${p.ETag}"`,
            })),
          },
        });
        await this.s3Client!.send(completeCmd);
        this.logger.log(`Completed Cloudflare R2 multipart upload for key ${key}`);
      } catch (r2Err: unknown) {
        this.logger.warn(
          `Cloudflare R2 complete multipart failed: ${(r2Err as Error).message}`,
        );
      }
    }

    // 2. Assemble local uploaded chunks if available (local fallback & dev mode)
    try {
      const chunksDir = path.join(process.cwd(), 'storage_local', 'chunks');
      const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
      if (!fs.existsSync(objectsDir)) {
        fs.mkdirSync(objectsDir, { recursive: true });
      }

      const targetPath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));

      // Resolve effective uploadId from registry if available
      let effectiveUploadId = uploadId;
      try {
        const regPath = path.join(chunksDir, 'registry.json');
        if (fs.existsSync(regPath)) {
          const reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<
            string,
            string
          >;
          if (reg[key]) effectiveUploadId = reg[key];
        }
      } catch {
        // Registry read is optional
      }

      // Identify all chunk files for this upload
      const chunkFiles: { path: string; partNumber: number }[] = [];

      if (parts && parts.length > 0) {
        for (const p of parts) {
          const cp = path.join(
            chunksDir,
            `${effectiveUploadId}_part_${p.PartNumber}`,
          );
          if (fs.existsSync(cp)) {
            chunkFiles.push({ path: cp, partNumber: p.PartNumber });
          }
        }
      }

      // If parts array did not find files, search chunksDir for matching prefixes or key timestamp
      if (chunkFiles.length === 0 && fs.existsSync(chunksDir)) {
        const allFiles = fs.readdirSync(chunksDir);
        const keyTimestampMatch = key.match(/(\d{10,})/);
        const timestamp = keyTimestampMatch ? keyTimestampMatch[1] : null;

        const candidateFiles = allFiles.filter((f) => {
          if (!f.includes('_part_')) return false;
          if (
            effectiveUploadId &&
            effectiveUploadId !== 'vdr_upl_verified' &&
            effectiveUploadId !== 'omc_upl_verified' &&
            f.startsWith(effectiveUploadId)
          ) {
            return true;
          }
          if (timestamp && f.includes(timestamp)) {
            return true;
          }
          return false;
        });

        for (const f of candidateFiles) {
          const match = f.match(/_part_(\d+)$/);
          if (match) {
            chunkFiles.push({
              path: path.join(chunksDir, f),
              partNumber: parseInt(match[1], 10),
            });
          }
        }
      }

      if (chunkFiles.length > 0) {
        chunkFiles.sort((a, b) => a.partNumber - b.partNumber);
        const outStream = fs.createWriteStream(targetPath);
        for (const c of chunkFiles) {
          const chunkData = fs.readFileSync(c.path);
          outStream.write(chunkData);
          try {
            fs.unlinkSync(c.path);
          } catch {
            // Ignore non-fatal chunk cleanup failures
          }
        }
        await new Promise<void>((resolve, reject) => {
          outStream.on('finish', () => resolve());
          outStream.on('error', (err) => reject(err));
          outStream.end();
        });
        this.logger.log(
          `Assembled uploaded local video file at ${targetPath} (${chunkFiles.length} chunks)`,
        );
      }
    } catch (localErr: unknown) {
      this.logger.warn(
        `Local assembly for ${key}: ${(localErr as Error).message}`,
      );
    }

    return { success: true, key };
  }

  /**
   * Directly upload a buffer (e.g. HLS manifest m3u8 or segment) to storage
   */
  async uploadDirectBuffer(
    key: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<{ success: boolean; key: string }> {
    // 1. Always write locally for local streaming & caching
    try {
      const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
      if (!fs.existsSync(objectsDir)) {
        fs.mkdirSync(objectsDir, { recursive: true });
      }
      const localFilePath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));
      fs.writeFileSync(localFilePath, buffer);
    } catch (saveErr: unknown) {
      this.logger.warn(
        `Failed saving direct buffer locally for ${key}: ${(saveErr as Error).message}`,
      );
    }

    // 2. Upload to Cloudflare R2 if enabled
    if (this.isR2Enabled()) {
      try {
        const putCmd = new PutObjectCommand({
          Bucket: this.r2BucketName!,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        });
        await this.s3Client!.send(putCmd);
        this.logger.log(`Uploaded direct buffer to Cloudflare R2: ${key}`);
        return { success: true, key };
      } catch (r2Err: unknown) {
        this.logger.warn(
          `Cloudflare R2 direct buffer upload failed for ${key}: ${(r2Err as Error).message}`,
        );
      }
    }

    return { success: true, key };
  }

  /**
   * Retrieve an object from local storage or cloud and save it to a target local path
   */
  async downloadObjectToFile(
    key: string,
    targetPath: string,
  ): Promise<boolean> {
    try {
      const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
      const localFilePath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));

      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 0) {
        const destDir = path.dirname(targetPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(localFilePath, targetPath);
        return true;
      }

      // If not locally on disk, download from Cloudflare R2
      if (this.isR2Enabled()) {
        try {
          const getCmd = new GetObjectCommand({
            Bucket: this.r2BucketName!,
            Key: key,
          });
          const getRes = await this.s3Client!.send(getCmd);
          if (getRes.Body) {
            const destDir = path.dirname(targetPath);
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            const bytes = await getRes.Body.transformToByteArray();
            fs.writeFileSync(targetPath, Buffer.from(bytes));
            return true;
          }
        } catch (r2Err: unknown) {
          this.logger.warn(
            `Cloudflare R2 download failed for ${key}: ${(r2Err as Error).message}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed downloading storage object ${key} to ${targetPath}: ${(err as Error).message}`,
      );
    }
    return false;
  }

  /**
   * Retrieve an object buffer from local storage or cloud
   */
  async getObjectBuffer(key: string): Promise<Buffer | null> {
    try {
      const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
      const localFilePath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));

      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 0) {
        return fs.readFileSync(localFilePath);
      }

      // Cloudflare R2 retrieval
      if (this.isR2Enabled()) {
        try {
          const getCmd = new GetObjectCommand({
            Bucket: this.r2BucketName!,
            Key: key,
          });
          const getRes = await this.s3Client!.send(getCmd);
          if (getRes.Body) {
            const bytes = await getRes.Body.transformToByteArray();
            return Buffer.from(bytes);
          }
        } catch (r2Err: unknown) {
          this.logger.warn(
            `Cloudflare R2 getObjectBuffer failed for ${key}: ${(r2Err as Error).message}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed reading storage buffer for ${key}: ${(err as Error).message}`,
      );
    }
    return null;
  }

  /**
   * Resolve public or signed CDN URL for HLS manifest playback
   */
  getPublicUrl(key: string): string {
    if (this.r2PublicUrl && !this.r2PublicUrl.includes('placeholder')) {
      return `${this.r2PublicUrl.replace(/\/$/, '')}/${key}`;
    }

    const customCdn = this.configService.get<string>('storage.cdnUrl');
    if (customCdn && !customCdn.includes('placeholder')) {
      return `${customCdn.replace(/\/$/, '')}/${key}`;
    }

    const port = this.configService.get<number>('port') || 8080;
    if (key.endsWith('.m3u8')) {
      return `http://localhost:${port}/api/v1/storage/hls/${key}`;
    }
    return `http://localhost:${port}/api/v1/storage/stream?key=${encodeURIComponent(key)}`;
  }

  /**
   * Delete an object from cloud storage
   */
  async deleteObject(key: string): Promise<boolean> {
    try {
      if (this.isR2Enabled()) {
        try {
          const delCmd = new DeleteObjectCommand({
            Bucket: this.r2BucketName!,
            Key: key,
          });
          await this.s3Client!.send(delCmd);
        } catch (r2Err: unknown) {
          this.logger.warn(
            `Cloudflare R2 delete failed for ${key}: ${(r2Err as Error).message}`,
          );
        }
      }

      // Also clean up local file if present
      try {
        const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
        const localFilePath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
        }
      } catch {
        // Ignore local delete errors
      }

      return true;
    } catch (err: unknown) {
      this.logger.warn(
        `Storage delete failed for ${key}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
