# Vedora — Video Infrastructure SaaS Platform

**Vedora** is a production-grade video infrastructure platform designed for ingesting, managing, and delivering video content at scale. Built with a modern microservices and web application architecture, it provides developer-first APIs, dual-layer authentication (Clerk JWTs & hashed API keys), multi-level caching, atomic quota enforcement, and chunked cloud storage ingestion.

---

## 📚 Engineering Documentation

Detailed, industry-standard architectural specifications, threat assessments, and decision records are maintained in the [`docs/`](file:///d:/Dev/Projects/vedora/docs) directory:

- 📖 **[Master Engineering Log & Ledger (`docs/ENGINEERING_LOG.md`)](file:///d:/Dev/Projects/vedora/docs/ENGINEERING_LOG.md)**: Full chronological ledger documenting every implementation run, exact changes, design rationale, and test verification results.
- 📐 **[System Design & Architecture Document (`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`)](file:///d:/Dev/Projects/vedora/docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md)**: Deep architectural blueprints, threat modeling, multi-tier caching sequences, and telemetry engines.
- 🚀 **[Swagger / OpenAPI 3.0 API Documentation (`docs/api-docs/README.md`)](file:///d:/Dev/Projects/vedora/docs/api-docs/README.md)**: Comprehensive developer API reference, Swagger UI configuration, DTO schemas, dual authentication, webhooks, and client generation.
- 🌐 **[Raw OpenAPI 3.0 JSON Specification (`docs/openapi.json`)](file:///d:/Dev/Projects/vedora/docs/openapi.json)**: Fully typed, machine-readable OpenAPI 3.0 specification for Postman, Insomnia, and SDK code generation.
- 🏛️ **Architecture Decision Records (ADRs)**:
  - [ADR-001: API Key Security, Cryptographic Hashing, and Multi-Tier Caching](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-001-api-key-security-and-caching.md)
  - [ADR-002: Dual-Authentication Guard (Clerk JWT & Vedora API Keys)](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-002-dual-authentication-guard.md)
  - [ADR-003: Debounced Last-Used Activity Tracking with Fault-Tolerant Batching](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-003-debounced-last-used-tracking.md)
  - [ADR-004: Atomic Quota Enforcement via PostgreSQL Advisory Locks](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-004-database-quota-concurrency.md)
  - [ADR-005: Video Ingestion Token Proxy & Client-Side Telemetry](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-005-video-storage-token-proxy.md)
  - [ADR-006: Plan-Based Storage Quotas, Concurrency-Safe Reservations, and Direct Cloud Storage Ingestion](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-006-plan-based-quotas-and-direct-uploads.md)
  - [ADR-007: Custom TypeScript SDK Architecture (@vedora/sdk) and Direct-to-Cloud Upload Pipeline](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-007-vedora-upload-sdk-architecture.md)
  - [ADR-008: Asynchronous HLS Transcoding Pipeline and Rendition Ladder](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-008-hls-transcoding-and-rendition-ladder.md)
  - [ADR-009: Segment-Level Playback Analytics and Pseudonymous Telemetry](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-009-segment-level-analytics-and-pseudonymous-telemetry.md)
  - [ADR-010: Subscription Billing Engine, Playback-Minute Accounting, and Quota Resets](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-010-subscription-billing-and-usage-accounting.md)

---

## 🏗️ Architecture Overview

```
                               ┌────────────────────────────────────────┐
                               │             Next.js Apps               │
                               │  • Landing Page (port 3000)            │
                               │  • Main Dashboard & Player (port 3001) │
                               └───────────────────┬────────────────────┘
                                                   │
                                     HTTP Requests │ Authorization (Clerk / API Key)
                                                   ▼
                               ┌────────────────────────────────────────┐
                               │           NestJS Backend API           │
                               │           (Port 8080, /api/v1)         │
                               └───────┬───────────┬────────────┬───────┘
                                       │           │            │
                         Level 1 Cache │           │            │ Level 3 / Data
                                       ▼           │            ▼
                               ┌───────────────┐   │   ┌───────────────────┐
                               │ Local In-Mem  │   │   │  Neon PostgreSQL  │
                               │   LRU Cache   │   │   │  (Drizzle ORM)    │
                               └───────────────┘   │   └───────────────────┘
                                                   │
                                     Level 2 Cache │ Telemetry / Transcode Queues
                                                   ▼
                                       ┌───────────────────────┐
                                       │    Redis 7 (Docker)   │
                                       │ (Safe DB Fallback)    │
                                       └───────────────────────┘
```

### Components
1. **`services/`**: NestJS backend providing `/api/v1` routes:
   - **Authentication**: Dual-auth Guard supporting Clerk user JWTs and Vedora API keys (`VDR_<32hex>_<secret>`).
   - **Key Caching**: 3-tier verification order (L1: Local LRU, L2: Redis, L3: Neon PostgreSQL with Argon2id hash).
   - **Playlists Module**: User-scoped playlist management with atomic transaction advisory locks enforcing server-side quotas.
   - **Videos Module & Quotas**: Direct-to-cloud upload authorization (`/api/v1/videos/init`), upload verification & completion (`/api/v1/videos/complete`), video listing (`GET /api/v1/videos`), details, and cascade deletion.
   - **Transcoder Module**: Asynchronous HLS adaptive bitrate transcoding worker (`vedora:queue:transcode`), multi-rendition ladders (360p, 480p, 720p, 1080p), master playlist generation (`master.m3u8`), and authenticated HMAC webhook processing (`POST /api/v1/transcoder/webhook`).
   - **Analytics Module**: Public playback telemetry ingestion (`POST /api/v1/analytics/segment-ping`), HMAC-SHA256 pseudonymous session hashing, Redis high-throughput buffer (`vedora:analytics:buffer`), scheduled batched PostgreSQL persistence, and multi-window aggregations (`7d`, `30d`, `90d`).
   - **Player Settings Module**: User-scoped customization (`/api/v1/player-settings`) for theme colors, control bar styling, watermark image, position, opacity, and subtitle toggles. Public config endpoint for embeddable player (`/player-settings/public/:videoId`).
   - **Billing & Subscriptions Module**: Stripe webhook synchronization (`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`), playback-minute accounting, plan entitlement mapping, and monthly UTC scheduled reset cron (`@Cron('0 0 1 * *', { timeZone: 'UTC' })`) that archives playback minutes while permanently preserving accrued storage.
2. **`sdks/vedora-sdk/`**: Custom TypeScript SDK (`@vedora/sdk`):
   - **Direct-to-Cloud Uploads**: Uploads video chunks directly to OneMinute Cloud Storage without proxying multi-gigabyte video payloads through NestJS.
   - **Telemetry Engine**: Real-time progress percentage, upload transfer speed (Bps / MB/s), and estimated time remaining (ETA).
   - **Fault Tolerance**: Bounded exponential backoff retries with full jitter for transient 5xx/network errors, non-retryable 4xx fast-fails, and full cancellation via standard `AbortSignal`.
3. **`apps/main-dashboard/`**: Next.js 16 App Router dashboard:
   - **Developer Access**: Key generation with one-time secret modal, copy-once interaction, regeneration with 5-minute cooldown.
   - **Playlist Management**: Reactive playlists dashboard with TanStack Query and quota indicators.
   - **Video Ingestion & SDK Integration**: Dedicated `/uploads` route driven by `@vedora/sdk`, with multi-resolution selection, live progress bar, transfer speed (MB/s), and ETA.
   - **Video Management**: `/my-videos` route featuring TanStack Query live data, playlist filtering, Grid/Table view toggles, 5 lifecycle status badges (`uploading`, `uploaded`, `processing`, `ready`, `failed`), and Copy Embed Code template.
   - **Embeddable Player (`/embed/[videoid]`)**: Standalone, full-viewport embed player supporting adaptive HLS playback via `hls.js`, quality selector, custom branding, and mandatory "Powered by Vedora" watermark on Free tier.
   - **Analytics Dashboard (`/analytics`)**: Live metrics dashboard with TanStack Query and Recharts (views, watch time, unique viewers, average duration, device and browser share, time-series charts).
   - **Player Settings (`/player`)**: Live customization controls with color pickers, opacity sliders, position toggles, and instant preview.
   - **Billing & Subscriptions (`/billing`)**: Real-time playback-minute usage tracking, renewal dates, and plan tier cards.
4. **`apps/landing-page/`**: Next.js 16 marketing website with sleek dark theme and responsive UI.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Backend API** | NestJS 11, TypeScript 5.7, Express |
| **Database** | PostgreSQL hosted on Neon |
| **ORM & Migrations** | Drizzle ORM, Drizzle Kit, `@neondatabase/serverless` |
| **User Authentication** | Clerk (`@clerk/backend`, `@clerk/nextjs`) |
| **API Key Hashing** | Argon2id (`argon2`) |
| **Cryptographic Digest** | Node.js `crypto` (HMAC-SHA256) |
| **Local Caching** | `lru-cache` |
| **Distributed Caching & Queues** | Redis 7 Alpine (`ioredis`), Docker Compose |
| **Media Player & Streaming** | `hls.js`, RFC 8216 HLS Master/Variant manifests |
| **Payments & Subscriptions** | Stripe SDK (`stripe`) |
| **Scheduler** | `@nestjs/schedule` |
| **Frontend Dashboard** | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| **Data Visualization** | `recharts` |
| **Server-State Management**| TanStack Query v5 |
| **Relative Time** | `timeago.js` |
| **Video Storage** | OneMinute Cloud Storage (`@oneminutecloud/storage-bucket-next`) |
| **Video Upload SDK** | Custom TypeScript SDK (`@vedora/sdk`) |

---

## 🚀 Getting Started

### 1. Environment Configuration

Copy `.env.example` templates and fill in your credentials:

```bash
# Root template reference
cp .env.example services/.env
cp .env.example apps/main-dashboard/.env
```

#### Key Variables
- `DATABASE_URL`: Connection string to Neon PostgreSQL pooler.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis credentials (or rely on safe DB fallback).
- `API_KEY_DIGEST_SECRET`: 32+ character HMAC secret for derived cache indexing.
- `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk authentication keys.
- `NEXT_PUBLIC_API_URL`: Backend URL (default: `http://localhost:8080/api/v1`).
- `ONEMINUTECLOUD_API_KEY`: OneMinute Cloud Storage provider key.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`: Stripe billing keys.

### 2. Infrastructure Setup (Redis)

Start Redis 7 with Docker Compose:

```bash
cd services
docker compose up -d
```

*(Note: If Docker is unavailable in your environment, the backend automatically detects this and falls back safely to Neon PostgreSQL without interrupting authentication or API operations).*

### 3. Database Migrations

Apply database migrations to Neon PostgreSQL:

```bash
cd services
npm run db:migrate
```

### 4. Running Backend Services

```bash
cd services
npm run start:dev
```
Backend runs on `http://localhost:8080` (API prefix: `/api/v1`). Swagger documentation is accessible at `http://localhost:8080/api/docs`.

### 5. Running Frontend Applications

```bash
# Dashboard (port 3001)
cd apps/main-dashboard
npm run dev -- -p 3001

# Landing Page (port 3000)
cd apps/landing-page
npm run dev -- -p 3000
```

---

## 🧪 Testing & Verification

Run tests, typechecks, and builds across the repository:

```bash
# Backend unit & integration tests (79 tests across 11 suites)
cd services
npm test

# Backend linter & build
npm run lint
npm run build

# SDK tests (3 tests)
cd ../sdks/vedora-sdk
npm test

# Dashboard linter & build (18 static and dynamic routes)
cd ../apps/main-dashboard
npm run lint
npm run build

# Landing page linter & build (5 routes)
cd ../apps/landing-page
npm run lint
npm run build
```

---

## 🛡️ Security Best Practices Implemented

1. **Zero Plaintext Storage**: Plaintext API keys (`VDR_<hex>_<secret>`) are returned exactly once upon creation. Only Argon2id hashes are stored in PostgreSQL.
2. **Dedicated HMAC Digest Cache Keys**: Plaintext keys are never stored in Redis. Only HMAC-SHA256 digests derived with server-side secrets are used for cache validation.
3. **Prompt Cache Invalidation**: Revoking or regenerating an API key invalidates both Level 1 (LRU) and Level 2 (Redis) cache entries immediately and guards against concurrent rehydration.
4. **Server-Side Quotas**: Playlist limit (10 per user) is enforced in PostgreSQL transactions using advisory locks, preventing quota bypasses from concurrent race conditions.
5. **Privacy-Preserving Telemetry**: Raw IP addresses are never persisted in analytics records; pseudonymized HMAC hashes are generated with server-side secrets.
6. **Cryptographic Webhook Signatures**: Transcoding completion and Stripe billing webhooks require verified HMAC signatures before executing state transitions.
7. **Server-Authoritative Plan Entitlements**: Client applications cannot override watermarks, resolution caps, or subscription tiers; all playback and quota logic is verified server-side.
8. **Permanent Storage Accounting**: Monthly billing resets refresh playback minutes while preserving accrued storage size to guarantee accurate quota enforcement across billing cycles.

