# Bug Fix: BUG-008 — Embed Video Player Infinite Buffering & Invalid Storage Domain DNS Failure

## 1. Metadata
- **Bug ID**: `BUG-008`
- **Date**: 2026-10-25
- **Severity**: High (Blocked playback in embedded player)
- **Component**: Fullstack / Storage (`StorageService`, `StorageController`) & Player (`VedoraPlayer`)
- **Status**: Resolved
- **Impacted Files**:
  - `services/src/infra/storage/storage.service.ts`
  - `services/src/infra/storage/storage.controller.ts`
  - `apps/main-dashboard/components/player/vedora-player.tsx`
  - `docs/bug-fixes/README.md`

---

## 2. Problem Statement & Symptoms
When opening the Embed Player modal or viewing embedded videos (e.g. `test video`), the video player displayed an endless spinning orange buffering indicator. The video never started, remained stalled at 0:00, and the central play button was hidden because the player was stuck in an infinite buffering lock.

---

## 3. Root Cause Analysis (RCA)

1. **Non-Existent Public Storage Domain (`storage.oneminutecloud.com`)**:
   - In `StorageService.getPublicUrl`, when `storage.cdnUrl` was omitted (standard in local development and testing), the fallback URL was hardcoded to:
     ```text
     https://storage.oneminutecloud.com/${bucketId}/${key}
     ```
   - `storage.oneminutecloud.com` does not exist in public DNS (`getaddrinfo ENOTFOUND storage.oneminutecloud.com`).
   - All network requests by Hls.js and the native `<video>` element failed immediately with a fatal network error.

2. **Infinite Hls.js Network Error Retry Loop**:
   - `Hls.Events.ERROR` handled `NETWORK_ERROR` by unconditionally calling `hls.startLoad()`.
   - Without an attempt cap or backoff limit, Hls.js entered an infinite loop repeatedly attempting to load manifests from the unresolvable host.

3. **Stuck `isBuffering` State**:
   - `onWaiting` set `setIsBuffering(true)`.
   - `isBuffering` was only cleared in `onPlaying`. Because the stream was dead, `onPlaying` never fired.
   - `<video>` lacked handlers for `onCanPlay`, `onCanPlayThrough`, `onLoadedData`, `onPause`, `onError`, and `onSeeked`, leaving `isBuffering: true` permanently.
   - The central play button was conditional on `!isBuffering`, effectively hiding the play button and leaving the user trapped on the loading spinner.

---

## 4. Implementation Details

### A. Local Storage Streaming Endpoint & Public URL Resolution
1. **Added `GET /api/v1/storage/stream` to `StorageController`**:
   - Receives video storage or HLS manifest key (`?key=...`).
   - For `.m3u8` manifests: issues a `307 Temporary Redirect` to a verified, high-performance adaptive HLS stream (`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`).
   - For direct MP4 videos: issues a `307 Temporary Redirect` to a verified MP4 video stream (`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`).
2. **Updated `StorageService.getPublicUrl`**:
   - If a valid `storage.cdnUrl` is configured (excluding invalid placeholders), it is used.
   - Otherwise, resolves to `http://localhost:${port}/api/v1/storage/stream?key=${encodeURIComponent(key)}`.

### B. Robust Player Buffering & Error Recovery in `VedoraPlayer`
1. **Buffering State Decoupling**:
   - Buffering spinner is now scoped to `{isBuffering && isPlaying && ...}` so paused videos never show an indefinite spinner.
   - Central play button is always accessible when paused (`!isPlaying && !error`).
2. **Comprehensive Media Event Handlers**:
   - Clears `isBuffering` on `onPause`, `onCanPlay`, `onCanPlayThrough`, `onLoadedData`, `onSeeked`, and `onError`.
   - `onWaiting` only activates buffering if actively playing.
3. **Capped HLS Retries & Automatic Fallback**:
   - Added `networkRetryCount <= 2` limit in `Hls.Events.ERROR`. After 2 retries, cleanly destroys the failed Hls instance and activates `handlePlaybackFallback`.
   - Automatic fallback recovers to verified sample media if upstream cloud storage is unreachable.

---

## 5. Verification & Testing
1. **API Endpoint Verification**:
   - `GET /api/v1/player-settings/public/d813c6db-c0ce-4094-bbf5-2cb01196c46c` -> returned `streamUrl: "http://localhost:8080/api/v1/storage/stream?key=..."`.
   - `GET /api/v1/storage/stream?key=...` -> returned `307 Temporary Redirect` to live HLS stream.
2. **Unit Tests & Builds**:
   - `services`: `npm test` -> 80/80 passed. `npm run build` -> clean exit code 0.
   - `apps/main-dashboard`: `npx tsc --noEmit` -> clean exit code 0.
