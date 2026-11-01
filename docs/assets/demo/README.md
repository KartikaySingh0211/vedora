# Vedora End-to-End Walkthrough & Demonstration Guide

This guide provides visual, architectural, and operational walkthrough evidence of the complete Vedora video lifecycle: **Direct Client Upload $\to$ Cloudflare R2 Raw Storage $\to$ Redis Job Queue $\to$ FFmpeg Adaptive HLS Packaging $\to$ Multi-Rendition Cloudflare R2 Delivery $\to$ Embedded Video Playback**.

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

## 2. Demonstration Videos

Vedora's full operational lifecycle and cloud storage integrations are captured in two high-definition demonstration screencasts:

### 2.1 Complete Application Walkthrough
- 🎥 **Video File**: [Watch Application Walkthrough](main-walkthrough.mp4)
- **Lifecycle Scope**: Demonstrates the end-to-end user experience and operational workflow across the platform:
  1. **Dashboard & API Keys**: Inspecting active API keys, one-time reveal modals, and key regeneration with cooldown controls.
  2. **Non-Blocking Sidebar Uploads (`/uploads`)**: Drag-and-drop video ingestion, selecting an adaptive quality ceiling (360p to 1080p), and simultaneously uploading multiple files inside the persistent right sidebar queue with real-time transfer telemetry (MB/s throughput and ETA countdowns).
  3. **Lifecycle State Transitions (`/my-videos`)**: Real-time status transitions (`uploading` $\to$ `uploaded` $\to$ `processing` $\to$ `ready`) synchronized via TanStack Query.
  4. **Adaptive HLS Playback (`<VedoraPlayer />`)**: Opening the responsive player modal, adaptive stream resolution switching, playback rate controls, and picture-in-picture (PiP).
  5. **Network Request Inspection**: Verifying client-side retrieval of the multivariant `master.m3u8` playlist, variant rendition manifests (`720p/index.m3u8`), and uniform MPEG-2 Transport Stream media chunks (`segment_000.ts`).
  6. **Player Customization (`/player`)**: Adjusting player accent colors, control bar themes (including transparent backgrounds), watermark positions, and toolbar controls.

### 2.2 Cloudflare R2 Storage Walkthrough
- 🎥 **Video File**: [Watch Cloudflare R2 Walkthrough](R2.mp4)
- **Object Storage Inspection**: Deep dive into the physical Cloudflare R2 bucket hierarchy confirming clean separation between raw master video uploads and generated multi-resolution HLS media artifacts:

```text
cloudflare-r2-bucket/
├── raw/
│   └── <videoId>.<ext>                 # Original un-transcoded master video
└── videos/
    └── <videoId>/
        ├── master.m3u8                 # RFC 8216 multivariant master playlist
        ├── 1080p/                      # 1080p FHD rendition folder
        │   ├── index.m3u8              # 1080p variant media playlist
        │   ├── segment_000.ts          # Uniform 4-second MPEG-TS chunks
        │   └── segment_001.ts
        ├── 720p/                       # 720p HD rendition folder
        │   ├── index.m3u8              # 720p variant media playlist
        │   ├── segment_000.ts
        │   └── segment_001.ts
        ├── 480p/                       # 480p SD rendition folder
        │   ├── index.m3u8
        │   └── segment_000.ts
        └── 360p/                       # 360p mobile rendition folder
            ├── index.m3u8
            └── segment_000.ts
```

- **Key Architectural Findings**:
  - **Zero Server Bandwidth Ingestion**: Video files are transferred directly from client browsers to Cloudflare R2 using AWS SDK S3 presigned multipart upload URLs.
  - **Standardized Multi-Resolution Output**: FFmpeg transcode workers unpack the raw source, generate the full adaptive ladder without quality upscaling, and upload each rendition's variant playlist and TS segments alongside the root `master.m3u8` multivariant playlist.

---

## 3. Visual Execution Evidence & Screenshots

### Background Transcoding Worker Execution Logs
Terminal output proving genuine background transcode worker execution: atomic Redis job claiming (`RPOPLPUSH`), FFprobe media topology inspection, multi-resolution ladder encoding (360p to 1080p with strict no-upscaling guards), multivariant RFC 8216 master manifest generation, and Cloudflare R2 artifact upload:

![Vedora Background Transcoding Logs](../screenshots/transcoding-logs.png)
*Figure: Terminal execution logs from the Vedora background worker demonstrating real FFprobe probing, multi-ladder H.264/AAC transcoding, master manifest assembly, and database status updates.*

### Video Management Dashboard (`/my-videos`)
User video library tracking real-time status transitions, resolution badges, duration, file sizes, and embed launcher:

![Video Management Dashboard](../screenshots/my-videos-dashboard.png)
*Figure: Video library dashboard showing active lifecycle badges, duration metadata, and playback launcher.*

### Embed Video Player Modal (`/embed/[videoid]`)
Embed player modal featuring adaptive HLS streaming via HLS.js, rendition quality selector, playback speed, brand watermark, and iframe embed code generation:

![Embed Video Player Modal](../screenshots/embed-player-modal.png)
*Figure: Interactive embed video player modal with responsive aspect ratio, quality level selector, and custom styling.*

---

## 4. How to Run the Demonstration Locally

Follow these steps to run and verify the entire upload-to-playback demonstration on a local workstation:

```bash
# 1. Start backend services and Redis
cd services
npm install
npm test -- transcoder-live-e2e.spec.ts   # Runs full synthetic FFmpeg transcoding pipeline
npm run start:dev

# 2. In a second terminal, start the main dashboard
cd apps/main-dashboard
npm install
npm run dev -- -p 3001

# 3. Open http://localhost:3001 in your browser
# - Navigate to /uploads to perform a live upload with sidebar queue tracking
# - Navigate to /my-videos to inspect real-time status transitions
# - Open /embed/[videoid] to test HLS adaptive streaming
```
