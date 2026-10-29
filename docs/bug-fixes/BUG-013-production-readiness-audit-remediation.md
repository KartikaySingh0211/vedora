# BUG-013: Production-Readiness Audit Remediation & De-Monetization Hardening

## Bug Metadata
- **ID**: `BUG-013`
- **Date**: 2026-10-29
- **Component**: Storage (R2/Local) / FFmpeg Transcoder / Redis Queue / Database Driver / CORS / Auth
- **Severity**: High
- **Resolution Status**: Resolved

---

## 1. Symptoms & Error Logs
During the production-readiness audit of the Vedora repository:
1. **R2 Upload Reliability**: In `StorageService.completeMultipartUpload` and `uploadDirectBuffer`, exceptions encountered when communicating with Cloudflare R2 were caught, logged, and silenced, returning a false-positive success payload (`{ success: true, key }`). This allowed videos to be marked `READY` even if segments or playlists failed to persist.
2. **CORS Vulnerability**: `services/src/main.ts` allowed any browser origin matching `origin.endsWith('.vercel.app')`, potentially permitting malicious third-party Vercel deployments to make credentialed API calls.
3. **FFmpeg Portrait/Odd Scaling Failure**: Encoded portrait videos (`height > width`) or videos with odd source dimensions caused FFmpeg scale/pad filter failures (`width not divisible by 2` or `height not divisible by 2`) under the `yuv420p` pixel format.
4. **Local Storage Missing Asset Redirect**: `StorageController.streamFile` redirected missing video chunks/playlists to Mozilla's external sample flower video rather than returning a semantic HTTP 404 Not Found error.
5. **HLS Master Manifest Compatibility**: `master.m3u8` variant streams omitted the mandatory RFC 8216 `CODECS` attribute in `#EXT-X-STREAM-INF`.
6. **API Key Digest Timing Attack**: In `ApiKeyService`, cached HMAC-SHA256 digests were compared using standard JavaScript string equality (`cached.digest !== incomingDigest`), exposing a potential timing side-channel.
7. **Queue Crash Loss**: The Redis transcoder queue used `RPOP` which removed jobs from the queue immediately upon dequeueing. If the worker process crashed or restarted while transcoding, the job was lost permanently (at-most-once behavior).
8. **Docker Local Postgres Incompatibility**: `DatabaseModule` only configured the `@neondatabase/serverless` WebSocket driver, which is incompatible with standard TCP-based PostgreSQL instances running in the local Docker Compose `local-db` profile.

---

## 2. Root Cause Analysis (RCA)
- **R2 Storage**: Overly aggressive fallback try/catch blocks swallowed AWS SDK exceptions.
- **CORS**: Convenience pattern for preview deployments bypassed origin whitelisting.
- **FFmpeg**: Static landscape width/height targets in the ladder caused orientation inversion and odd aspect-ratio rounding mismatches.
- **Local Storage**: Debug fallback was inadvertently left active in the controller.
- **RFC 8216**: Hardcoded stream inf lines omitted `CODECS="avc1.4d401f,mp4a.40.2"`.
- **API Key**: String comparison in JS does not run in constant time.
- **Queue**: Lack of an active processing queue (`RPOPLPUSH`) and lock-renewal heartbeat.
- **Database Driver**: Lack of conditional driver resolution between WebSocket-based Neon serverless and standard TCP `pg.Pool`.

---

## 3. Implementation Details

1. **Storage Service (`services/src/infra/storage/storage.service.ts`)**:
   - `completeMultipartUpload` and `uploadDirectBuffer` throw on R2 errors when R2 is configured.
   - `TranscoderService` verifies all files are persisted before marking a video `READY`.
2. **CORS Security (`services/src/main.ts`)**:
   - Removed `.endsWith('.vercel.app')` suffix pattern.
   - Restricted origin validation strictly to explicitly configured allowed origins and localhost (`127.0.0.1`, `localhost`).
3. **FFmpeg Transcoder Service (`services/src/modules/transcoder/ffmpeg.service.ts`)**:
   - Added portrait aspect-ratio detection in `selectRenditions`, inverting standard dimensions without upscaling.
   - Replaced fixed scale filters with dynamic token `-2`:
     `scale='if(gt(a,W/H),W,-2)':'if(gt(a,W/H),-2,H)',pad=W:H:(ow-iw)/2:(oh-ih)/2,format=yuv420p` with `-profile:v main -level 3.1`.
   - Guaranteed all ladder renditions have strictly even dimensions.
4. **Local Storage 404 (`services/src/infra/storage/storage.controller.ts`)**:
   - Removed Mozilla sample video redirect; throws `NotFoundException` with structured JSON envelope.
5. **HLS Master Manifest Codecs**:
   - Generates `CODECS="avc1.4d401f,mp4a.40.2"` when audio stream is present, and `CODECS="avc1.4d401f"` when audio is absent.
6. **API Key Digest Comparison (`services/src/utils/api-key.util.ts`)**:
   - Implemented `timingSafeEqualHex` using Node.js `crypto.timingSafeEqual` with byte buffer length pre-validation.
7. **Queue Reliability & Crash Recovery (`services/src/infra/redis/redis.service.ts` & `transcoder.service.ts`)**:
   - Atomic job claiming with `rpoplpush` from `vedora:transcode:queue` to `vedora:transcode:processing`.
   - Worker lock renewal heartbeat every 30 seconds (`vedora:transcode:lock:<videoId>`).
   - Scheduled stuck-job recovery (`recoverStuckJobs`) re-enqueues jobs if locks expire, supporting up to 3 retries.
   - Removal via `lrem` upon verified job completion or failure.
8. **Dual Database Driver Selection (`services/src/database/database.module.ts`)**:
   - Conditionally loads `@neondatabase/serverless` when connecting to `neon.tech` or `USE_NEON=true`.
   - Falls back to `pg.Pool` with `drizzle-orm/node-postgres` for standard PostgreSQL (Docker container or local instance).

---

## 4. Verification & Testing Evidence
- Real FFmpeg transcoding executed and verified for landscape, portrait (360x640), and odd dimension sources (1921x1079, 359x641).
- Master playlists verified to contain compliant `CODECS` strings.
- 16/16 backend test suites passed (139 tests).
- SDK tests passed (3 tests).
- Next.js Dashboard and Landing Page builds completed with 0 errors.

---

## 5. Prevention & Safeguards
- All new storage and transcoder features must enforce strict error propagation.
- Continuous integration tests enforce Swagger schema verification and automated OpenAPI generation.
- Never use variable-time string comparisons for cryptographic digests or keys.

