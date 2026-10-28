# ADR-006: Plan-Based Storage Quotas and Concurrency-Safe Direct-to-Cloud Uploads

## Status
Accepted

## Context
Video platforms ingest large assets (ranging from 100 MB to 100 GB). Routing massive video byte payloads directly through Node.js API servers would quickly saturate application CPU, thread pools, and memory. Simultaneously, enterprise video infrastructure must enforce subscription tier limits (e.g. Free: 5 GiB, Starter: 250 GiB, Pro: 600 GiB, Business: 2 TiB), restrict high resolutions (e.g., 1080p prohibited on Free tier), and prevent concurrent upload requests from exploiting race conditions to overrun storage quotas.

## Decision
1. **Direct-to-Cloud Ingestion with Server-Authorized Presigned Chunks**:
   - The client initiates an upload via `POST /api/v1/videos/init`.
   - The backend validates authentication, plan tier, resolution eligibility, and storage capacity before requesting multipart upload configurations from **Cloudflare R2** (or local fallback storage).
   - The backend returns presigned multipart upload URLs to the client. The client then transfers video chunks directly to the Cloudflare R2 bucket via HTTP PUT requests with ETag header extraction.
   - Long-lived storage provider credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) remain strictly on the server and are never exposed to clients.

2. **Storage Accounting & Transcoding Reservations**:
   - Incoming reservation calculation accounts for both raw and anticipated transcoded output:
     - Standard 720p encoding: `rawSize * 0.70`
     - Multi-resolution including 1080p: `rawSize * 1.75`
     - Total reservation: `rawSize + estimatedTranscodedSize`
   - All file size and capacity calculations use native BigInt integer arithmetic (`(rawSize * 70n) / 100n`), eliminating floating-point rounding errors.

3. **Concurrency Protection via PostgreSQL Advisory Locks**:
   - To prevent concurrent requests from bypassing storage quotas, `initVideo` executes within a database transaction that acquires a transaction-scoped advisory lock:
     `SELECT pg_advisory_xact_lock(hashtext('vedora_storage_quota_' || userId))`
   - Active storage sums all videos owned by the user in `['uploading', 'uploaded', 'processing', 'ready']` states. Videos in `uploading` state count toward the reservation immediately, preventing race condition overruns.
   - If an upload fails or is deleted, its storage is immediately released.

4. **Idempotent Completion**:
   - `POST /api/v1/videos/complete` validates that the storage key matches the initialized record and transitions status from `uploading` to `uploaded`.
   - Associated playlist `total_videos` counter is incremented atomically (`total_videos = total_videos + 1`) only during this transition. Duplicate requests are idempotent and return the existing record without duplicate increments.

## Consequences
- **Positive**: The Node.js API server never buffers video binaries, guaranteeing horizontal scalability. Storage quotas cannot be overrun by concurrent requests.
- **Negative**: Requires cloud storage provider to support presigned multipart PUT URLs with standard CORS and ETag response headers.
