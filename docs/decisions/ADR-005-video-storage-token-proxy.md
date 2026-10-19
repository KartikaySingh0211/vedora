# ADR-005: Video Ingestion Token Proxy & Client-Side Telemetry

## Status
**Accepted** (Implemented in Phase 4)

## Context
Video files can be multiple gigabytes in size. Routing multi-gigabyte video streams directly through the Node.js API server would consume memory and saturate network bandwidth. However, uploading directly from the client to cloud storage requires master API keys (`ONEMINUTECLOUD_API_KEY`), which must never be exposed in client-side bundles.

## Decision
1. **Server-Side Token Proxy Route**:
   - Implemented route handlers at `apps/main-dashboard/app/api/oneminutecloud/[provider]/route.ts` and `provider/route.ts`.
   - The route handler validates the user's Clerk session (`await auth()`). If unauthenticated, it returns HTTP 401.
   - Using the master API key securely kept on the server, the proxy requests short-lived presigned multipart upload URLs from OneMinute Cloud and returns them to the browser.
2. **Direct Browser-to-Storage Streaming**:
   - The browser streams video chunks directly to the storage provider's S3/CDN bucket using presigned URLs.
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
