# ADR-008: Asynchronous HLS Transcoding Pipeline and Rendition Ladder

## Status
Accepted

## Context
When raw video uploads complete, they cannot be served directly as monolithic MP4s to diverse client devices with variable network conditions. Vedora requires an adaptive-bitrate HTTP Live Streaming (HLS) pipeline that generates multi-variant rendition playlists and segments (360p, 480p, 720p, 1080p), enforces plan-authorized resolution caps, preserves raw storage size separately from transcoded storage size, processes encoding asynchronously without blocking client HTTP threads, and transitions video states to `ready` only after strict manifest and segment artifact verification.

## Decision
1. **Asynchronous Transcoding Flow & Non-Blocking Worker**:
   - Transcoding is triggered automatically upon video upload completion in `VideoService.completeVideo`.
   - The job is enqueued to Redis via `rpush` to `vedora:queue:transcode`.
   - `TranscoderProcessor` periodically inspects the queue using non-blocking atomic `lpop`.
   - Immediate transition of video state to `processing` prevents duplicate execution.
   - Processing is completely decoupled from the synchronous HTTP request lifecycle.

2. **Automatic Adaptive Rendition Ladder (Option A) & Plan Enforcement**:
   - **Quality Ceiling Architecture**: When a user or API client specifies a target resolution, it is treated as the **maximum quality ceiling**. The transcode engine automatically expands the ceiling into a full adaptive rendition ladder generating all supported lower renditions:
     - **360p Ceiling**: Generates `['360p']`
     - **480p Ceiling**: Generates `['360p', '480p']` (sorted `['480p', '360p']`)
     - **720p Ceiling (Default)**: Generates `['360p', '480p', '720p']` (sorted `['720p', '480p', '360p']`)
     - **1080p Ceiling**: Generates `['360p', '480p', '720p', '1080p']` (sorted `['1080p', '720p', '480p', '360p']`)
   - **Strict No-Upscaling Rule**: Source video stream dimensions are probed using FFprobe before transcoding. Candidate renditions exceeding the source video's probed height (`standard.height > probe.height`) are filtered out. For example, a 720p source with a 1080p ceiling produces only `['720p', '480p', '360p']`.
   - **Sub-360p Fallback**: If a source video is smaller than 360p (e.g. 240p), a source-matching custom rendition is generated with guaranteed even dimensions.
   - Standard rendition profiles:
     - **360p**: 640x360, 800 kbps video, 96 kbps audio, 30 fps, 4-sec segments.
     - **480p**: 854x480, 1400 kbps video, 128 kbps audio, 30 fps, 4-sec segments.
     - **720p**: 1280x720, 2800 kbps video, 128 kbps audio, 30 fps, 4-sec segments.
     - **1080p**: 1920x1080, 5000 kbps video, 192 kbps audio, 60 fps, 4-sec segments.
   - **Plan-Based Resolution Capping**: Free and Starter plans are capped at 720p maximum encoding ceiling; 1080p is restricted to Starter/Pro/Business plans.

3. **Manifest Generation & Artifact Storage**:
   - Master manifest (`videos/<video-id>/master.m3u8`) is generated following the HLS RFC 8216 specification with `#EXT-X-STREAM-INF` declarations linking each successfully generated variant rendition.
   - Variant media playlists (`videos/<video-id>/<rendition>/index.m3u8`) and `.ts` media segments are uploaded directly to **Cloudflare R2** object storage (or `storage_local` fallback in offline environments).
   - Upload uses direct binary buffer streaming with `Content-Type: application/vnd.apple.mpegurl` and `video/mp2t`.

4. **HMAC Webhook Verification & Atomic Ready Transition**:
   - Webhook endpoint (`POST /api/v1/transcoder/webhook`) is protected by cryptographic HMAC-SHA256 signature verification (`x-vedora-signature`), preventing unauthorized or forged completion calls.
   - The completion handler verifies that the target video is in the `processing` state, calculates total transcoded storage, updates `transcoded_size` without overwriting the original raw `size_bytes`, sets `master_m3u8_key`, and transitions video status to `ready`.
   - Duplicate webhook deliveries are handled idempotently.

## Consequences
- **Positive**: Zero blocking during upload completion; robust adaptive bitrate streaming; separate accounting for raw vs. transcoded storage prevents quota discrepancies; strong cryptographic security on completion callbacks.
- **Negative**: Requires Redis infrastructure to maintain worker queues and transient job states.
