# Vedora — Webhooks & Asynchronous Events Reference

This document details the webhook interfaces in the Vedora API, including cryptographic signature verification protocols, payload schemas, and procedures for testing webhooks via Swagger UI or command-line utilities.

---

## 📌 Table of Contents

1. [Webhooks Overview](#1-webhooks-overview)
2. [Transcoder Webhook (`POST /api/v1/transcoder/webhook`)](#2-transcoder-webhook-post-apiv1transcoderwebhook)
3. [Stripe Billing Webhook (`POST /api/v1/billing/webhook`)](#3-stripe-billing-webhook-post-apiv1billingwebhook)
4. [Testing Webhooks Locally via Swagger UI & cURL](#4-testing-webhooks-locally-via-swagger-ui--curl)

---

## 1. Webhooks Overview

Vedora exposes two asynchronous webhook ingestion endpoints:

| Endpoint | Sender | Purpose | Signature Header | Security Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **`POST /api/v1/transcoder/webhook`** | Transcoding Worker / Cloud Worker | Notifies transcode completion or failure, reports renditions, and final storage size | `x-transcoder-signature` | HMAC-SHA256 signature calculated over raw body |
| **`POST /api/v1/billing/webhook`** | Stripe Billing Service | Syncs subscription state, tier upgrades/downgrades, and renewals | `stripe-signature` | Stripe cryptographic signature verification via `stripe.webhooks.constructEvent` |

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

## 3. Stripe Billing Webhook (`POST /api/v1/billing/webhook`)

### Authentication & Signature Verification

The Stripe webhook endpoint uses Stripe's native SDK signature verification to prevent replay attacks and verify sender authenticity.

#### Header:
```
stripe-signature: t=1730000000,v1=5257a869e7ece2259f452e6...
Content-Type: application/json
```

### Supported Event Types

| Event Name | Processing Behavior |
| :--- | :--- |
| **`customer.subscription.created`** | Provisions customer subscription tier, sets playback-minute cap, and updates active subscription record. |
| **`customer.subscription.updated`** | Modifies allocated minutes, updates storage tier cap, or sets status to `canceled` / `past_due`. |
| **`customer.subscription.deleted`** | Downgrades customer to `free` tier limits (500 MB max file size, 100 minutes/month). |
| **`invoice.paid`** | Acknowledges payment renewal and triggers monthly minute usage reset. |

### Request Payload (`BillingWebhookDto`)
```json
{
  "type": "customer.subscription.updated",
  "data": {
    "object": {
      "id": "sub_1Q123456789",
      "customer": "cus_123456789",
      "status": "active",
      "current_period_start": 1730000000,
      "current_period_end": 1732678400,
      "items": {
        "data": [
          {
            "price": {
              "id": "price_pro_tier_monthly",
              "product": "prod_pro_tier"
            }
          }
        ]
      }
    }
  },
  "id": "evt_1Qabcdef123456"
}
```

### Response
- **`200 OK`**:
  ```json
  {
    "success": true,
    "event": "customer.subscription.updated"
  }
  ```
- **`400 Bad Request`**: Missing `stripe-signature` header or invalid payload structure.

---

## 4. Testing Webhooks Locally via Swagger UI & cURL

### Testing in Swagger UI
1. Navigate to `http://localhost:8080/api/docs`.
2. Expand the **Transcoder** or **Billing** tag.
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

#### Stripe CLI Forwarding:
For testing Stripe webhooks against your local development environment:
```bash
# Listen and forward Stripe events to NestJS
stripe listen --forward-to localhost:8080/api/v1/billing/webhook
```
