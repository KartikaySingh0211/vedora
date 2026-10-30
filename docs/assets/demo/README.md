# Vedora End-to-End Walkthrough & Demonstration Guide

This guide provides visual and programmatic walkthrough evidence of the complete Vedora video lifecycle: **Direct Client Upload $\to$ Cloudflare R2 Raw Storage $\to$ Redis Job Queue $\to$ FFmpeg Adaptive HLS Packaging $\to$ Multi-Rendition Cloudflare R2 Delivery $\to$ Embedded Video Playback**.

---

## 1. Complete Architecture Lifecycle Walkthrough

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Browser
    participant Dashboard as Main Dashboard
    participant Backend as NestJS API Gateway
    participant Redis as Redis 7 (Queue & Cache)
    participant R2 as Cloudflare R2 Storage
    participant Worker as FFmpeg Transcode Worker
    participant Player as <VedoraPlayer /> (HLS.js)

    %% Step 1: Upload Init
    Note over User,Backend: 1. Presigned Upload Initiation
    User->>Dashboard: Select video file & Quality Ceiling (e.g. 720p)
    Dashboard->>Backend: POST /api/v1/videos/init (Storage safeguard & quota check)
    Backend->>Backend: pg_advisory_xact_lock (Storage cap check)
    Backend->>R2: CreateMultipartUpload / Generate Presigned URLs
    Backend-->>Dashboard: Return uploadId, storageKey, & part URLs

    %% Step 2: Direct Upload
    Note over User,R2: 2. Direct-to-Cloud Upload
    Dashboard->>R2: Upload binary chunks directly via PUT
    Dashboard->>Backend: POST /api/v1/videos/complete (Assemble parts)
    Backend->>R2: CompleteMultipartUpload
    Backend->>Redis: RPUSH vedora:transcode:queue (Job Payload)
    Backend-->>Dashboard: Video status: 'uploaded'

    %% Step 3: Queue & Worker
    Note over Redis,Worker: 3. Background Job Queue & FFmpeg Transcoding
    Worker->>Redis: RPOPLPUSH vedora:transcode:queue -> processing
    Worker->>R2: Download source video to isolated temp directory
    Worker->>Worker: ffprobe (Inspect video/audio codec, resolution, fps)
    Worker->>Worker: ffmpeg (Generate 360p, 480p, 720p HLS variant segments)
    Worker->>Worker: Assemble master.m3u8 multivariant manifest
    Worker->>R2: Upload variant .m3u8 playlists and .ts segments
    Worker->>R2: Upload master.m3u8
    Worker->>Backend: PATCH /api/v1/videos/:id/status (status: 'ready')
    Worker->>Redis: LREM vedora:transcode:processing

    %% Step 4: Playback
    Note over User,Player: 4. Adaptive Bitrate Playback
    User->>Dashboard: Open /embed/[videoid] or /my-videos
    Dashboard->>Player: Load master.m3u8
    Player->>R2: Fetch master manifest & adaptive variant playlists
    Player-->>User: Seamless adaptive playback with resolution switching
```

---

## 2. Visual Demonstration Gallery

### Step 1: Direct Upload Studio (`/uploads`)
Users drag-and-drop video files into the upload studio. Vedora enforces server-side technical safeguards (10 GiB single-file limit, 500 GiB user quota) and allows selecting an adaptive quality ceiling (360p to 1080p). Active uploads are tracked in the persistent background queue sidebar with real-time transfer speeds and progress bars.

![Direct Upload Studio](01-direct-upload-studio.png)

---

### Step 2: Raw Ingestion Zone in Cloudflare R2 (`raw/`)
The original high-resolution master video is uploaded directly from the browser to Cloudflare R2 using AWS SDK S3 presigned multipart URLs, ensuring zero server-bandwidth overhead:

![Cloudflare R2 Raw Storage](02-cloudflare-r2-raw-storage.png)

---

### Step 3: Master Manifest Generation (`videos/<uuid>/master.m3u8`)
Following FFmpeg background processing, the multi-resolution HLS manifest is assembled and stored in the video's root storage directory alongside variant resolution subdirectories:

![Cloudflare R2 Master Manifest](03-cloudflare-r2-master-manifest.png)

---

### Step 4: Variant Rendition Folders & MPEG-TS Segments (`720p/`)
Each rendition contains an RFC 8216-compliant `index.m3u8` variant playlist and uniform 4-second MPEG-2 Transport Stream media chunks (`segment_000.ts`, `segment_001.ts`...):

![Cloudflare R2 HLS Segments](04-cloudflare-r2-hls-segments.png)

---

### Step 5: Video Library Management (`/my-videos`)
The video management dashboard tracks lifecycle status transitions (`uploading` $\to$ `uploaded` $\to$ `processing` $\to$ `ready`), video duration, file sizes, and rendition badges with real-time TanStack Query synchronization:

![Video Management Dashboard](05-video-library-management.png)

---

### Step 6: Responsive Adaptive Playback (`<VedoraPlayer />`)
The embeddable player modal provides adaptive bitrate streaming via HLS.js, rendition quality selection, playback speed controls, picture-in-picture (PiP), custom brand watermarks, and instant iframe embed code extraction:

![Embed Player Adaptive Playback](06-embed-player-adaptive-playback.png)

---

## 3. How to Run the Demonstration Locally

Follow these steps to run and verify the entire upload-to-playback demonstration on a local workstation:

```bash
# 1. Start backend services and Redis
cd services
npm install
npm test -- transcoder-live-e2e.spec.ts   # Runs full synthetic FFmpeg transcoding pipeline
npm run start:dev

# 2. In a second terminal, start the main dashboard
cd apps/main-dashboard
npm ci
npm run dev

# 3. Open http://localhost:3000 in your browser
# - Navigate to /uploads to perform a live upload
# - Navigate to /my-videos to inspect real-time status transitions
# - Open /embed/[videoid] to test HLS adaptive streaming
```
