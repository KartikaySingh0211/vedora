# ADR-007: Vedora Upload SDK Architecture and Multipart Pipeline

## Status
Accepted

## Context
Developers and internal dashboard applications require a robust, client-agnostic TypeScript SDK to interact with the Vedora video infrastructure. The upload pipeline must handle large files, provide real-time progress telemetry (uploaded bytes, percentage, MB/s transfer speed, and estimated time remaining), retry transient network errors using exponential backoff, support upload cancellation via standard `AbortSignal`, and support dual-authentication (API keys or bearer tokens).

## Decision
1. **Package Architecture (`@vedora/sdk`)**:
   - Location: `sdks/vedora-sdk`.
   - Standardized on modern TypeScript with dual bundler and node module resolution.
   - Clean separation of concerns:
     - `client.ts`: High-level `VedoraClient` supporting configurable `baseUrl`, `apiKey`, and dynamic `bearerToken` (supporting async Clerk session tokens).
     - `uploader.ts`: Core multipart upload pipeline transferring chunks directly to cloud endpoints.
     - `types.ts`: Strongly typed request/response models, `UploadProgress`, and `VedoraError` hierarchy.

2. **3-Step Upload Pipeline & Non-Blocking Background Queue**:
   - **Step 1: Init (`POST /api/v1/videos/init`)**: Registers metadata, validates plan quota, receives quality ceiling (`360p`, `480p`, `720p`, `1080p`), and obtains presigned multipart URLs.
   - **Step 2: Direct Upload**: Slices chunks via `file.slice(start, end)`, executing direct HTTP `PUT` requests to cloud storage presigned endpoints with ETag extraction.
   - **Step 3: Complete (`POST /api/v1/videos/complete`)**: Confirms upload with the backend, transitioning video status to `uploaded`, triggering asynchronous transcode queueing, and updating playlist counts.
   - **Non-Blocking Background Dashboard Queue**: Uploads execute inside a global React context (`UploadQueueContext`) rendering in a dedicated right sidebar. Users are instantly redirected to `/my-videos` upon initiating an upload, allowing them to browse, inspect, and manage other assets while observing real-time speed (MB/s), percentage, and remaining ETA.

3. **Telemetry & Resilience**:
   - Non-linear progress and telemetry calculations:
     - `percent = Math.min(100, Math.max(0, Math.round((uploadedBytes / totalBytes) * 100)))`
     - `speedBps = Math.round(uploadedBytes / elapsedSeconds)`
     - `etaSeconds = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0`
   - Bounded exponential backoff with jitter on transient 5xx errors or network interruptions (1s, 2s, 4s, capped at 8s, up to 3 retries).
   - Immediate rejection of permanent 4xx client errors (e.g. 401 Unauthorized, 403 Forbidden quota exceeded) without wasteful retries.
   - Structured error typing (`VedoraError`) with explicit phase tags (`init`, `upload`, `complete`, `general`) to facilitate pinpoint debugging and UI error recovery.

## Consequences
- **Positive**: Clean, reusable SDK for both browser and Node.js environments. Unifies upload error handling, retries, and telemetry in a single tested package.
- **Negative**: Requires client environments to support the `Fetch` API and `Blob.slice` (standard across all modern browsers and Node.js 18+).
