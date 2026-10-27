# Vedora — Authentication & Authorization Guide

This document provides complete implementation specifications for authenticating against the Vedora API, configuring security credentials in Swagger UI, and understanding the backend cryptographic guard architecture.

---

## 📌 Table of Contents

1. [Dual Authentication Architecture Overview](#1-dual-authentication-architecture-overview)
2. [Clerk Session JWT (`Bearer`)](#2-clerk-session-jwt-bearer)
3. [Vedora API Key (`x-api-key`)](#3-vedora-api-key-x-api-key)
4. [DualAuthGuard Internal Workflow](#4-dualauthguard-internal-workflow)
5. [Configuring Authentication in Swagger UI](#5-configuring-authentication-in-swagger-ui)
6. [Code Examples (cURL, Fetch, TypeScript SDK)](#6-code-examples-curl-fetch-typescript-sdk)
7. [API Key Revocation & Cache Invalidation](#7-api-key-revocation--cache-invalidation)

---

## 1. Dual Authentication Architecture Overview

Vedora serves two distinct consumer profiles through a unified [`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts):

```
                                  Incoming Request
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Check Authorization Headers        │
                      └───────────────────┬───────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
       `Authorization: Bearer ...`                        `x-api-key: ...`
                  │                                               │
                  ▼                                               ▼
     ┌────────────────────────┐                     ┌────────────────────────┐
     │  Clerk Backend SDK     │                     │  API Key Engine        │
     │  - JWT Signature       │                     │  L1: In-Memory LRU     │
     │  - Expiration Check    │                     │  L2: Redis Digest LRU  │
     │  - User Identity Map   │                     │  L3: Argon2id Verify   │
     └────────────┬───────────┘                     └────────────┬───────────┘
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          │
                                          ▼
                         Attach `request.user` Context:
                         { id: "user_...", email: "..." }
                                          │
                                          ▼
                                Route Execution
```

---

## 2. Clerk Session JWT (`Bearer`)

- **Primary Consumers**: Web application dashboard (`apps/main-dashboard`).
- **Header**: `Authorization: Bearer <clerk_jwt_token>`
- **Validation**:
  - Validated cryptographically via Clerk's public JWKS.
  - Automatically extracts user ID (`user_...`) and sets `req.user.id`.
- **Swagger Security Scheme**:
  ```yaml
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
  ```

---

## 3. Vedora API Key (`x-api-key`)

- **Primary Consumers**: Backend microservices, CI/CD pipelines, and the custom TypeScript SDK ([`@vedora/sdk`](file:///d:/Dev/Projects/vedora/sdks/vedora-sdk)).
- **Header**: `x-api-key: <key>`
- **Key Structure**:
  ```
  ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b
  │       │                                │
  │       │                                └─ 24-character random hex secret
  │       └─ 32-character random hex prefix (used for DB lookup & LRU caching)
  └─ Constant environment prefix ('ved_live_' or 'ved_test_')
  ```

### Cryptographic Security Properties
1. **Argon2id Hashing**: Plaintext keys are never stored in the database. The secret component is hashed with salt using Argon2id (`timeCost: 3`, `memoryCost: 65536`, `parallelism: 4`).
2. **Deterministic Digest Indexing**: For high-throughput caching, the key is indexed in Redis using an HMAC-SHA256 digest keyed with `API_KEY_DIGEST_SECRET`.
3. **One-Time Secret Presentation**: When a key is created via `POST /api/v1/api-keys`, the plaintext string is shown once. If lost, the caller must call `POST /api/v1/api-keys/:id/regenerate`.

---

## 4. DualAuthGuard Internal Workflow

The [`DualAuthGuard`](file:///d:/Dev/Projects/vedora/services/src/guards/dual-auth.guard.ts) executes the following verification hierarchy:

1. **Header Inspection**:
   - If `Authorization` header with `Bearer <token>` is present, evaluate Clerk token.
   - If `x-api-key` header is present, evaluate API key.
   - If both or neither are present, fallback to prioritizing Bearer, then API key.
2. **3-Tier Key Verification**:
   - **Tier 1 (Local LRU Cache)**: Checked in-memory (< 0.1ms latency). Bounded to 5,000 entries with 5-minute TTL.
   - **Tier 2 (Distributed Redis)**: Checked via HMAC digest (< 1ms latency). Avoids expensive Argon2id hashing for repeated calls.
   - **Tier 3 (Neon PostgreSQL)**: If cache miss, queries database by prefix, verifies Argon2id hash, and populates Tier 1 and Tier 2 caches.
3. **Debounced Activity Tracking**:
   - On successful authentication, updates `last_used_at` asynchronously with a 15-minute debounce window to eliminate write contention on the PostgreSQL primary.

---

## 5. Configuring Authentication in Swagger UI

To execute authenticated requests directly from [Swagger UI (`http://localhost:8080/api/docs`)](file:///d:/Dev/Projects/vedora/docs/api-docs/SWAGGER_GUIDE.md#3-interactive-swagger-ui-testing-guide):

1. Click **Authorize 🔓** at the top right of the page.
2. For User authentication:
   - Scroll to **bearer (http, Bearer)**.
   - Paste your active session token.
   - Click **Authorize**.
3. For API key authentication:
   - Scroll to **x-api-key (apiKey, Header)**.
   - Paste your API key (e.g. `ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b`).
   - Click **Authorize**.
4. Click **Close**. All protected endpoints will include the credentials in subsequent "Try it out" executions.

---

## 6. Code Examples (cURL, Fetch, TypeScript SDK)

### cURL

#### Using API Key:
```bash
curl -X GET "http://localhost:8080/api/v1/videos" \
  -H "x-api-key: ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b" \
  -H "Accept: application/json"
```

#### Using Bearer JWT:
```bash
curl -X GET "http://localhost:8080/api/v1/videos" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..." \
  -H "Accept: application/json"
```

### Fetch (Node.js / Browser)

```typescript
const response = await fetch('http://localhost:8080/api/v1/videos', {
  method: 'GET',
  headers: {
    'x-api-key': 'ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b',
    'Content-Type': 'application/json',
  },
});
const data = await response.json();
```

### Custom TypeScript SDK (`@vedora/sdk`)

```typescript
import { VedoraUploader } from '@vedora/sdk';

const uploader = new VedoraUploader({
  apiKey: 'ved_live_d84b25914cf145d6848e28c04ec5cba7_9f83ab2c4e61d85203ef189b',
  baseUrl: 'http://localhost:8080/api/v1',
  chunkSize: 5 * 1024 * 1024, // 5MB chunks
  concurrency: 3,
});

uploader.on('progress', (telemetry) => {
  console.log(`Progress: ${telemetry.progressPercentage}% | Speed: ${telemetry.speedFormatted}`);
});

const result = await uploader.upload({
  file: videoFile,
  title: 'My Video',
  resolutions: ['720p', '1080p'],
});
```

---

## 7. API Key Revocation & Cache Invalidation

When an API key is revoked (`POST /api/v1/api-keys/:id/revoke` or `DELETE /api/v1/api-keys/:id`):
1. The PostgreSQL record is marked with `revoked_at = NOW()`.
2. The in-memory LRU cache entry is deleted immediately.
3. The Redis digest key is purged via `DEL vedora:api-key:<digest>`.
4. Any in-flight or subsequent requests using the revoked key will immediately receive `401 Unauthorized`.
