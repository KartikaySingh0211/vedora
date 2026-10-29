# Vedora Phase 1 — Real FFmpeg Video Transcoding: Audit & Architecture Plan

## 1. Executive Summary & Objective

Vedora is transitioning from a simulated HLS manifest generator to a **production-grade, real FFmpeg-based transcoding pipeline**.

Currently, when a user completes a video upload, Vedora generates synthetic `.m3u8` manifest text files referencing fictitious `.ts` segments without executing video encoding. When the frontend attempts to stream these manifests, missing media segments force the player to fall back to direct raw MP4 playback or sample media.

This document details the complete architectural audit (Phase A), identifies the exact points of simulation, and outlines the step-by-step engineering plan for Phases B, C, D, and E.

---

## 2. Phase A: Detailed Codebase Audit

### 2.1 Video Upload & Initialization Flow
1. **Endpoint**: `POST /api/v1/videos/init` handled by `VideoController.initVideo` and `VideoService.initVideo`.
2. **Quota & Advisory Locks**:
   - Acquires PostgreSQL transaction advisory lock: `SELECT pg_advisory_xact_lock(hashtext(storageQuotaLock(userId)))`.
   - Calculates active user storage and reserves incoming quota (`rawSizeBytes + estimatedTranscodedSize`).
   - Rejects requests that exceed plan storage caps (Free: 500MB/file, 10GB total).
3. **Upload Authorization**:
   - Calls `StorageService.initiateMultipartUpload(bucketId, filename, size, duration)`.
   - In production with active Cloudflare R2 credentials, generates direct S3-compatible multipart upload presigned URLs.
   - In development or fallback mode, creates presigned URLs pointing to `/api/v1/storage/mock-upload`.
4. **Database Record**:
   - Inserts row into `videos` table with status `'uploading'`.

### 2.2 Original Video Storage & Retrieval
1. **Chunk Ingestion**:
   - Slices are uploaded to `StorageController.handleMockUpload`, saving chunks to `storage_local/chunks/${uploadId}_part_${partNum}` with S3-compliant `ETag` headers.
2. **Assembly & Finalization**:
   - `POST /api/v1/videos/complete` invokes `VideoService.completeVideo`.
   - Calls `StorageService.completeMultipartUpload`.
   - Stitches chunks into `storage_local/objects/${storageKey.replace(/[/\\]/g, '_')}`.
   - Updates `videos.status` to `'uploaded'`.
   - Calls `TranscoderService.enqueueTranscodeJob`.

### 2.3 Redis Queue Producer & Worker Architecture
- **Queue Implementation**: The queue does **not** use the `bullmq` npm package; it is a custom FIFO queue built directly on `ioredis` via `RedisService`.
- **Queue Key**: `vedora:transcode:queue`.
- **Producer**: `TranscoderService.enqueueTranscodeJob()` pushes JSON job data using `rpush(QUEUE_KEY, payload)` and triggers `setImmediate(() => this.processNextJob())`.
- **Worker**: `TranscoderService.processNextJob()`:
  - Pops jobs using `this.redisService.lpop(QUEUE_KEY)`.
  - Guarded by an in-memory boolean flag `this.isProcessing = true` (bounding concurrency to 1 active job per server instance).
  - Catches failures, logs errors, and invokes `markVideoFailed(videoId, error)`.
  - In `finally`: resets `isProcessing = false` and checks `llen(QUEUE_KEY)` to trigger the next job.

### 2.4 Where Simulated Transcoding Occurs
Simulated transcoding is localized entirely in `services/src/modules/transcoder/transcoder.service.ts`:
1. **Lines 176–180 (`generateMasterPlaylist`)**: Creates static text lines for `master.m3u8` using hardcoded rendition metadata.
2. **Lines 187–207 (`generateVariantPlaylist`)**: Generates synthetic variant playlists containing `#EXTINF:4.000` tags that point to phantom segment files (`segment_000.ts`, `segment_001.ts`). **Zero `.ts` media segments are encoded or written to disk.**
3. **Lines 199–205**: Calculates `totalTranscodedBytes` via arithmetic formula `Math.floor((totalBitrateBps * duration) / 8)` instead of measuring real encoded byte output.
4. **Lines 220–231**: Updates database status to `'ready'`, setting `master_m3u8_key = videos/${videoId}/master.m3u8` even though playable segments do not exist.

### 2.5 Video Database Schema & Status Transitions
- **Table**: `videos` in Neon PostgreSQL (`services/src/database/schema.ts`).
- **Status Lifecycle (`VideoStatusEnum`)**:
  - `uploading`: Initialized upload session.
  - `uploaded`: Chunks fully assembled on disk/cloud.
  - `processing`: Transcode job popped from Redis queue.
  - `ready`: Real HLS manifests and all media segments generated and verified.
  - `failed`: Terminal failure with error logged; never exposed as ready.
- **Key Columns**:
  - `storage_key`: Original raw video file location.
  - `master_m3u8_key`: Root HLS playlist (`videos/${videoId}/master.m3u8`).
  - `duration`: Video duration in seconds (to be probed accurately by ffprobe).
  - `transcoded_size`: Cumulative bytes of all generated playlists and `.ts` segments.
  - `resolutions`: Requested target resolutions (`jsonb`).

### 2.6 Storage Provider & Local Fallback
- `StorageService.uploadDirectBuffer(key, buffer, contentType)`:
  - Writes buffer to `storage_local/objects/${key.replace(/[/\\]/g, '_')}`.
  - Forwards to cloud storage if API key is active.
- `StorageController.handleStreamVideo`:
  - Currently handles `GET /api/v1/storage/stream?key=...`.
  - Supports HTTP 206 Partial Content range requests for MP4 playback.
  - **Identified HLS Issue**: Sets `Content-Type: video/mp4` for non-m3u8 files, which causes `.ts` segments to be served with the wrong MIME type. It must serve `.ts` files as `video/mp2t`.
  - **Identified Relative Path Issue**: If HLS.js requests `/storage/stream?key=videos/123/master.m3u8`, relative variant playlist URLs (`720p/index.m3u8`) resolve to `/storage/720p/index.m3u8`, stripping the `?key=` query parameter. We must support path-based HLS delivery (`GET /api/v1/storage/hls/*`).

### 2.7 Frontend Player (`VedoraPlayer`)
- File: `apps/main-dashboard/components/player/vedora-player.tsx`.
- Detects `.m3u8` in `effectiveStreamUrl` and mounts `hls.js`.
- If HLS fails, triggers `handlePlaybackFallback` to direct MP4 streaming or MDN sample video.
- With real HLS output and path-based streaming, `hls.js` will play master and variant playlists seamlessly.

### 2.8 Docker & Environment Configuration
- `services/docker-compose.yml` runs Redis 7 Alpine.
- There is currently no backend `Dockerfile` in `services/`.
- FFmpeg is not installed globally on the current Windows host environment, necessitating a self-contained runtime strategy (`@ffmpeg-installer/ffmpeg` + `@ffprobe-installer/ffprobe`) combined with production Dockerfile support (`apk add ffmpeg`).

---

## 3. Proposed Architecture & Implementation Plan

### Phase B: Real FFmpeg Processing Engine

#### 1. Binary Management Strategy
- Install `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` as production dependencies in `services/package.json`.
- Provide environment variable overrides: `FFMPEG_PATH` and `FFPROBE_PATH`.
- Resolution priority:
  1. `process.env.FFMPEG_PATH` (user-configured or container system binary `/usr/bin/ffmpeg`).
  2. `@ffmpeg-installer/ffmpeg` binary path (self-contained, platform-native).
  3. System PATH fallback (`ffmpeg`).

#### 2. Media Probing (`ffprobe`)
Before transcoding, execute `ffprobe` in JSON output mode:
```bash
ffprobe -v quiet -print_format json -show_format -show_streams <input_file>
```
Extract:
- Duration (in seconds, floating-point parsed to integer).
- Video stream: width, height, codec, fps, aspect ratio.
- Audio stream: channels, sample rate, codec (detect if audio is completely absent).

#### 3. Intelligent Rendition Selection (Prevent Upscaling)
Compare source dimensions with standard rendition ladder:
- `360p`: 640x360 (video: 800 kbps, audio: 96 kbps)
- `720p`: 1280x720 (video: 2800 kbps, audio: 128 kbps)
- `1080p`: 1920x1080 (video: 5000 kbps, audio: 192 kbps)

**Rules**:
- Filter out any rendition whose height exceeds the source height (e.g., a 720p source will only transcode to `720p` and `360p`; `1080p` is excluded).
- If source height is below 360p, transcode a single source-matching rendition.

#### 4. Isolated Job Workspace
- Create a dedicated directory: `path.join(os.tmpdir(), 'vedora-jobs', jobId)`.
- Retrieve source video file from `StorageService`:
  - If local fallback: copy/link from `storage_local/objects/${storageKey}`.
  - If cloud: stream to local temp input file.
- Clean up the directory in a `finally` block regardless of success or failure.

#### 5. FFmpeg Command Construction & Execution
For each authorized rendition:
- Video flags: `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p`
- Scaling: `-vf "scale=w:h:force_original_aspect_ratio=decrease,pad=w:h:(ow-iw)/2:(oh-ih)/2"`
- Keyframe interval (GOP): `-g 120 -keyint_min 120 -sc_threshold 0` (guarantees IDR frames aligned with 4-second segments at 30fps).
- Audio flags:
  - If audio stream detected: `-c:a aac -b:a <audioBitrate> -ac 2`
  - If no audio stream (silent source): `-an`
- HLS flags:
  - `-hls_time 4`
  - `-hls_playlist_type vod`
  - `-hls_segment_filename "<renditionDir>/segment_%03d.ts"`
  - `<renditionDir>/index.m3u8`

#### 6. Master Manifest Generation
Generate `master.m3u8` linking the actual generated renditions:
```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2928000,RESOLUTION=1280x720,FRAME-RATE=30
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=640x360,FRAME-RATE=30
360p/index.m3u8
```

#### 7. Output Persistence & Verification
1. Walk the job output directory.
2. Read every `.m3u8` and `.ts` file into buffers.
3. Upload to `StorageService` under keys:
   - `videos/${videoId}/master.m3u8`
   - `videos/${videoId}/${rendition}/index.m3u8`
   - `videos/${videoId}/${rendition}/segment_000.ts`, etc.
4. Verify that:
   - `master.m3u8` exists and has non-zero size.
   - At least one variant `index.m3u8` exists.
   - At least one `.ts` segment exists per variant.
5. Compute exact `transcoded_size` as the sum of all generated output bytes.

---

### Phase C: Reliability & Concurrency

1. **Job Lock & Distributed Safety**:
   - Use Redis key `vedora:transcode:lock:${videoId}` with TTL (e.g., 600s) to prevent concurrent workers from processing the same video simultaneously.
2. **Timeout Enforcement**:
   - Wrap FFmpeg execution with a process timeout (configurable, default 10 minutes).
   - If exceeded, send `SIGKILL` to the child process, mark job failed, and clean up temp workspace.
3. **Idempotency**:
   - If video status is already `'ready'`, worker returns early without reprocessing.
4. **Failure Sanitation**:
   - Internal paths, raw command arguments, and sensitive system details are filtered before writing error messages to the database or returning API errors.
   - Video transitions to `'failed'` status. Quotas and database remain consistent.

---

### Phase D: Storage Delivery & Streaming Endpoint Enhancements

1. **Support Path-Based HLS Route**:
   Add `@Get('hls/*')` endpoint to `StorageController`:
   - URL: `GET /api/v1/storage/hls/videos/:videoId/:subpath(*)`
   - Strips `/api/v1/storage/hls/` prefix to extract storage key.
   - Automatically supports relative URI resolution for `720p/index.m3u8` and `segment_000.ts`.
2. **Correct MIME Types**:
   - `.m3u8`: `application/vnd.apple.mpegurl`
   - `.ts`: `video/mp2t` (critical for Safari, Chrome HLS, and HLS.js)
   - `.mp4`: `video/mp4`
   - `.webm`: `video/webm`
3. **Player Settings Public Endpoint**:
   - In `PlayerSettingsService.getPublicPlayerConfig`:
     - When `video.status === 'ready'` and `video.master_m3u8_key` is set, return the path-based HLS URL:
       `http://localhost:${port}/api/v1/storage/hls/${video.master_m3u8_key}`.

---

### Phase E: Docker & Deployment Readiness

1. **Dockerfile (`services/Dockerfile`)**:
   - Multi-stage build (Node.js 20 Alpine).
   - Installs system `ffmpeg` and `ffprobe` via `apk add --no-cache ffmpeg`.
   - Runs compiled NestJS bundle.
2. **Documentation**:
   - Update `services/.env.example` with `FFMPEG_PATH` and `FFPROBE_PATH` placeholders.
   - Retain CPU-based encoding (zero GPU hardware requirements).

---

### Phase F: Verification & Testing Suite

1. **Test Fixtures**:
   - Generate a micro-fixture (1-second 320x240 synthesized test MP4 video) programmatically or using a lightweight fixture file in `services/test/fixtures/`.
2. **Automated Unit & Integration Tests**:
   - `ffmpeg.service.spec.ts`:
     - Probing metadata from valid video.
     - Detecting missing audio vs stereo audio.
     - Handling non-existent / corrupt file (graceful error, no process hang).
     - Timeout handling and cleanup.
   - `transcoder.service.spec.ts`:
     - Full pipeline run: raw video -> HLS master playlist + variant playlists + media segments on disk.
     - Idempotency test (skips video if already ready).
     - Upscaling prevention test (720p source does not produce 1080p).
     - Storage upload and status transition to `ready`.
3. **Regressions Check**:
   - Verify all 96 existing backend test suites pass.
   - Verify TypeScript compilation (`npm run build`).
