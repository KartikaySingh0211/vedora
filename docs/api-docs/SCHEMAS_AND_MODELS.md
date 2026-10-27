# Vedora — Schemas & Data Models Reference

This document provides a comprehensive dictionary of all Data Transfer Objects (DTOs), request bodies, response models, and error envelopes registered in Vedora's Swagger / OpenAPI 3.0 specification.

---

## 📌 Table of Contents

1. [Standard Envelopes & Error Models](#1-standard-envelopes--error-models)
2. [Health & Diagnostics Models](#2-health--diagnostics-models)
3. [API Key Management Models](#3-api-key-management-models)
4. [Playlist Models](#4-playlist-models)
5. [Video Ingestion & Catalog Models](#5-video-ingestion--catalog-models)
6. [Storage & Multipart Models](#6-storage--multipart-models)
7. [Transcoding Engine Models](#7-transcoding-engine-models)
8. [Player Settings & Embed Models](#8-player-settings--embed-models)
9. [Analytics & Telemetry Models](#9-analytics--telemetry-models)
10. [Subscription & Billing Models](#10-subscription--billing-models)

---

## 1. Standard Envelopes & Error Models

Defined in [`services/src/common/dto/error-response.dto.ts`](file:///d:/Dev/Projects/vedora/services/src/common/dto/error-response.dto.ts).

### `ErrorResponseDto`
Returned for `401`, `403`, `404`, `413`, and `500` HTTP exceptions.

| Field | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `statusCode` | `number` | Yes | HTTP status code | `403` |
| `timestamp` | `string` | Yes | ISO 8601 UTC timestamp of the error | `2026-10-27T12:00:00.000Z` |
| `path` | `string` | Yes | Request URI path that generated the exception | `/api/v1/videos/init` |
| `error` | `string` | Yes | High-level HTTP error category or exception name | `ForbiddenException` |
| `message` | `string` | Yes | Human-readable explanation of failure | `Storage quota cap exceeded for current subscription tier` |

### `ValidationErrorResponseDto`
Returned for `400 Bad Request` when class-validator constraints fail on request payloads.

| Field | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `statusCode` | `number` | Yes | HTTP status code (always 400) | `400` |
| `timestamp` | `string` | Yes | ISO 8601 UTC timestamp | `2026-10-27T12:00:00.000Z` |
| `path` | `string` | Yes | Request URI path | `/api/v1/videos/init` |
| `error` | `string` | Yes | Error name | `Bad Request` |
| `message` | `string[]` | Yes | Array of validation constraint violation messages | `["title must be a string", "size must be a positive integer"]` |

### `ActionSuccessResponseDto`
Generic confirmation response for mutation or deletion operations.

| Field | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `success` | `boolean` | Yes | Whether the operation completed successfully | `true` |
| `id` | `string` | No | Identifier of the affected entity (optional) | `3fa85f64-5717-4562-b3fc-2c963f66afa6` |

---

## 2. Health & Diagnostics Models

Defined in [`services/src/modules/health/dto/health-response.dto.ts`](file:///d:/Dev/Projects/vedora/services/src/modules/health/dto/health-response.dto.ts).

### `HealthResponseDto`
Status report returned by `GET /api/v1/health`.

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `status` | `'ok' \| 'degraded'` | System health status | `'ok'` |
| `service` | `string` | Service identifier | `'vedora-services'` |
| `version` | `string` | Application semantic version | `'1.0.0'` |
| `timestamp` | `string` | Current server ISO timestamp | `'2026-10-27T12:00:00.000Z'` |
| `dependencies` | `HealthDependenciesDto` | State of database and Redis connections | `{"database": "up", "redis": "up"}` |

---

## 3. API Key Management Models

Defined in [`services/src/modules/api-key/dto/api-key-response.dto.ts`](file:///d:/Dev/Projects/vedora/services/src/modules/api-key/dto/api-key-response.dto.ts).

### `ApiKeyResponseDto`
Safe API key metadata returned in `GET /api/v1/api-keys`. Plaintext secret is never included.

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | Unique API key database record ID | `'d84b2591-4cf1-45d6-848e-28c04ec5cba7'` |
| `prefix` | `string` | First 16 characters used for identification | `'ved_live_d84b2591'` |
| `createdAt` | `string` | ISO timestamp of key generation | `'2026-10-27T12:00:00.000Z'` |
| `lastUsedAt` | `string \| null` | Debounced last activity timestamp | `'2026-10-27T12:30:00.000Z'` |
| `revokedAt` | `string \| null` | Revocation timestamp (null if active) | `null` |

### `CreatedApiKeyResponseDto`
Returned on key generation (`POST /api/v1/api-keys`) or regeneration.

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | Unique key identifier | `'d84b2591-4cf1-45d6-848e-28c04ec5cba7'` |
| `key` | `string` | **Plaintext secret key (shown only once)** | `'ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b'` |
| `prefix` | `string` | Public key prefix | `'ved_live_d84b2591'` |
| `createdAt` | `string` | Key creation timestamp | `'2026-10-27T12:00:00.000Z'` |

---

## 4. Playlist Models

Defined in [`services/src/modules/playlist/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/playlist/dto/).

### `CreatePlaylistDto`
| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | Min: 1, Max: 100 | Display title of playlist |
| `description` | `string` | No | Max: 500 | Optional description |

### `PlaylistResponseDto`
| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | Playlist unique ID | `'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d'` |
| `userId` | `string` | Owner user ID | `'user_2NNEqL2Kz9X4abcdef123456'` |
| `name` | `string` | Playlist name | `'Frontend Architecture Masterclass'` |
| `description` | `string \| null` | Playlist description | `'Curated deep-dives into modern web development'` |
| `playlistLimit` | `number` | Per-user playlist quota ceiling | `10` |
| `totalVideos` | `number` | Number of videos linked to playlist | `0` |
| `createdAt` | `string` | Creation timestamp | `'2026-10-27T12:00:00.000Z'` |

---

## 5. Video Ingestion & Catalog Models

Defined in [`services/src/modules/videos/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/videos/dto/).

### `CreateVideoInitDto`
Request body for `POST /api/v1/videos/init`.

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `title` | `string` | Yes | 1-255 chars | Video display title |
| `slug` | `string` | Yes | Regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$` | URL-safe slug |
| `size` | `number` | Yes | Positive integer (> 0 bytes) | Raw input file size |
| `duration` | `number` | Yes | Positive number (> 0 seconds) | Video duration in seconds |
| `resolutions` | `string[]` | No | Enum: `['360p', '480p', '720p', '1080p']` | Target transcoded renditions |
| `playlistId` | `string` | No | Valid UUID | Optional playlist attachment |
| `description` | `string` | No | Max: 2000 chars | Video description |
| `tags` | `string[]` | No | Array of strings | Categorization tags |
| `generateSubtitles` | `boolean` | No | Default: `true` | AI subtitle generation flag |
| `includeWatermark` | `boolean` | No | Default: `false` | Custom watermark toggle |

### `CompleteVideoUploadDto`
Request body for `POST /api/v1/videos/complete`.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `videoId` | `string` (UUID) | Yes | Identifier returned by `init` |
| `storageKey` | `string` | Yes | Storage key returned by `init` |
| `duration` | `number` | Yes | Final verified video duration in seconds |
| `uploadId` | `string` | Yes | Multipart upload session ID |
| `parts` | `CompletedPartDto[]` | Yes | List of uploaded parts with ETags |

### `VideoResponseDto`
Catalog record for video entity:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | Video ID | `'3fa85f64-5717-4562-b3fc-2c963f66afa6'` |
| `userId` | `string` | Owner ID | `'user_2NNEqL2Kz9X4abcdef123456'` |
| `playlistId` | `string \| null` | Playlist ID | `'a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d'` |
| `title` | `string` | Video title | `'Vedora Direct Upload Tutorial'` |
| `slug` | `string` | URL slug | `'vedora-direct-upload-tutorial'` |
| `status` | `string` | `'uploading' \| 'uploaded' \| 'processing' \| 'ready' \| 'failed'` | `'ready'` |
| `size` | `number` | Raw byte size | `104857600` |
| `estimatedTranscodedSize` | `number` | Quota reservation | `157286400` |
| `transcodedSize` | `number \| null` | Final size | `142606336` |
| `duration` | `number` | Duration (sec) | `120` |
| `masterM3u8Key` | `string \| null` | HLS master manifest storage key | `'videos/.../master.m3u8'` |

---

## 6. Storage & Multipart Models

Defined in [`services/src/infra/storage/dto/storage-upload-response.dto.ts`](file:///d:/Dev/Projects/vedora/services/src/infra/storage/dto/storage-upload-response.dto.ts).

### `StorageUploadResponseDto`
Response for multipart chunk uploads (`ALL /api/v1/storage/mock-upload`).

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `success` | `boolean` | Upload success confirmation | `true` |
| `partNumber` | `number` | 1-based sequential part index | `1` |
| `uploadId` | `string` | Multipart upload session ID | `'upl_9f83a2bc4e61d852'` |
| `etag` | `string` | S3-compatible chunk ETag identifier | `'"mock-etag-1-1730000000000"'` |

---

## 7. Transcoding Engine Models

Defined in [`services/src/modules/transcoder/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/transcoder/dto/).

### `TranscoderWebhookDto`
Signed payload posted to `POST /api/v1/transcoder/webhook`.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `videoId` | `string` (UUID) | Yes | Target video ID |
| `masterKey` | `string` | Yes | Path to generated `master.m3u8` |
| `totalDuration` | `number` | Yes | Verified video duration in seconds |
| `renditions` | `string[]` | Yes | Transcoded ladders (e.g. `['720p', '1080p']`) |
| `transcodedSize` | `number` | Yes | Cumulative byte size of all HLS TS chunks |
| `status` | `'completed' \| 'failed'` | Yes | Transcode outcome |
| `error` | `string` | No | Failure details if status is `'failed'` |

---

## 8. Player Settings & Embed Models

Defined in [`services/src/modules/player-settings/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/player-settings/dto/).

### `UpdatePlayerSettingsDto`
Request body for customizing player branding:

| Field | Type | Constraints | Example |
| :--- | :--- | :--- | :--- |
| `primaryColor` | `string` | Hex color code | `'#3b82f6'` |
| `controlBarBg` | `string` | CSS color / rgba | `'rgba(0, 0, 0, 0.7)'` |
| `playIconStyle` | `string` | `'default' \| 'glow' \| 'minimal'` | `'glow'` |
| `watermarkUrl` | `string` | Valid URL | `'https://cdn.vedora.com/logos/brand.png'` |
| `watermarkPosition` | `string` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` |
| `watermarkOpacity` | `number` | 0 to 100 integer | `80` |
| `enableSubtitles` | `boolean` | Boolean | `true` |
| `enabledControls` | `string[]` | Array of control names | `['Play / Pause', 'Volume', 'Full Screen']` |

### `PublicPlayerConfigResponseDto`
Public model for embed players (`GET /api/v1/player-settings/public/:videoId`):
Returns the resolved streaming URL and theme settings. On Free tier, `isFreeTier: true` enforces the "Powered by Vedora" watermark.

---

## 9. Analytics & Telemetry Models

Defined in [`services/src/modules/analytics/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/analytics/dto/).

### `SegmentPingDto`
Payload for 10-second playback heartbeat (`POST /api/v1/analytics/segment-ping`).

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `videoId` | `string` (UUID) | Yes | Valid UUID | Target video |
| `sessionId` | `string` | Yes | Non-empty string | Client playback session ID |
| `watchDurationSeconds` | `number` | Yes | 1 to 30 | Incremental watch time |
| `segmentsRequested` | `number` | No | Positive integer | HLS segments fetched in window |

### `MetricsResponseDto`
Aggregated reporting model returned by `GET /api/v1/analytics/metrics`:
- `totalViews`: Cumulative view count
- `totalWatchTimeSeconds` / `totalWatchTimeMinutes`: Total watch duration
- `uniqueViewers`: Count of distinct pseudonymous sessions
- `avgDurationSeconds`: Average viewer engagement
- `deviceBreakdown`: Percentages for desktop, mobile, tablet
- `browserBreakdown`: Shares for Chrome, Safari, Firefox, Edge
- `viewsOverTime`: Date-indexed time-series datapoints
- `topVideos`: Ranked list of top performing media

---

## 10. Subscription & Billing Models

Defined in [`services/src/modules/billing/dto/`](file:///d:/Dev/Projects/vedora/services/src/modules/billing/dto/).

### `SubscriptionResponseDto`
Detailed quota and entitlement record for caller:

| Field | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Stripe subscription record ID | `'sub_rec_1234567890'` |
| `userId` | `string` | Owner user ID | `'user_2NNEqL2Kz9X4abcdef123456'` |
| `plan` | `string` | Tier: `'free' \| 'starter' \| 'pro' \| 'business'` | `'pro'` |
| `displayName` | `string` | Human-readable plan name | `'Pro Plan'` |
| `status` | `string` | Subscription status | `'active'` |
| `allocatedMinutes` | `number` | Monthly playback-minute allowance | `10000` |
| `usedMinutes` | `number` | Minutes consumed in current billing period | `1833` |
| `remainingMinutes` | `number` | Available balance | `8167` |
| `usagePercent` | `number` | Percentage consumed (0-100) | `18` |
| `storageCapBytes` | `string` | Maximum cumulative storage quota in bytes | `'26843545600'` (25 GB) |
| `currentPeriodStart` | `string` | Period start ISO timestamp | `'2026-10-01T00:00:00.000Z'` |
| `currentPeriodEnd` | `string` | Period renewal ISO timestamp | `'2026-11-01T00:00:00.000Z'` |
