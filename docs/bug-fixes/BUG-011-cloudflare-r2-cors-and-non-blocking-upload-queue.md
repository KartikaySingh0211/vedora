# BUG-011: Cloudflare R2 Multipart CORS Error & Blocking Modal Upload UX

## Metadata
- **Bug ID**: BUG-011
- **Date Reported**: 2026-10-28
- **Component**: Frontend Dashboard (`apps/main-dashboard`) & Cloudflare R2 Storage
- **Severity**: High
- **Resolution Status**: Resolved

---

## 1. Symptoms & Error Logs

1. **Browser CORS Rejection on Cloudflare R2 Uploads**:
   When users selected a video to upload, the browser initiated chunk transfers via `@vedora/sdk`, but all `PUT` requests failed immediately in the browser console:
   ```text
   1793208662379-r2-test-video.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256... CORS error fetch uploader.ts:54
   Access to fetch at 'https://<account-id>.r2.cloudflarestorage.com/vedora-media/...' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
   ```
2. **Blocking Modal UI**:
   While videos uploaded, a modal dialog remained permanently pinned to the screen, preventing the user from navigating, browsing other tabs, or inspecting videos in `/my-videos`.
3. **Stale Video Processing Status on `/my-videos`**:
   Once an upload finished and entered the background transcode queue, the `/my-videos` page displayed a static `processing` badge. Users had to manually reload the entire browser page to see the `ready` status.

---

## 2. Root Cause Analysis (RCA)

1. **Missing Cloudflare R2 CORS Rule**:
   Cloudflare R2 buckets reject browser preflight (`OPTIONS`) requests unless an explicit CORS policy is applied to the bucket. Specifically, browser direct-to-cloud uploads require:
   - `AllowedMethods`: `["GET", "PUT", "POST", "HEAD"]`
   - `AllowedOrigins`: `["http://localhost:3000", "http://localhost:3001", "https://yourdomain.com"]`
   - `AllowedHeaders`: `["*"]`
   - `ExposeHeaders`: `["ETag"]` (critical for extracting S3 multipart part checksums)
2. **Coupled Component State**:
   Upload state was tightly bound to local `useState` within `apps/main-dashboard/app/uploads/page.tsx` rather than a global application-level queue context.
3. **Missing Polling Interval**:
   TanStack Query in `/my-videos` had `refetchOnWindowFocus: true`, but lacked an active polling interval for videos actively in `uploading` or `processing` states.

---

## 3. Implementation & Resolution

### A. Cloudflare R2 CORS Policy
Configured the Cloudflare R2 bucket CORS policy via dashboard/CLI:
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:8080"
    ],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### B. Global Background Upload Queue (`UploadQueueContext`)
1. Created `apps/main-dashboard/context/upload-queue-context.tsx`:
   - Maintains an asynchronous queue of active, processing, and completed uploads.
   - Calculates transfer speed (MB/s), percentage, and remaining ETA.
   - Decoupled from any individual route.
2. Created a persistent right sidebar in the dashboard layout displaying active upload progress.
3. On clicking "Upload Video", users are immediately routed to `/my-videos`. The upload proceeds smoothly in the background sidebar.

### C. Reactive Status Polling in `/my-videos`
Configured `refetchInterval` in `apps/main-dashboard/app/my-videos/page.tsx`:
- When any video in the user's library is in `uploading` or `processing` state, TanStack Query polls every 3 seconds.
- As soon as transcoding completes and the video transitions to `ready`, polling gracefully stops.
- Zero manual browser reloads required.

---

## 4. Verification & Evidence

1. **R2 Multipart Chunks**: Multipart video chunks upload directly to Cloudflare R2 with HTTP 200 responses and valid `ETag` headers.
2. **Non-Blocking Navigation**: Users initiate an upload, are redirected to `/my-videos`, and can navigate between playlists, analytics, and settings while the transfer completes in the right sidebar.
3. **Automatic Ready Transition**: The `processing` badge automatically transitions to `ready` with a green indicator as soon as the FFmpeg worker finishes HLS packaging and stores output manifests.

---

## 5. Architectural Safeguards

- Pre-configured CORS policies are documented in the onboarding and setup guides.
- The `UploadQueueContext` handles network disconnects and surfaces retry options without resetting dashboard state.
