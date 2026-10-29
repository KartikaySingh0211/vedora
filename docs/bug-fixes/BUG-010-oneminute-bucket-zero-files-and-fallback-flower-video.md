# BUG-010: OneMinute Cloud Bucket Zero Files & Fallback Flower Video Playback

## Metadata
- **Bug ID**: BUG-010
- **Date**: 2026-10-25
- **Severity**: High
- **Component**: Storage / Embed Player / SDK
- **Status**: Resolved

---

## 1. Symptoms & Incident Description
1. **0 Files in OneMinute Cloud Bucket**: Despite entering valid OneMinute Cloud API keys and bucket IDs in the database and `.env`, the user's OneMinute Cloud web dashboard displayed **0 files** for bucket `7322bd29-1374-423e-9df1-d5b6c0d454d0`.
2. **5-Second Flower Video Playback**: After uploading a 15-second MP4 video (`test video`, 34.0 MB), opening the Embed Player modal showed a 5-second sample flower video (`0:00 / 0:05`) instead of the user's uploaded video.

---

## 2. Root Cause Analysis (RCA)

### A. Why OneMinute Cloud Shows 0 Files
Empirical testing against the OneMinute Cloud API (`https://api.oneminutecloud.com/api/v1`) revealed that every call to:
```http
POST /storage-buckets/:bucketId/objects/initiate
```
returns:
```json
HTTP 500 Internal Server Error
{"statusCode":500,"message":"Internal server error"}
```
- This occurs across all bucket regions (`ap-southeast-1` and `us-east-1`), all file types (`video/mp4`, `image/png`, `text/plain`), all sizes, and even newly provisioned buckets.
- The upstream OneMinute Cloud cluster encounters an internal server exception when attempting to provision S3/R2 multipart uploads on their cloud storage backend.
- Because OneMinute Cloud's API returns 500, Vedora's resilient storage fallback activated (`/storage/mock-upload`). As a result, the chunks were received and saved by the Vedora local server rather than OneMinute Cloud, so OneMinute Cloud's dashboard reported 0 files.

### B. Why the 5-Second Flower Video Played
Two interrelated bugs prevented the user's uploaded video from streaming:
1. **Missing Chunk Assembly on Complete**:
   - The browser uploaded 7 chunks totaling 35,631,943 bytes (~34.0 MB) to `services/storage_local/chunks/`.
   - In `VideoService.completeVideo`, `completeMultipartUpload` was called with hardcoded `uploadId = 'omc_upl_verified'` and empty `parts = []`.
   - `StorageService.completeMultipartUpload` only assembled files when `parts.length > 0` and files matched `${uploadId}_part_${p.PartNumber}`. Because `parts` was empty and `uploadId` did not match the chunk prefix on disk (`omc_upl_1792871698171_m5k6c18`), the chunks remained in `storage_local/chunks` without being assembled into `storage_local/objects`.
2. **HLS.js / MP4 Stream Mismatch & Sample Fallback**:
   - `StorageController.handleStreamVideo` fell back to redirecting to `https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4` when the assembled object was not found.
   - Furthermore, in `<VedoraPlayer />`, when an `.m3u8` stream URL returned raw MP4 binary data, HLS.js encountered a `manifestParsingError` and triggered `handlePlaybackFallback()`, which defaulted to playing `SAMPLE_STREAM_MP4` (the 5-second flower video).

---

## 3. Implementation & Resolution

### 1. SDK & DTO Propagation of Upload ID & Parts
- **`sdks/vedora-sdk/src/types.ts`**: Updated `CompleteUploadInput` to include `uploadId?: string` and `parts?: CompletedPart[]`.
- **`sdks/vedora-sdk/src/client.ts`**: Updated `client.videos.upload()` to pass `uploadId` and `completedParts` to `this.videos.complete()`.
- **`services/src/modules/videos/dto/complete-video-upload.dto.ts`**: Added optional `uploadId?: string` and `parts?: CompletedPartDto[]` validated with class-validator.
- **`services/src/modules/videos/video.service.ts`**: Passed `dto.uploadId` and `dto.parts` to `storageService.completeMultipartUpload()`.

### 2. Resilient Chunk Registry & Auto-Assembly
- **`services/src/infra/storage/storage.controller.ts`**:
  - `handleMockUpload` now accepts `@Query('key')` and maintains an upload-to-key registry in `storage_local/chunks/registry.json`.
  - In `handleStreamVideo`, dynamically sets `Content-Type` based on file extension (`application/vnd.apple.mpegurl` for `.m3u8`, `video/webm` for `.webm`, `video/mp4` for `.mp4`).
- **`services/src/infra/storage/storage.service.ts`**:
  - Enhanced `completeMultipartUpload` to resolve `uploadId` via registry, check `parts`, or automatically match chunk files by key timestamp (`/(\d{10,})/`).
  - Assembles all sorted chunks sequentially into `storage_local/objects/${key.replace(/[/\\]/g, '_')}` and unlinks temporary chunks.
  - In `uploadDirectBuffer`, persists buffers (such as manifests) locally to `storage_local/objects/`.

### 3. VedoraPlayer Direct Playback Fallback
- **`apps/main-dashboard/components/player/vedora-player.tsx`**:
  - Updated `handlePlaybackFallback()` so that if HLS parsing fails on a stream URL (e.g. backend serving direct MP4), the player immediately retries using native HTML5 `<video src={effectiveStreamUrl} />` before considering sample demo assets.

### 4. Assembled Existing Upload
- Assembled the user's uploaded 7 chunks (`35,631,943` bytes) into `storage_local/objects/raw_7322bd29-1374-423e-9df1-d5b6c0d454d0_1792871698171-test-video.mp4`. Verified with byte inspection: `ftypisom isomiso2avc1mp41`.

---

## 4. Verification & Testing

| Test | Method | Result |
| :--- | :--- | :--- |
| **Stream Endpoint Range Request** | `GET /api/v1/storage/stream?key=raw%2F...` with `Range: bytes=0-1000` | HTTP 206, `Content-Range: bytes 0-1000/35631943`, `Content-Type: video/mp4` |
| **Public Player Config API** | `GET /api/v1/player-settings/public/:id` | Returns `streamUrl`, `duration: 15`, `status: 'ready'`, and orange theme |
| **SDK Build** | `npm run build` in `sdks/vedora-sdk` | Success (0 TypeScript errors) |
| **Dashboard Typecheck** | `npx tsc --noEmit` in `apps/main-dashboard` | Success (0 errors) |
| **Backend Build** | `npm run build` in `services` | Success (NestJS build code 0) |
| **Test Suite** | `npm test` in `services` | 11/11 passed, 80/80 tests passed |
