# Vedora Phase 1 — Real FFmpeg Video Transcoding: Implementation & Verification Report

## 1. Executive Summary

Vedora has successfully transitioned from simulated HLS manifest generation to a **real, production-grade FFmpeg video transcoding engine**.

The pipeline now:
1. Probes real input video metadata via `ffprobe` (dimensions, duration, codecs, FPS, and stream topology).
2. Prevents video upscaling (e.g. a 720p source will never generate 1080p).
3. Transcodes video into multi-rendition H.264 video (`libx264`, `preset veryfast`, `crf 23`, `keyint 120`) and AAC audio (`128k`, `44.1kHz`, or `-an` for silent media).
4. Generates genuine RFC 8216 HLS master manifests (`master.m3u8`), variant playlists (`index.m3u8`), and transport stream media segments (`segment_000.ts`).
5. Uploads and stores real playable files with appropriate MIME types (`application/vnd.apple.mpegurl` and `video/mp2t`).
6. Guarantees concurrency protection via Redis distributed locks, atomic status transitions, and automatic temporary workspace cleanup.

---

## 2. Modified & Created Files

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `docs/FFmpeg/README.md` | **Created** | Documentation index for FFmpeg architecture and implementation logs. |
| `docs/FFmpeg/PHASE_1_AUDIT_AND_ARCHITECTURE.md` | **Created** | Comprehensive architectural audit of simulated transcoding and detailed transition plan. |
| `docs/FFmpeg/PHASE_1_IMPLEMENTATION_AND_VERIFICATION.md` | **Created** | This verification report, execution proofs, and manual testing procedures. |
| `services/package.json` | **Updated** | Added `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` runtime dependencies. |
| `services/src/modules/transcoder/ffmpeg.service.ts` | **Created** | Dedicated service for executable discovery, media probing, rendition filtering, and FFmpeg HLS encoding. |
| `services/src/modules/transcoder/ffmpeg.service.spec.ts` | **Created** | 11 unit & integration tests verifying probing, upscaling guards, and HLS generation on synthetic video fixtures. |
| `services/src/modules/transcoder/transcoder-e2e.spec.ts` | **Created** | End-to-end integration tests verifying real fixture processing, output storage, and error fail states. |
| `services/src/modules/transcoder/transcoder.module.ts` | **Updated** | Registered and exported `FfmpegService`. |
| `services/src/modules/transcoder/transcoder.service.ts` | **Updated** | Integrated real FFmpeg execution, Redis distributed locking, workspace cleanup, and accurate byte accounting. |
| `services/src/modules/transcoder/transcoder.service.spec.ts` | **Updated** | Added mock stubs for `setnxWithExpiry` and `del`. |
| `services/src/common/cache-keys.ts` | **Updated** | Added `transcodeLock: (videoId) => string` distributed lock key helper. |
| `services/src/infra/storage/storage.service.ts` | **Updated** | Added `downloadObjectToFile`, `getObjectBuffer`, and path-based HLS streaming support. |
| `services/src/infra/storage/storage.controller.ts` | **Updated** | Added `@Get('hls/*')` endpoint, `video/mp2t` MIME type handling, and CORS headers. |
| `services/src/modules/player-settings/player-settings.service.ts` | **Updated** | Prioritized `master_m3u8_key` when transcoding is completed so players consume genuine HLS streams. |
| `services/Dockerfile` | **Created** | Multi-stage production container build with Alpine system `ffmpeg` pre-installed. |
| `services/docker-compose.yml` | **Updated** | Added optional containerized API and worker service block. |
| `services/.env.example` & `.env.example` | **Updated** | Documented `FFMPEG_PATH` and `FFPROBE_PATH` configuration placeholders. |

---

## 3. Detailed Architectural Implementation

### 3.1 Binary Discovery Strategy
- Primary: Environment variables `FFMPEG_PATH` and `FFPROBE_PATH`.
- Secondary: Self-contained binaries from `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` (automatically resolved on Windows, Linux, and macOS without requiring global PATH edits).
- Tertiary: System PATH (`ffmpeg` and `ffprobe`).

### 3.2 Intelligent Probing & Upscaling Prevention
- `probeMedia(filePath)` executes `ffprobe -v quiet -print_format json -show_format -show_streams`.
- Extracts width, height, duration, FPS, codecs, and audio channel presence.
- `selectRenditions(probe, requestedResolutions)`:
  - If a user uploads a 720p video, `1080p` is filtered out.
  - If a user uploads a 360p video, `720p` and `1080p` are filtered out.
  - If a source video is smaller than standard resolutions (e.g., 240p), it encodes a source-matching custom rendition.

### 3.3 HLS Encoding Parameters
- Video Codec: `libx264`, `preset veryfast`, `crf 23`, `pix_fmt yuv420p`.
- GOP Aligned Keyframes: `-g <fps * segmentDuration> -keyint_min <fps * segmentDuration> -sc_threshold 0` guarantees IDR keyframes at every 4-second segment boundary.
- Audio Codec: `aac -b:a <bitrate> -ac 2` if audio stream exists, or `-an` if source is silent.
- Packaging: `-hls_time 4 -hls_playlist_type vod -hls_flags independent_segments -hls_segment_type mpegts`.

### 3.4 Concurrency & Reliability Guardrails
1. **Distributed Locks**: Uses Redis `SET vedora:transcode:lock:<videoId> locked EX 600 NX` to ensure only one worker processes a given video.
2. **Idempotency**: Skips processing if `video.status === 'ready'` and `video.master_m3u8_key` already exists.
3. **Workspace Isolation**: Each job runs in an isolated temporary directory: `os.tmpdir()/vedora-jobs/<videoId>-<timestamp>`.
4. **Guaranteed Cleanup**: In a `finally` block, the temporary directory is recursively deleted and the Redis lock is released.
5. **Sanitized Error Reporting**: Internal paths and sensitive environment details are redacted before errors are recorded or logged.

### 3.5 Storage & Streaming Delivery
- Real output files are stored under keys:
  - `videos/<videoId>/master.m3u8`
  - `videos/<videoId>/<rendition>/index.m3u8`
  - `videos/<videoId>/<rendition>/segment_000.ts`
- `StorageController` exposes `GET /api/v1/storage/hls/*`:
  - When HLS.js requests `http://localhost:8080/api/v1/storage/hls/videos/<videoId>/master.m3u8`, standard RFC 8216 relative URLs like `720p/index.m3u8` and `segment_000.ts` resolve naturally through browser URI resolution without broken query parameters.
  - Returns `Content-Type: video/mp2t` for `.ts` files and `application/vnd.apple.mpegurl` for playlists.

---

## 4. Test Verification Results

### 4.1 Backend Test Suites
- **Command**: `npm test` inside `services/`
- **Result**:
  - **Suites**: **15 passed, 15 total** (`0` failed, `0` skipped)
  - **Tests**: **109 passed, 109 total** (`0` failed, `0` skipped)
  - **Execution Time**: ~7.5 seconds

### 4.2 SDK Test Suite
- **Command**: `npm test` inside `sdks/vedora-sdk/`
- **Result**: **1 suite passed, 3 tests passed** (`0` failed, `0` skipped)

### 4.3 Frontend Typechecks & Builds
- **Command**: `npx tsc --noEmit` inside `apps/main-dashboard/`
- **Result**: **0 errors**

---

## 5. Manual Verification Procedure

To manually verify real video transcoding from end to end:

1. **Start Infrastructure & Services**:
   ```bash
   # Terminal 1: Start Redis
   cd services
   docker compose up -d

   # Terminal 2: Start API Server
   cd services
   npm run start:dev

   # Terminal 3: Start Dashboard
   cd apps/main-dashboard
   npm run dev -- -p 3001
   ```

2. **Upload a Real Video File**:
   - Open `http://localhost:3001/uploads`.
   - Select an MP4 video file and click Upload.
   - The upload will slice the file into chunks, send them to `/api/v1/storage/mock-upload`, and call `/api/v1/videos/complete`.

3. **Observe Transcoding Logs**:
   - In the API server terminal, observe:
     ```text
     [TranscoderService] Enqueueing transcoding job for video ...
     [TranscoderService] Transcoding video ... started.
     [FfmpegService] Starting FFmpeg HLS transcoding for video ...
     [FfmpegService] FFmpeg HLS transcoding finished successfully ...
     [TranscoderService] FFmpeg transcoding completed successfully ... Status: ready.
     ```

4. **Play Back Real HLS Stream**:
   - Navigate to `http://localhost:3001/my-videos`.
   - Click "Embed Code" or click play on the video player.
   - Open browser DevTools Network tab:
     - Notice `master.m3u8` is fetched (status 200).
     - Notice `720p/index.m3u8` is fetched (status 200).
     - Notice `segment_000.ts`, `segment_001.ts` are fetched with `Content-Type: video/mp2t` (status 200/206).
   - Video plays smoothly with genuine adaptive bitrate switching.
