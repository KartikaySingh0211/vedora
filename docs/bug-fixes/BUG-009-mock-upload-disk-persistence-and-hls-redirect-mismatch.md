# Bug Fix: BUG-009 — Discarded Mock Upload Payloads & Unexpected 10-Minute Video Playback

## 1. Metadata
- **Bug ID**: `BUG-009`
- **Date**: 2026-10-25
- **Severity**: High (Video content & duration mismatch in embedded player)
- **Component**: Fullstack / Storage (`StorageController`, `StorageService`, `PlayerSettingsService`)
- **Status**: Resolved
- **Impacted Files**:
  - `services/src/infra/storage/storage.controller.ts`
  - `services/src/infra/storage/storage.service.ts`
  - `services/src/modules/player-settings/player-settings.service.ts`
  - `services/src/modules/player-settings/player-settings.service.spec.ts`
  - `docs/bug-fixes/README.md`

---

## 2. Problem Statement & User Symptoms
1. **0 Files in OneMinute Cloud Buckets**:
   - The user noticed that even though the upload showed as successful in the dashboard and the bucket ID matched the database, the OneMinute Cloud bucket web console showed 0 files.
2. **Unexpected 10-Minute Video**:
   - The user uploaded a 15-second video, but when opening the embedded video player, a 10-minute 34-second video (Big Buck Bunny) played instead of their uploaded video.

---

## 3. Root Cause Analysis (RCA)

### Why OneMinute Cloud Shows 0 Files
1. **Upstream 500 on OneMinute Cloud `initiate`**:
   - Every call to `POST https://api.oneminutecloud.com/api/v1/storage-buckets/:bucketId/objects/initiate` on OneMinute Cloud returns HTTP 500 Internal Server Error (`{"statusCode":500,"message":"Internal server error"}`).
2. **Fallback to Local Mock Endpoint**:
   - In accordance with `BUG-004`, `StorageService.initiateMultipartUpload` caught the 500 status and activated the fallback pipeline, pointing chunk URLs to `/api/v1/storage/mock-upload`.
   - The frontend SDK uploaded chunks to the local backend, not OneMinute Cloud. Because OneMinute Cloud's API rejected the initial request, no objects were ever created in the cloud bucket.

### Why a 10-Minute Video Played
1. **Discarded Upload Body**:
   - `StorageController.handleMockUpload` returned HTTP 200 without reading the incoming `req` stream. The binary chunks of the user's video were discarded.
2. **Hardcoded Mux HLS Redirect**:
   - When the public config resolved `master_m3u8_key` (`videos/:id/master.m3u8`), `StorageController.handleStreamVideo` issued a 307 redirect for `.m3u8` keys to `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`.
   - That test stream is Big Buck Bunny, which is 10 minutes and 34 seconds long.

---

## 4. Implementation Details

1. **Local Chunk Persistence (`StorageController.handleMockUpload`)**:
   - Piped `req` stream to `storage_local/chunks/${uploadId}_part_${partNumber}`.
   - Emits valid `ETag` headers for S3 client compatibility.

2. **Chunk Assembly (`StorageService.completeMultipartUpload`)**:
   - Merges and writes ordered parts into `storage_local/objects/${safeKey}` and unlinks chunk files upon completion.

3. **Local Video Streaming with Range Requests (`StorageController.handleStreamVideo`)**:
   - Inspects `storage_local/objects` for the requested key or the video's raw uploaded file.
   - If present on disk, streams the real video using HTTP 206 Partial Content with `Accept-Ranges`, `Content-Range`, and `Content-Length`.
   - Replaced the 10-minute fallback redirect with a concise sample video (`flower.mp4`).

4. **Accurate Stream URL Resolution (`PlayerSettingsService.getPublicPlayerConfig`)**:
   - In local development (when `storage.cdnUrl` is not configured), prioritizes `storage_key` (`raw/.../test-video.mp4`) so `<video>` plays the exact native MP4 with proper duration.

---

## 5. Verification & Testing
1. **Public Config API Verification**:
   - `GET /api/v1/player-settings/public/bedffae3-b506-4ea6-985e-1b99db138730` -> returned `streamUrl: "http://localhost:8080/api/v1/storage/stream?key=raw%2F...%2Ftest-video.mp4"`.
2. **Stream Endpoint**:
   - Verified that `.m3u8` Big Buck Bunny redirect has been eliminated.
3. **Unit Tests & Builds**:
   - `services`: `npm test` -> 80/80 passed. `npm run build` -> exit code 0.
   - `apps/main-dashboard`: `npx tsc --noEmit` -> exit code 0.
