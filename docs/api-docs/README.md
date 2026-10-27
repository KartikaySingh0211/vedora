# Vedora — Swagger / OpenAPI 3.0 API Documentation

Welcome to the comprehensive API documentation for the **Vedora Video Infrastructure Platform**.

Vedora exposes an enterprise RESTful API served under `/api/v1`, fully documented and testable in interactive Swagger UI.

---

## 📚 Documentation Guides & References

| Document | Description |
| :--- | :--- |
| 📘 **[Swagger UI & OpenAPI Setup Guide](file:///d:/Dev/Projects/vedora/docs/api-docs/SWAGGER_GUIDE.md)** | Swagger configuration (`main.ts`), interactive UI guide, decorator standards, and automated CI test pipeline. |
| 📋 **[Schemas & Data Models Reference](file:///d:/Dev/Projects/vedora/docs/api-docs/SCHEMAS_AND_MODELS.md)** | Complete dictionary of all 24 DTOs, request bodies, response models, validation constraints, and examples. |
| 🔐 **[Authentication & Authorization Guide](file:///d:/Dev/Projects/vedora/docs/api-docs/AUTHENTICATION.md)** | DualAuthGuard internals, Clerk JWTs, Argon2id API key hashing, multi-tier caching (LRU + Redis), and code samples. |
| ⚡ **[Webhooks & Events Reference](file:///d:/Dev/Projects/vedora/docs/api-docs/WEBHOOKS_AND_EVENTS.md)** | Transcoder HMAC-SHA256 signatures, Stripe billing webhooks, idempotency, and local simulation instructions. |
| 🌐 **[Raw OpenAPI 3.0 Specification](file:///d:/Dev/Projects/vedora/docs/openapi.json)** | Statically exported, version-controlled OpenAPI JSON schema (109 KB). |

---

## 🚀 Quick Reference

| Resource | Value |
| :--- | :--- |
| **Swagger UI URL** | `http://localhost:8080/api/docs` |
| **API Base URL** | `http://localhost:8080/api/v1` |
| **Raw OpenAPI Spec** | [`docs/openapi.json`](file:///d:/Dev/Projects/vedora/docs/openapi.json) (OpenAPI 3.0) |
| **Default Server Port** | `8080` (configured via `PORT` in `services/.env`) |
| **API Versioning** | URI-based: `/api/v1/<controller>` |
| **Architecture** | NestJS 11, TypeScript, Drizzle ORM, Neon PostgreSQL, Redis 7, BullMQ |

---

## 🔐 Authentication & Authorization Guide

Vedora implements a dual-layer authentication guard ([`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts)) supporting browser session JWTs and server-to-server API keys.

### 1. Clerk Bearer Token (`bearer`)
- **Use Case**: Used by frontend applications (`apps/main-dashboard`).
- **Header**: `Authorization: Bearer <clerk_session_jwt>`
- **Swagger Authorization**:
  1. Open `http://localhost:8080/api/docs`.
  2. Click the green **Authorize 🔓** button at the top right.
  3. Under **bearer (http, Bearer)**, paste your active Clerk session token.
  4. Click **Authorize**.

### 2. Vedora API Key (`x-api-key`)
- **Use Case**: Used by SDKs ([`@vedora/sdk`](file:///d:/Dev/Projects/vedora/sdks/vedora-sdk)), backend integrations, and CI/CD pipelines.
- **Header**: `x-api-key: ved_live_<prefix>_<secret>`
- **Security**: Keys are hashed using **Argon2id** with salt before persistence in PostgreSQL. Fast authentication is accelerated via dual-tier caching (in-memory LRU + Redis HMAC digest verification).
- **Swagger Authorization**:
  1. Click **Authorize 🔓**.
  2. Under **x-api-key (apiKey, Header)**, enter your API key (e.g. `ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b`).
  3. Click **Authorize**.

---

## ⚠️ Error Handling & Response Envelopes

All errors thrown by the backend are formatted by the global [`AllExceptionsFilter`](file:///d:/Dev/Projects/vedora/services/src/utils/all-exceptions.filter.ts). Internal database errors and stack traces are masked from users, and sensitive URL query tokens are sanitized in server logs.

### 1. Standard Error Envelope (`ErrorResponseDto`)
Returned for `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `413 Payload Too Large`, and `500 Internal Server Error`:

```json
{
  "statusCode": 403,
  "timestamp": "2026-10-27T12:00:00.000Z",
  "path": "/api/v1/videos/init",
  "error": "ForbiddenException",
  "message": "Storage quota cap exceeded for current subscription tier"
}
```

### 2. Validation Error Envelope (`ValidationErrorResponseDto`)
Returned for `400 Bad Request` when DTO constraints fail:

```json
{
  "statusCode": 400,
  "timestamp": "2026-10-27T12:00:00.000Z",
  "path": "/api/v1/videos/init",
  "error": "Bad Request",
  "message": [
    "title must be a string",
    "size must be a positive integer greater than 0",
    "slug must contain only lowercase alphanumeric characters and hyphens (e.g. my-awesome-video)"
  ]
}
```

---

## 📖 Complete Endpoint Reference

### 1. System & Health

#### `GET /api`
- **Tag**: `System`
- **Auth**: Public (No authentication required)
- **Summary**: Platform root welcome status
- **Response**: `200 OK`
  ```text
  Hello World!
  ```

#### `GET /api/v1/health` (also available on `/api/health`)
- **Tag**: `Health`
- **Auth**: Public
- **Summary**: System health check and dependency connectivity
- **Response**: `200 OK` ([`HealthResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/health/dto/health-response.dto.ts))
  ```json
  {
    "status": "ok",
    "service": "vedora-services",
    "version": "1.0.0",
    "timestamp": "2026-10-27T12:00:00.000Z",
    "dependencies": {
      "database": "up",
      "redis": "up"
    }
  }
  ```

---

### 2. API Key Management (`/api/v1/api-keys`)
All endpoints in this module require authentication via **Bearer token** or **API key**.

#### `GET /api/v1/api-keys`
- **Summary**: List all API keys for authenticated caller.
- **Response**: `200 OK` — Array of [`ApiKeyResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/api-key/dto/api-key-response.dto.ts#L3-L37)
  ```json
  [
    {
      "id": "d84b2591-4cf1-45d6-848e-28c04ec5cba7",
      "prefix": "ved_live_d84b2591",
      "createdAt": "2026-10-27T12:00:00.000Z",
      "lastUsedAt": "2026-10-27T12:30:00.000Z",
      "revokedAt": null
    }
  ]
  ```

#### `POST /api/v1/api-keys`
- **Summary**: Generate a new API key.
- **Security Note**: Plaintext secret key is returned **only once**.
- **Response**: `201 Created` — [`CreatedApiKeyResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/api-key/dto/api-key-response.dto.ts#L39-L64)
  ```json
  {
    "id": "d84b2591-4cf1-45d6-848e-28c04ec5cba7",
    "key": "ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b",
    "prefix": "ved_live_d84b2591",
    "createdAt": "2026-10-27T12:00:00.000Z"
  }
  ```

#### `POST /api/v1/api-keys/:id/regenerate`
- **Summary**: Revoke existing key and return a newly generated replacement.
- **Path Parameter**: `id` (UUID or key prefix).
- **Response**: `200 OK` — [`CreatedApiKeyResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/api-key/dto/api-key-response.dto.ts#L39-L64)

#### `POST /api/v1/api-keys/:id/revoke` & `DELETE /api/v1/api-keys/:id`
- **Summary**: Revoke an API key and invalidate Redis and memory caches immediately.
- **Path Parameter**: `id` (UUID).
- **Response**: `200 OK` — [`ActionSuccessResponseDto`](file:///d:/Dev/Projects/vedora/services/src/common/dto/error-response.dto.ts#L76-L92)
  ```json
  {
    "success": true,
    "id": "d84b2591-4cf1-45d6-848e-28c04ec5cba7"
  }
  ```

---

### 3. Playlists (`/api/v1/playlists`)
Protected by [`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts). Enforces an atomic account quota of **10 playlists maximum** via PostgreSQL transaction advisory locks ([`ADR-004`](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-004-database-quota-concurrency.md)).

#### `POST /api/v1/playlists`
- **Summary**: Create a new playlist.
- **Request Body**: [`CreatePlaylistDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/create-playlist.dto.ts)
  ```json
  {
    "name": "Frontend Architecture Masterclass",
    "description": "Curated deep-dives into modern web development and streaming"
  }
  ```
- **Response**: `201 Created` — [`PlaylistResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/playlist-response.dto.ts)
  ```json
  {
    "id": "a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d",
    "userId": "user_2NNEqL2Kz9X4abcdef123456",
    "name": "Frontend Architecture Masterclass",
    "description": "Curated deep-dives into modern web development and streaming",
    "playlistLimit": 100,
    "totalVideos": 0,
    "createdAt": "2026-10-27T12:00:00.000Z"
  }
  ```
- **Errors**: `400 Bad Request` if quota $\ge 10$ or validation fails.

#### `GET /api/v1/playlists`
- **Summary**: List all playlists belonging to user, sorted by `created_at DESC`.
- **Response**: `200 OK` — Array of [`PlaylistResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/playlist-response.dto.ts).

#### `GET /api/v1/playlists/:id`
- **Summary**: Get playlist details by UUID.
- **Response**: `200 OK` — [`PlaylistResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/playlist-response.dto.ts).
- **Errors**: `404 Not Found`.

#### `PUT /api/v1/playlists/:id`
- **Summary**: Update playlist name or description.
- **Request Body**: [`UpdatePlaylistDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/update-playlist.dto.ts)
  ```json
  {
    "name": "Advanced Frontend Architecture",
    "description": "Updated syllabus and module references"
  }
  ```
- **Response**: `200 OK` — [`PlaylistResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/playlist-response.dto.ts).

#### `DELETE /api/v1/playlists/:id`
- **Summary**: Delete a playlist and unlink videos.
- **Response**: `200 OK` — [`ActionSuccessResponseDto`](file:///d:/Dev/Projects/vedora/services/src/common/dto/error-response.dto.ts#L76-L92)

---

### 4. Video Ingestion & Processing (`/api/v1/videos`)
Protected by [`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts) and [`UploadVideoGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/upload-video.guard.ts).

#### `POST /api/v1/videos/init`
- **Summary**: Authorize and initialize a direct-to-cloud upload.
- **Behavior**:
  1. Acquires atomic PostgreSQL advisory lock on storage quota key.
  2. Reserves storage allowance: $\text{Raw Size} + 1.5 \times \text{Raw Size (Transcoding overhead)}$.
  3. Verifies file size against tier limits:
     - **Free**: 500 MB max file size
     - **Starter**: 5 GB max file size
     - **Pro**: 25 GB max file size
     - **Business**: 100 GB max file size
  4. Returns presigned S3-compatible multipart chunk upload URLs.
- **Request Body**: [`CreateVideoInitDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/create-video-init.dto.ts)
  ```json
  {
    "title": "Vedora Direct Upload Tutorial",
    "slug": "vedora-direct-upload-tutorial",
    "size": 104857600,
    "duration": 120,
    "resolutions": ["720p", "1080p"],
    "playlistId": "a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d",
    "description": "In-depth demonstration of multipart upload pipeline and HLS transcode ladder",
    "tags": ["tutorial", "streaming", "hls"],
    "generateSubtitles": true,
    "includeWatermark": false
  }
  ```
- **Response**: `201 Created` — [`VideoInitResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/video-response.dto.ts#L175-L196)
  ```json
  {
    "video": {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "userId": "user_2NNEqL2Kz9X4abcdef123456",
      "playlistId": "a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d",
      "title": "Vedora Direct Upload Tutorial",
      "slug": "vedora-direct-upload-tutorial",
      "description": "In-depth demonstration of multipart upload pipeline and HLS transcode ladder",
      "tags": ["tutorial", "streaming", "hls"],
      "storageKey": "videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4",
      "bucketId": "00000000-0000-0000-0000-000000000001",
      "size": 104857600,
      "estimatedTranscodedSize": 157286400,
      "transcodedSize": null,
      "duration": 120,
      "status": "uploading",
      "resolutions": ["720p", "1080p"],
      "thumbnailUrl": null,
      "generateSubtitles": true,
      "includeWatermark": false,
      "masterM3u8Key": null,
      "createdAt": "2026-10-27T12:00:00.000Z",
      "updatedAt": "2026-10-27T12:00:00.000Z"
    },
    "uploadData": {
      "objectId": "obj_1234567890abcdef",
      "key": "videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4",
      "uploadId": "upl_9f83a2bc4e61d852",
      "partSize": 5242880,
      "parts": [
        {
          "partNumber": 1,
          "url": "http://localhost:8080/api/v1/storage/mock-upload?partNumber=1&uploadId=upl_9f83a2bc4e61d852&key=videos%2F3fa85f64-5717-4562-b3fc-2c963f66afa6%2Fraw.mp4"
        }
      ]
    },
    "bucketId": "00000000-0000-0000-0000-000000000001"
  }
  ```
- **Errors**:
  - `400 Bad Request`: Validation failure on slug, size, or title.
  - `401 Unauthorized`: Missing or invalid token.
  - `403 Forbidden`: Storage quota exceeded, or requesting 1080p/watermark on Free tier.
  - `413 Payload Too Large`: Size exceeds single upload limit for tier.

#### `POST /api/v1/videos/complete`
- **Summary**: Confirm upload completion and trigger background transcoding.
- **Request Body**: [`CompleteVideoUploadDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/complete-video-upload.dto.ts)
  ```json
  {
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "storageKey": "videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/raw.mp4",
    "duration": 120,
    "uploadId": "upl_9f83a2bc4e61d852",
    "parts": [
      {
        "PartNumber": 1,
        "ETag": "\"mock-etag-1-1730000000000\""
      }
    ]
  }
  ```
- **Response**: `200 OK` — [`VideoResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/video-response.dto.ts#L46-L173) (status transitions to `"uploaded"`, transcode job enqueued).

#### `GET /api/v1/videos`
- **Summary**: List all videos for authenticated caller.
- **Query Parameter**: `playlistId` (optional UUID filter).
- **Response**: `200 OK` — Array of [`VideoResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/video-response.dto.ts#L46-L173).

#### `GET /api/v1/videos/:id`
- **Summary**: Fetch video details, master HLS playlist path, and transcoding status.
- **Response**: `200 OK` — [`VideoResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/video-response.dto.ts#L46-L173).

#### `DELETE /api/v1/videos/:id`
- **Summary**: Delete video, release storage quota, purge storage files, and update playlist count.
- **Response**: `200 OK` — [`ActionSuccessResponseDto`](file:///d:/Dev/Projects/vedora/services/src/common/dto/error-response.dto.ts#L76-L92)

---

### 5. Storage & Chunk Streaming (`/api/v1/storage`)

#### `ALL /api/v1/storage/mock-upload`
- **Summary**: Resilient multipart chunk upload receiver for local development or fallback mode.
- **Query Parameters**:
  - `partNumber`: sequential part index (e.g. `1`)
  - `uploadId`: session upload ID (e.g. `upl_9f83a2bc4e61d852`)
  - `key`: storage key (e.g. `videos/vid-1/raw.mp4`)
- **Headers Returned**: `ETag: "mock-etag-1-1730000000000"`
- **Response**: `200 OK` — [`StorageUploadResponseDto`](file:///d:/Dev/Projects/vedora/services/src/infra/storage/dto/storage-upload-response.dto.ts)
  ```json
  {
    "success": true,
    "partNumber": 1,
    "uploadId": "upl_9f83a2bc4e61d852",
    "etag": "\"mock-etag-1-1730000000000\""
  }
  ```

#### `GET /api/v1/storage/stream`
- **Summary**: Streams video file or HLS manifest. Supports seeking via standard HTTP `Range` headers.
- **Query Parameter**: `key` (required storage key path, e.g. `videos/vid-1/master.m3u8` or raw mp4).
- **Request Header**: `Range: bytes=0-1048575` (optional)
- **Responses**:
  - `200 OK`: Full video binary stream or manifest content.
  - `206 Partial Content`: Chunk range with `Content-Range: bytes 0-1048575/104857600`.
  - `307 Temporary Redirect`: Redirect to fallback test stream if local file missing.

---

### 6. Transcoding Engine (`/api/v1/transcoder`)

#### `POST /api/v1/transcoder/webhook`
- **Auth**: Public endpoint authenticated via HMAC-SHA256 signature ([`ADR-008`](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-008-hls-transcoding-and-rendition-ladder.md)).
- **Header**: `x-transcoder-signature: <hmac_hex>`
- **Request Body**: [`TranscoderWebhookDto`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/dto/transcoder-webhook.dto.ts)
  ```json
  {
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "masterKey": "videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/master.m3u8",
    "totalDuration": 120,
    "renditions": ["720p", "1080p"],
    "transcodedSize": 142606336,
    "status": "completed"
  }
  ```
- **Response**: `200 OK` — [`TranscoderWebhookResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/dto/transcoder-response.dto.ts#L3-L16)
  ```json
  {
    "success": true,
    "message": "Webhook processed successfully"
  }
  ```

#### `POST /api/v1/transcoder/process/:videoId`
- **Auth**: Protected by [`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts).
- **Summary**: Enqueue manual background transcode job in BullMQ queue.
- **Response**: `202 Accepted` — [`TranscoderProcessResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/dto/transcoder-response.dto.ts#L18-L31)
  ```json
  {
    "status": "enqueued",
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6"
  }
  ```

---

### 7. Player Settings & Public Embeds (`/api/v1/player-settings`)

#### `GET /api/v1/player-settings`
- **Auth**: Protected.
- **Summary**: Get custom player styling, brand accent colors, controls, and watermark settings.
- **Response**: `200 OK` — [`PlayerSettingsResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/player-settings/dto/player-settings-response.dto.ts#L3-L73)

#### `PUT /api/v1/player-settings`
- **Auth**: Protected.
- **Summary**: Update player theme, colors, watermark position, and toolbar controls.
- **Request Body**: [`UpdatePlayerSettingsDto`](file:///d:/Dev/Projects/vedora/services/src/modules/player-settings/dto/update-player-settings.dto.ts)
  ```json
  {
    "primaryColor": "#3b82f6",
    "controlBarBg": "rgba(0, 0, 0, 0.7)",
    "playIconStyle": "glow",
    "watermarkUrl": "https://cdn.vedora.com/watermarks/user_123.png",
    "watermarkPosition": "bottom-right",
    "watermarkOpacity": 80,
    "enableSubtitles": true,
    "enabledControls": [
      "Play / Pause",
      "10s Backward",
      "10s Forward",
      "Full Screen",
      "Volume",
      "Progress",
      "Settings"
    ]
  }
  ```
- **Response**: `200 OK` — [`PlayerSettingsResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/player-settings/dto/player-settings-response.dto.ts#L3-L73).

#### `GET /api/v1/player-settings/public/:videoId`
- **Auth**: Public (Consumed by iframe player embeds and SDK components).
- **Summary**: Resolves video stream URL (.m3u8 / MP4) and player watermark configuration without authentication.
- **Response**: `200 OK` — [`PublicPlayerConfigResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/player-settings/dto/player-settings-response.dto.ts#L75-L157)
  ```json
  {
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "title": "Vedora Direct Upload Tutorial",
    "streamUrl": "http://localhost:8080/api/v1/storage/stream?key=videos%2F3fa85f64-5717-4562-b3fc-2c963f66afa6%2Fmaster.m3u8",
    "primaryColor": "#3b82f6",
    "controlBarBg": "rgba(0, 0, 0, 0.7)",
    "playIconStyle": "default",
    "watermarkUrl": "https://cdn.vedora.com/branding/vedora-watermark.png",
    "watermarkText": "Powered by Vedora",
    "watermarkPosition": "bottom-right",
    "watermarkOpacity": 80,
    "enableSubtitles": true,
    "enabledControls": ["Play / Pause", "10s Backward", "10s Forward", "Full Screen", "Volume", "Progress"],
    "isFreeTier": true
  }
  ```

---

### 8. Analytics & Telemetry (`/api/v1/analytics`)

#### `POST /api/v1/analytics/segment-ping`
- **Auth**: Public.
- **Summary**: Lightweight playback heartbeat ping ingested every 10 seconds during viewer playback.
- **Headers**:
  - `user-agent`: Client browser string for device and browser classification.
  - `referer`: Host page URL.
  - `cf-ipcountry`: Country code from edge CDN.
- **Request Body**: [`SegmentPingDto`](file:///d:/Dev/Projects/vedora/services/src/modules/analytics/dto/segment-ping.dto.ts)
  ```json
  {
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "sessionId": "sess_9f83a2bc4e61",
    "watchDurationSeconds": 10,
    "segmentsRequested": 2
  }
  ```
- **Response**: `200 OK` — [`SegmentPingResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/analytics/dto/analytics-response.dto.ts#L3-L9)
  ```json
  {
    "acknowledged": true
  }
  ```

#### `GET /api/v1/analytics/metrics`
- **Auth**: Protected.
- **Summary**: Aggregated analytics metrics over a selected time window.
- **Query Parameters**:
  - `window`: `'7d' | '30d' | '90d'` (default `'30d'`).
  - `videoId`: optional UUID filter.
- **Response**: `200 OK` — [`MetricsResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/analytics/dto/analytics-response.dto.ts#L79-L131)
  ```json
  {
    "totalViews": 1250,
    "totalWatchTimeSeconds": 110000,
    "totalWatchTimeMinutes": 1833,
    "uniqueViewers": 940,
    "avgDurationSeconds": 88,
    "deviceBreakdown": [
      { "name": "desktop", "value": 65, "color": "#3b82f6" },
      { "name": "mobile", "value": 30, "color": "#10b981" },
      { "name": "tablet", "value": 5, "color": "#f59e0b" }
    ],
    "browserBreakdown": [
      { "browser": "Chrome", "share": 72.5 },
      { "browser": "Safari", "share": 18.2 },
      { "browser": "Firefox", "share": 6.1 },
      { "browser": "Edge", "share": 3.2 }
    ],
    "viewsOverTime": [
      { "date": "2026-10-25", "views": 120 },
      { "date": "2026-10-26", "views": 155 },
      { "date": "2026-10-27", "views": 180 }
    ],
    "topVideos": [
      {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "title": "Vedora Direct Upload Tutorial",
        "views": 850,
        "watchTimeMinutes": 1250,
        "avgDurationSeconds": 88
      }
    ]
  }
  ```

---

### 9. Billing & Subscriptions (`/api/v1/billing`)

#### `POST /api/v1/billing/webhook`
- **Auth**: Public endpoint verified via Stripe cryptographic signature ([`ADR-010`](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-010-subscription-billing-and-usage-accounting.md)).
- **Header**: `stripe-signature: t=...,v1=...`
- **Request Body**: [`BillingWebhookDto`](file:///d:/Dev/Projects/vedora/services/src/modules/billing/dto/billing-webhook.dto.ts)
  ```json
  {
    "type": "customer.subscription.updated",
    "data": {
      "object": {
        "id": "sub_1Q123456789",
        "customer": "cus_123456789",
        "status": "active",
        "current_period_start": 1730000000,
        "current_period_end": 1732678400
      }
    },
    "id": "evt_1Qabcdef123456"
  }
  ```
- **Response**: `200 OK` — [`BillingWebhookResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/billing/dto/subscription-response.dto.ts#L69-L81)
  ```json
  {
    "success": true,
    "event": "customer.subscription.updated"
  }
  ```

#### `GET /api/v1/billing/subscription`
- **Auth**: Protected.
- **Summary**: Fetch current plan tier, playback minutes allowance, minutes used, and renewal dates.
- **Response**: `200 OK` — [`SubscriptionResponseDto`](file:///d:/Dev/Projects/vedora/services/src/modules/billing/dto/subscription-response.dto.ts#L3-L67)
  ```json
  {
    "id": "sub_rec_1234567890",
    "userId": "user_2NNEqL2Kz9X4abcdef123456",
    "plan": "pro",
    "displayName": "Pro Plan",
    "status": "active",
    "allocatedMinutes": 10000,
    "usedMinutes": 1833,
    "remainingMinutes": 8167,
    "usagePercent": 18,
    "storageCapBytes": "26843545600",
    "currentPeriodStart": "2026-10-01T00:00:00.000Z",
    "currentPeriodEnd": "2026-11-01T00:00:00.000Z"
  }
  ```

---

## 🛠️ Testing & Importing the OpenAPI Specification

### Regenerating `docs/openapi.json`
Run the automated documentation test to export the latest OpenAPI document:
```bash
npm --prefix services run test -- src/swagger.spec.ts
```

### Importing into API Clients
1. **Postman**: Click **Import** -> Select file -> Choose [`docs/openapi.json`](file:///d:/Dev/Projects/vedora/docs/openapi.json).
2. **Insomnia**: Click **Create** -> **Import from File** -> Choose [`docs/openapi.json`](file:///d:/Dev/Projects/vedora/docs/openapi.json).
3. **TypeScript Client Generation**:
   ```bash
   npx @openapitools/openapi-generator-cli generate \
     -i docs/openapi.json \
     -g typescript-axios \
     -o clients/typescript
   ```
