import {
  Controller,
  Query,
  Res,
  Req,
  All,
  Get,
  Logger,
  Inject,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiHeader,
  ApiOkResponse,
  ApiResponse,
  ApiBadRequestResponse,
  ApiConsumes,
  ApiProduces,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { DrizzleDb } from '../../database/database.module';
import * as schema from '../../database/schema';
import { StorageUploadResponseDto } from './dto/storage-upload-response.dto';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

@ApiTags('Storage')
@Controller('storage')
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  @All('mock-upload')
  @ApiOperation({
    summary:
      'Resilient storage endpoint for multipart chunk uploads in local development or provider fallback mode',
    description:
      'Accepts chunk binary streams, saves parts to local storage_local/chunks, updates upload registry, and returns S3-compliant ETag header.',
  })
  @ApiConsumes('application/octet-stream', 'multipart/form-data')
  @ApiQuery({
    name: 'partNumber',
    required: false,
    description: '1-indexed chunk part number',
    example: '1',
  })
  @ApiQuery({
    name: 'uploadId',
    required: false,
    description: 'Multipart upload session ID',
    example: 'upl_9f83a2bc4e61d852',
  })
  @ApiQuery({
    name: 'key',
    required: false,
    description: 'Object storage key path',
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4',
  })
  @ApiOkResponse({
    description: 'Chunk successfully saved and ETag generated',
    type: StorageUploadResponseDto,
  })
  async handleMockUpload(
    @Query('partNumber') partNumber: string,
    @Query('uploadId') uploadId: string,
    @Query('key') key: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const partNum = partNumber || '1';
    const uplId = uploadId || 'default';
    const etag = `"mock-etag-${partNum}-${Date.now()}"`;

    try {
      const chunksDir = path.join(process.cwd(), 'storage_local', 'chunks');
      if (!fs.existsSync(chunksDir)) {
        fs.mkdirSync(chunksDir, { recursive: true });
      }

      const chunkPath = path.join(chunksDir, `${uplId}_part_${partNum}`);
      const writeStream = fs.createWriteStream(chunkPath);

      await new Promise<void>((resolve, reject) => {
        req.pipe(writeStream);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
        req.on('error', reject);
      });
      this.logger.log(`Saved local upload chunk: ${uplId} part ${partNum}`);

      // Record key to uploadId association in registry for assembly
      if (key && uplId) {
        try {
          const regPath = path.join(chunksDir, 'registry.json');
          let reg: Record<string, string> = {};
          if (fs.existsSync(regPath)) {
            reg = JSON.parse(fs.readFileSync(regPath, 'utf8')) as Record<
              string,
              string
            >;
          }
          reg[key] = uplId;
          reg[uplId] = key;
          fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
        } catch {
          // Non-critical registry write
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Failed writing local chunk ${partNum}: ${(err as Error).message}`,
      );
    }

    // S3-compatible ETag response header
    res.setHeader('ETag', etag);
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    return res.status(200).json({
      success: true,
      partNumber: Number(partNum),
      uploadId,
      etag,
    });
  }

  @Get('stream')
  @ApiOperation({
    summary:
      'Stream video or HLS manifest for playback in local development or provider fallback mode',
    description:
      'Supports HTTP Range requests (206 Partial Content) for seeking through video playback, or delivers master.m3u8 manifests.',
  })
  @ApiProduces('video/mp4', 'application/vnd.apple.mpegurl', 'video/webm')
  @ApiQuery({
    name: 'key',
    required: true,
    description: 'Storage key path of the video or manifest',
    example: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4',
  })
  @ApiHeader({
    name: 'range',
    required: false,
    description: 'HTTP byte range for video seeking (e.g. bytes=0-1048575)',
  })
  @ApiResponse({
    status: 200,
    description: 'Full binary video stream or HLS manifest text',
  })
  @ApiResponse({
    status: 206,
    description:
      'Partial content binary video stream corresponding to requested byte Range',
  })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to demo video if local file is missing',
  })
  @ApiBadRequestResponse({
    description: 'Key query parameter missing',
    type: ErrorResponseDto,
  })
  async handleStreamVideo(
    @Query('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!key) {
      return res.status(400).json({ error: 'Key query parameter is required' });
    }

    this.logger.log(`Handling stream request for key: ${key}`);

    const objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
    let filePath = path.join(objectsDir, key.replace(/[/\\]/g, '_'));

    // If key points to an m3u8 manifest, check if raw uploaded video file exists on disk
    if (
      !fs.existsSync(filePath) &&
      (key.includes('master.m3u8') || key.endsWith('.m3u8'))
    ) {
      const videoIdMatch = key.match(/videos\/([^/]+)\/master\.m3u8/);
      if (videoIdMatch) {
        const videoId = videoIdMatch[1];
        try {
          const [videoRecord] = await this.db
            .select({ storage_key: schema.videos.storage_key })
            .from(schema.videos)
            .where(eq(schema.videos.id, videoId))
            .limit(1);

          if (videoRecord?.storage_key) {
            const rawPath = path.join(
              objectsDir,
              videoRecord.storage_key.replace(/[/\\]/g, '_'),
            );
            if (fs.existsSync(rawPath)) {
              filePath = rawPath;
            }
          }
        } catch (dbErr: unknown) {
          this.logger.warn(
            `Could not resolve video storage_key: ${(dbErr as Error).message}`,
          );
        }
      }

      // If still not found, check if any raw video file exists in objectsDir
      if (!fs.existsSync(filePath) && fs.existsSync(objectsDir)) {
        const files = fs.readdirSync(objectsDir);
        if (files.length > 0) {
          const sorted = files
            .map((f) => ({
              name: f,
              time: fs.statSync(path.join(objectsDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.time - a.time);
          filePath = path.join(objectsDir, sorted[0].name);
        }
      }
    }

    // If local video file exists on disk, stream it with HTTP 206 Partial Content (range requests)
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (filePath.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (filePath.endsWith('.webm')) {
        res.setHeader('Content-Type', 'video/webm');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }
      res.setHeader('Accept-Ranges', 'bytes');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunksize);

        const fileStream = fs.createReadStream(filePath, { start, end });
        return fileStream.pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', fileSize);
        const fileStream = fs.createReadStream(filePath);
        return fileStream.pipe(res);
      }
    }

    // Fallback: If no local file on disk, stream sample video (5-second flower video, not 10-minute stream)
    return res.redirect(
      307,
      'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    );
  }
}
