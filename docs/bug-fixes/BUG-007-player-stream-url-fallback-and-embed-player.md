# Bug Fix: BUG-007 — Missing Stream URL Fallback & Incomplete Embed Video Player Architecture

## 1. Metadata
- **Bug ID**: `BUG-007`
- **Date**: 2026-10-25
- **Severity**: Medium-High
- **Component**: Backend (`PlayerSettingsModule`) & Frontend (`main-dashboard` / Embed Player & Video Views)
- **Status**: Resolved
- **Impacted Files**:
  - `services/src/modules/player-settings/player-settings.service.ts`
  - `services/src/modules/player-settings/player-settings.service.spec.ts`
  - `apps/main-dashboard/components/player/vedora-player.tsx`
  - `apps/main-dashboard/components/modals/embed-video-modal.tsx`
  - `apps/main-dashboard/app/embed/[videoid]/page.tsx`
  - `apps/main-dashboard/app/video/[videoid]/page.tsx`
  - `apps/main-dashboard/app/my-videos/page.tsx`
  - `apps/main-dashboard/app/player/page.tsx`

---

## 2. Problem Statement & Symptoms
1. **Null `streamUrl` in Public Player Config for Raw Uploads**:
   - `PlayerSettingsService.getPublicPlayerConfig(videoId)` only set `streamUrl = this.storageService.getPublicUrl(video.master_m3u8_key)` when `video.master_m3u8_key` was populated.
   - For newly uploaded videos or environments where HLS transcoding had not yet completed, `streamUrl` returned `null`, rendering the player completely unplayable ("Video stream cannot be loaded").
2. **Missing Reusable Embed Video Player Component**:
   - The embed route (`/embed/[videoid]`) had all player logic hardcoded into a single monolithic page, making it impossible to preview in the dashboard or modals.
   - Video detail pages (`/video/[videoid]`) rendered a static mock image with an unclickable play icon.
   - The "Embed" button in `my-videos` showed a placeholder toast (`"video player will be active in Part 3"`) and hardcoded `https://player.vedora.com/embed/...`.
3. **No Support for Direct Video Containers in Embed Player**:
   - The player engine assumed every stream was an HLS manifest (`.m3u8`), failing if given direct `.mp4` or `.webm` video streams.
   - No interactive hover scrubber, buffer progress, playback speed menu, picture-in-picture, or query parameter overrides (`?autoplay=1&muted=1&t=15`).

---

## 3. Root Cause Analysis (RCA)
- **Backend**:
  `PlayerSettingsService.getPublicPlayerConfig` lacked a fallback check for `video.storage_key` when `video.master_m3u8_key` was null.
- **Frontend**:
  Lack of a centralized `<VedoraPlayer />` component meant each page either implemented partial player logic or used placeholder images.

---

## 4. Implementation Details

### A. Backend Stream URL Fallback (`PlayerSettingsService`)
Updated `services/src/modules/player-settings/player-settings.service.ts`:
```ts
// Resolve stream URL for master HLS manifest or raw upload fallback
let streamUrl: string | null = null;
if (video.master_m3u8_key) {
  streamUrl = this.storageService.getPublicUrl(video.master_m3u8_key);
} else if (video.storage_key) {
  streamUrl = this.storageService.getPublicUrl(video.storage_key);
}
```
Added unit test in `services/src/modules/player-settings/player-settings.service.spec.ts` validating fallback to `storage_key`.

### B. Reusable `<VedoraPlayer />` Component
Created `apps/main-dashboard/components/player/vedora-player.tsx`:
- **Dual-mode streaming**: Seamlessly plays HLS manifests (`.m3u8`) via Hls.js and direct video files (`.mp4`, `.webm`) via native HTML5 video.
- **Telemetry segment pings**: Emits heartbeats to `/api/v1/analytics/segment-ping` every 10s.
- **Rich controls**: Play/pause with center pulse animations, 10s skip backward/forward, dynamic volume icons and slider, hover scrubber with buffer progress and timestamp tooltip, playback speed controller (`0.5x` to `2.0x`), quality selector, Picture-in-Picture, and fullscreen toggle.
- **Branding**: Honors player settings (`primaryColor`, `controlBarBg`, `playIconStyle`, `watermarkUrl`, `watermarkPosition`, `watermarkOpacity`, `isFreeTier`).
- **Shortcuts**: Space/k (play/pause), arrows (seek & volume), m (mute), f (fullscreen), p (PiP).

### C. Embed Modal & Dashboard Integration
- Created `apps/main-dashboard/components/modals/embed-video-modal.tsx`:
  - Interactive live preview of the embedded video.
  - Sizing presets (Responsive 16:9 vs Fixed px dimensions).
  - Configurable query options (autoplay, muted, loop, start time).
  - One-click HTML iframe copy and direct link copy.
- Updated `apps/main-dashboard/app/embed/[videoid]/page.tsx` with query parameter parsing and full-bleed viewport.
- Updated `apps/main-dashboard/app/video/[videoid]/page.tsx` with live player and embed generator.
- Updated `apps/main-dashboard/app/my-videos/page.tsx` to open the embed modal on click.
- Updated `apps/main-dashboard/app/player/page.tsx` with live player preview reacting instantly to styling changes.

---

## 5. Verification & Testing
1. **Unit Tests**:
   - `npm test src/modules/player-settings/player-settings.service.spec.ts` -> 7/7 tests passed.
   - All backend test suites passed (80/80 tests).
2. **Backend Build**:
   - `npm run build` in `services` -> Exited with code 0.
3. **Frontend TypeScript Check**:
   - `npx tsc --noEmit` in `apps/main-dashboard` -> Exited with code 0.
