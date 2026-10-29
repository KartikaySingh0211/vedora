# Vedora — Webhooks & Asynchronous Events Reference

This document details the webhook interfaces in the Vedora API, including cryptographic signature verification protocols, payload schemas, and procedures for testing webhooks via Swagger UI or command-line utilities.

---

## 📌 Table of Contents

1. [Webhooks Overview](#1-webhooks-overview)
2. [Transcoder Webhook (`POST /api/v1/transcoder/webhook`)](#2-transcoder-webhook-post-apiv1transcoderwebhook)
3. [Testing Webhooks Locally via Swagger UI & cURL](#3-testing-webhooks-locally-via-swagger-ui--curl)

---

## 1. Webhooks Overview

Vedora exposes an asynchronous webhook ingestion endpoint for transcoding status updates:

| Endpoint | Sender | Purpose | Signature Header | Security Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **`POST /api/v1/transcoder/webhook`** | Transcoding Worker / Cloud Worker | Notifies transcode completion or failure, reports renditions, and final storage size | `x-transcoder-signature` | HMAC-SHA256 signature calculated over raw body |

---

## 2. Transcoder Webhook (`POST /api/v1/transcoder/webhook`)

### Authentication & Signature Verification

When the transcoding pipeline completes processing a video, the worker issues an HTTP POST request to this endpoint. The request includes an HMAC-SHA256 digest calculated using the shared secret (`TRANSCODER_SECRET` or `API_KEY_DIGEST_SECRET`).

#### Header:
```
x-transcoder-signature: <hex_encoded_hmac_sha256>
Content-Type: application/json
```

#### Calculating the Signature (Node.js Example):
```typescript
import * as crypto from 'crypto';

const secret = process.env.TRANSCODER_SECRET || 'your-transcoder-secret';
const payload = JSON.stringify({
  videoId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  masterKey: 'videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/master.m3u8',
  totalDuration: 120,
  renditions: ['720p', '1080p'],
  transcodedSize: 142606336,
  status: 'completed',
});

const signature = crypto
  .createHmac('sha256', secret)
  .update(payload)
  .digest('hex');
```

### Request Payload (`TranscoderWebhookDto`)
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

### Response
- **`200 OK`**:
  ```json
  {
    "success": true,
    "message": "Webhook processed successfully"
  }
  ```
- **`400 Bad Request`**: Validation failure or signature mismatch.
- **`404 Not Found`**: Video ID does not exist in the database.

---

## 3. Testing Webhooks Locally via Swagger UI & cURL

### Testing in Swagger UI
1. Navigate to `http://localhost:8080/api/docs`.
2. Expand the **Transcoder** tag.
3. Click **Try it out**.
4. The request body is pre-filled with a valid, working sample.
5. In a development environment without signature enforcement enabled, simply click **Execute** to verify the controller handler.

### Testing with cURL

#### Transcoder Webhook Simulation:
```bash
curl -X POST "http://localhost:8080/api/v1/transcoder/webhook" \
  -H "Content-Type: application/json" \
  -H "x-transcoder-signature: dev-bypass" \
  -d '{
    "videoId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "masterKey": "videos/3fa85f64-5717-4562-b3fc-2c963f66afa6/master.m3u8",
    "totalDuration": 120,
    "renditions": ["720p", "1080p"],
    "transcodedSize": 142606336,
    "status": "completed"
  }'
```
