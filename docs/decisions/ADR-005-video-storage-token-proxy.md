# ADR-005: Video Ingestion Token Proxy & Client-Side Telemetry

## Status
**Accepted** (Implemented in Phase 4)

## Context
Video files can be multiple gigabytes in size. Routing multi-gigabyte video streams directly through the Node.js API server would consume memory and saturate network bandwidth. However, uploading directly from the client to cloud storage requires master storage credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), which must never be exposed in client-side bundles.

## Decision
1. **Server-Side Authorization & Presigned Multipart URLs**:
   - The client initiates an upload via `POST /api/v1/videos/init` with an authenticated Clerk Bearer token or API key.
   - Using master Cloudflare R2 S3-compatible credentials stored strictly server-side, the backend initiates a multipart upload (`CreateMultipartUploadCommand`) and generates short-lived presigned chunk upload URLs (`UploadPartCommand`) using `@aws-sdk/s3-request-presigner`.
   - The presigned URLs are returned to the client SDK with chunk bounds.
2. **Direct Browser-to-R2 Streaming**:
   - The browser streams video chunks directly to Cloudflare R2's S3-compatible endpoint (`https://<account-id>.r2.cloudflarestorage.com`) via HTTP PUT requests, extracting ETags from each part response.
   - Zero egress fees and zero intermediary server proxying.
3. **Upload Telemetry Engine**:
   - Computes transfer speed (MB/s) and estimated remaining time (ETA) defensively:
     $$\text{Elapsed} = \max\left(0.1, \frac{\text{Date.now}() - \text{StartTime}}{1000}\right)$$
     Guards against division-by-zero, $0$ speed, and $100\%$ completion edge cases to prevent displaying `NaN` or `Infinity`.
4. **Cloud Object Key Retention**:
   - Upon completion, the unique cloud object key is captured and stored for subsequent transcoding and HLS packaging pipelines.

## Consequences
### Positive
- Master cloud credentials never leave the server environment.
- Minimal backend bandwidth utilization: gigabyte payloads bypass the application server.
- High-fidelity telemetry provides polished UX during long uploads.

### Negative / Trade-offs
- The browser must maintain network connectivity for the duration of the multipart stream.
