# Vedora Phase 2 — End-to-End Reliability and Failure Testing

This document details the reliability audit, failure mode analysis, architectural hardening, and automated test suite expansion conducted for Vedora's real FFmpeg video transcoding and HLS delivery infrastructure.

---

## 1. Executive Summary

In Phase 1, Vedora replaced simulated video transcoding with a genuine FFmpeg engine generating RFC 8216 HLS master playlists, rendition variants, and MPEG-TS media segments.

In Phase 2, the complete end-to-end pipeline was audited for failure modes under real-world conditions:
- **Locking & Concurrency**: Eliminated lock ownership leaks and expiration races during long transcode runs.
- **Stranded Job Recovery**: Added crash recovery for workers that terminate abnormally while processing jobs.
- **Delivery Integrity**: Removed unsafe arbitrary file fallbacks in the storage controller and ensured strict HTTP 404 handling for missing HLS media segments and playlists.
- **Information Protection**: Sanitized internal filesystem paths and credential patterns from error messages and database records.
- **Test Suite Expansion**: Added comprehensive failure, timeout, concurrency, and HLS delivery tests, expanding automated coverage from **109 tests across 15 suites** to **124 tests across 16 suites** (100% passing).

---

## 2. Audit Findings & Implemented Fixes

### 2.1 Redis Lock Ownership & Active Renewal Heartbeat

**Previous Gap**:
Previously, distributed locking used a static string `'locked'` with a 600-second TTL:
```typescript
await this.redisService.setnxWithExpiry(lockKey, 'locked', 600);
```
Release was performed via `this.redisService.del(lockKey)`.
This presented two significant reliability hazards:
1. **Lock Theft / Accidental Release**: If Worker A takes longer than 600s to transcode a large 4K file, its lock expires. Worker B picks up the job and acquires the lock. When Worker A eventually completes, its `finally` block calls `del(lockKey)`, deleting Worker B's active lock and allowing a third worker to begin duplicate processing.
2. **Lock Expiration on Long Jobs**: Encoding 1080p high-bitrate video or long-form content frequently exceeds 600s, causing the lock to lapse prematurely.

**Implementation**:
1. Added atomic token-verified lock release and renewal in [`RedisService`](file:///d:/Dev/Projects/vedora/services/src/infra/redis/redis.service.ts):
   ```typescript
   async releaseLock(key: string, token: string): Promise<boolean> {
     const lua = `
       if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       else
         return 0
       end
     `;
     const result = await this.client.eval(lua, 1, key, token);
     return result === 1;
   }

   async renewLock(key: string, token: string, ttlSeconds: number): Promise<boolean> {
     const lua = `
       if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("expire", KEYS[1], ARGV[2])
       else
         return 0
       end
     `;
     const result = await this.client.eval(lua, 1, key, token, ttlSeconds);
     return result === 1;
   }
   ```
2. In [`TranscoderService.executeTranscoding`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/transcoder.service.ts):
   - Generated a cryptographically unique `lockToken = crypto.randomUUID()` for every transcode execution.
   - Initialized a 30-second lock renewal heartbeat timer extending the 600s TTL for as long as the worker process remains alive and active.
   - Ensured the `finally` block cancels the heartbeat interval and calls `releaseLock(lockKey, lockToken)`, ensuring workers never delete or modify locks held by subsequent workers.

---

### 2.2 Stranded Job & Worker Crash Recovery

**Previous Gap**:
The Redis FIFO queue relies on `lpop`, which dequeues jobs upon pickup (at-most-once delivery). If a worker process crashes (OOM, SIGKILL, server reboot, unhandled exception), the video record remains in `status: 'processing'` indefinitely with no active worker or queue item.

**Implementation**:
Implemented `recoverStuckJobs(thresholdMs = 15 * 60 * 1000): Promise<string[]>` in [`TranscoderService`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/transcoder.service.ts):
- Scans the PostgreSQL database for video records in `status: 'processing'` whose `updated_at` timestamp is older than 15 minutes.
- Checks Redis to verify whether an active distributed lock exists for each candidate video.
- If no active lock exists, the job is declared stranded and safely transitioned to `status: 'failed'` with the diagnostic reason `'Transcoding worker crashed or job timed out without completion'`.
- Hooked `recoverStuckJobs()` into NestJS `OnModuleInit` lifecycle to automatically recover stranded jobs on service startup.

---

### 2.3 Storage Controller Delivery & HLS 404 Semantics

**Previous Gap**:
In [`StorageController`](file:///d:/Dev/Projects/vedora/services/src/infra/storage/storage.controller.ts), the `serveFileByKey` helper had two failure modes:
1. When a requested file was not found, it searched `storage_local/objects` for any random recent file (`sorted[0].name`) and attempted to stream it.
2. If that failed, it returned a 307 Temporary Redirect to MDN's sample `flower.mp4`.
For HLS video streaming, streaming a random file or redirecting an MPEG-TS segment (`segment_001.ts`) to an MP4 video causes immediate demuxer corruption and fatal playback termination in `Hls.js` (`bufferAppendError` / `demuxError`).

**Implementation**:
- Removed the arbitrary recent file fallback (`sorted[0].name`).
- Enforced strict RFC 8216 MIME types:
  - `.m3u8` playlists: `application/vnd.apple.mpegurl`
  - `.ts` media segments: `video/mp2t`
  - Range requests (HTTP 206 Partial Content): supported for segment seeking.
- For missing `.m3u8` playlists and `.ts` media segments, the controller now returns **HTTP 404 Not Found** with a JSON error payload, allowing client players to handle rendition switching or surface user-friendly recovery UI rather than demuxer failure.

---

### 2.4 Error Message Sanitization & Path Redaction

**Previous Gap**:
Internal filesystem paths (such as `D:\Dev\Projects\vedora\storage_local\...` or temporary OS directories) and query strings could leak into database error columns (`status: failed`) and application logs.

**Implementation**:
Added `sanitizeErrorMessage(raw: string): string` to [`TranscoderService`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/transcoder.service.ts):
- Strips Windows paths (`[A-Za-z]:\\[^ \n\r\t"]+`) -> `[redacted_path]`.
- Strips Unix paths (`/(?:[a-zA-Z0-9._-]+/)+[a-zA-Z0-9._-]+`) -> `[redacted_path]`.
- Redacts sensitive credentials (`password=...`, `token=...`, `api_key=...`).
- Wrapped `markVideoFailed()` and catch blocks with automatic sanitization.

---

## 3. Automated Test Coverage Matrix

Automated testing was expanded to cover every requirement in Phase 2 across three test suites:

| Test Area | Specification File | Test Description | Status |
| :--- | :--- | :--- | :--- |
| **Media Probing** | `ffmpeg.service.spec.ts` | Valid video file containing audio | **PASS** |
| **Media Probing** | `ffmpeg.service.spec.ts` | Silent video (no audio stream, `-an` packaging) | **PASS** |
| **Media Probing** | `ffmpeg.service.spec.ts` | Non-existent media source (throws 'Media file not found') | **PASS** |
| **Media Probing** | `ffmpeg.service.spec.ts` | Corrupt or invalid input file (detected and rejected) | **PASS** |
| **Media Probing** | `ffmpeg.service.spec.ts` | Audio-only input file (no video stream rejected) | **PASS** |
| **Rendition Rules** | `ffmpeg.service.spec.ts` | No upscaling: 720p source not upscaled to 1080p | **PASS** |
| **Rendition Rules** | `ffmpeg.service.spec.ts` | No upscaling: 360p source not upscaled to 720p/1080p | **PASS** |
| **Rendition Rules** | `ffmpeg.service.spec.ts` | 1080p source allowed 1080p, 720p, and 360p renditions | **PASS** |
| **FFmpeg Packaging** | `ffmpeg.service.spec.ts` | Transcodes real video into master and variant playlists + segments | **PASS** |
| **FFmpeg Packaging** | `ffmpeg.service.spec.ts` | Transcodes silent video without audio streams | **PASS** |
| **FFmpeg Reliability** | `ffmpeg.service.spec.ts` | FFmpeg execution times out and terminates child process | **PASS** |
| **FFmpeg Reliability** | `ffmpeg.service.spec.ts` | FFmpeg nonzero exit status on fatal encoding error | **PASS** |
| **E2E Pipeline** | `transcoder-e2e.spec.ts` | Real pipeline execution: probing, transcoding, HLS upload, DB ready | **PASS** |
| **E2E Pipeline** | `transcoder-e2e.spec.ts` | Missing / corrupt source marks video failed and releases lock | **PASS** |
| **E2E Pipeline** | `transcoder-e2e.spec.ts` | Storage upload failure marks video failed (never ready) & sanitizes error | **PASS** |
| **E2E Concurrency** | `transcoder-e2e.spec.ts` | Duplicate concurrent worker skipped when lock is already held | **PASS** |
| **E2E Concurrency** | `transcoder-e2e.spec.ts` | Lock released using token-verified `releaseLock` on completion | **PASS** |
| **E2E Crash Recovery** | `transcoder-e2e.spec.ts` | Recovers stranded jobs in processing status without active lock | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | Serves master playlist with `application/vnd.apple.mpegurl` (200) | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | Serves variant playlist with `application/vnd.apple.mpegurl` (200) | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | Serves media segments with `video/mp2t` (200) | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | HTTP 206 Partial Content range requests for segment seeking | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | 404 Not Found on missing `.ts` segments | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | 404 Not Found on missing `.m3u8` playlists | **PASS** |
| **HLS Delivery** | `storage.controller.spec.ts` | 400 Bad Request when HLS path key is missing | **PASS** |

---

## 4. Verification & Build Results

### 4.1 Backend Test Suite (`services/`)
```text
PASS src/utils/api-key.util.spec.ts
PASS src/modules/playlist/playlist.service.spec.ts
PASS src/modules/analytics/analytics.service.spec.ts
PASS src/modules/videos/video.service.spec.ts
PASS src/modules/transcoder/transcoder.service.spec.ts
PASS src/guards/dual-auth.guard.spec.ts
PASS src/utils/user-agent.util.spec.ts
PASS src/guards/upload-video.guard.spec.ts
PASS src/app.controller.spec.ts
PASS src/infra/storage/storage.controller.spec.ts
PASS src/modules/billing/billing.service.spec.ts
PASS src/modules/player-settings/player-settings.service.spec.ts
PASS src/swagger.spec.ts
PASS src/modules/api-key/api-key.service.spec.ts
PASS src/modules/transcoder/transcoder-e2e.spec.ts
PASS src/modules/transcoder/ffmpeg.service.spec.ts

Test Suites: 16 passed, 16 total
Tests:       124 passed, 124 total
Snapshots:   0 total
Time:        13.098 s
Exit code:   0
```

### 4.2 TypeScript SDK Tests (`sdks/vedora-sdk/`)
```text
▶ Vedora SDK
  ✔ should initialize VedoraClient with default config (0.8971ms)
  ✔ should accept custom baseUrl and apiKey (0.1823ms)
  ✔ should reject empty or zero-byte file in client.videos.upload (0.6976ms)
✔ Vedora SDK (2.8766ms)
ℹ tests 3, pass 3, fail 0
Exit code: 0
```

### 4.3 Workspace Builds & Typechecks
- **`services`**: `npm run build` -> **0 errors** (compiled with NestJS CLI).
- **`sdks/vedora-sdk`**: `npm run build` -> **0 errors** (compiled with TypeScript).
- **`apps/main-dashboard`**: `npx tsc --noEmit` -> **0 errors** (Next.js 16 App Router).

---

## 5. Architectural Reliability Guarantees & Non-Claims

1. **Idempotency & Safe Retry**:
   If a transcoding job is re-enqueued for a video that is already in `status: 'ready'` with valid master playlist keys, the worker detects this condition immediately, releases its lock, and skips redundant FFmpeg encoding.
2. **Partial Output Cleanup**:
   Every transcoding job allocates a dedicated temporary directory in `os.tmpdir()/vedora-jobs/{videoId}-{timestamp}`. The directory is cleaned up in a `finally` block regardless of whether transcoding succeeds, times out, or fails.
3. **No Distributed Exactly-Once Claims**:
   Vedora's queue uses standard Redis list primitives (`rpush` / `lpop`) backed by single-instance distributed locking and heartbeat renewal. In the event of a worker crash, stranded jobs are safely detected and transitioned to `failed`. Distributed exactly-once execution across multi-region clusters is not claimed and not required; safe at-least-once recovery with idempotent transitions is enforced.
