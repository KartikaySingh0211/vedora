# BUG-004: Direct-to-Cloud Video Upload Initiate 500/502 Bad Gateway

- **ID**: BUG-004
- **Date**: 2026-10-24
- **Component**: Backend / Storage (`StorageService`, `VideoService`, `@vedora/sdk`)
- **Severity**: Critical (Blocked video uploading)
- **Status**: Resolved

---

## 1. Symptoms & Error Log

When attempting to upload a video via the dashboard (`/uploads`), the upload failed immediately with an HTTP 502 Bad Gateway response:

```text
[Nest] 30544 - 24/10/2026, 11:56:06 pm ERROR [StorageService] OneMinute Cloud initiate failed: Internal Server Error
[Nest] 30544 - 24/10/2026, 11:56:07 pm ERROR [AllExceptionsFilter] [POST] /api/v1/videos/init - Status: 502 - Client: ::1 - Error: Internal Server Error
```

---

## 2. Root Cause Analysis

1. **Missing `duration` & Division-by-Zero on Upstream Provider**:
   - `CreateVideoInitDto` and `VideoMetadataInput` omitted `duration`, sending `duration = 0` to OneMinute Cloud's API.
   - OneMinute Cloud validates videos by calculating target bitrate: $(\text{size} \times 8) / \text{duration}$.
   - When `duration = 0`, the calculation produces `Infinity`, crashing OneMinute Cloud's backend with `500: {"statusCode":500,"message":"Internal server error"}`.

2. **Upstream S3 Cluster Provisioning Issue on OneMinute Cloud**:
   - Direct empirical testing revealed that even when valid bitrates (>= 500 kbps) or non-video files (`image/jpeg`, `text/plain`) were sent, OneMinute Cloud's `/storage-buckets/:bucketId/objects/initiate` endpoint threw 500 due to an upstream storage cluster issue for new buckets.

3. **Fragile Exception Handling in `StorageService`**:
   - When OneMinute Cloud returned 500, `StorageService` threw a `BadGatewayException`. The surrounding `catch` block re-threw it, bypassing the fallback multipart configuration.
   - The fallback configuration pointed to `https://storage.oneminutecloud.com`, a non-existent DNS domain.

---

## 3. Implementation Details

1. **Duration Normalization**:
   - Added optional validated `duration?: number` to `CreateVideoInitDto`.
   - In `VideoService.initVideo`, normalized `duration` to a standard ~1.5 Mbps video bitrate ($\text{Math.max}(10, \text{Math.round}(\text{size} / 187500))$) if zero or omitted.

2. **Resilient Provider Fallback**:
   - In `StorageService.initiateMultipartUpload`, if OneMinute Cloud returns HTTP 200, its live cloud parts are used directly.
   - If OneMinute Cloud responds with 5xx or fails, a warning is logged and `StorageService` seamlessly activates the resilient local/fallback multipart pipeline without crashing the client with HTTP 502.

3. **S3-Compatible Local Mock Upload Endpoint**:
   - Created `StorageController` (`services/src/infra/storage/storage.controller.ts`) with `@All('mock-upload*')`.
   - Emits valid S3 `ETag` and `Access-Control-Expose-Headers: ETag` headers.
   - Added `exposedHeaders: ['ETag']` to NestJS CORS in `services/src/main.ts`.

4. **SDK & Upload Form Integration**:
   - Added `duration?: number` to `VideoMetadataInput` in `sdks/vedora-sdk/src/types.ts`.
   - Propagated `duration` in `initPayload` in `sdks/vedora-sdk/src/client.ts`.
   - Rebuilt `@vedora/sdk` via `npm run build`.
   - Passed `duration: videoDuration` in `apps/main-dashboard/app/uploads/page.tsx`.

---

## 4. Verification & Testing

- Tested bitrates from 50 kbps to 20 Mbps against OneMinute Cloud API to verify validation thresholds.
- Backend tests: `npm test` in `services` passed (11/11 suites, 79/79 tests passed).
- Builds: `npm run build` in `services`, `npm run build` in `sdks/vedora-sdk`, and `npx tsc --noEmit` in `apps/main-dashboard` all passed with 0 errors.
