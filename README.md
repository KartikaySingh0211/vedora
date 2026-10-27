# Vedora — Video Infrastructure Platform

**Vedora** is an open-source, developer-first video infrastructure platform designed for ingesting, managing, and delivering video content at scale. Built with a modern TypeScript stack, it provides dual-layer authentication (Clerk JWTs & hashed API keys), multi-tier caching (in-memory LRU + Redis), atomic quota enforcement with PostgreSQL advisory locks, direct-to-cloud chunked ingestion via a standalone TypeScript SDK, RFC 8216 HLS manifest generation, an embeddable video player, and privacy-preserving segment telemetry.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B%20%7C%2024-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![NestJS](https://img.shields.io/badge/NestJS-11.0-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-16.3%20App%20Router-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon%20Serverless-4169E1?logo=postgresql&logoColor=white)](https://neon.tech)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Redis](https://img.shields.io/badge/Redis-7%20Alpine-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Tests](https://img.shields.io/badge/Tests-80%20passing%20(11%20suites)-brightgreen)](docs/ENGINEERING_LOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

> [!NOTE]
> **Local Development Architecture**: Vedora is currently configured for local multi-service development (`http://localhost:8080`, `http://localhost:3001`, `http://localhost:3000`). There is no public hosted cloud deployment URL at this time. Follow the [Quick Start](#-quick-start) section to spin up the full platform locally with Docker Compose and npm.

---

## 💡 Why Vedora?

Building custom video streaming capabilities from scratch introduces several critical infrastructure hurdles:
- **Application Server Crashes**: Proxying multi-gigabyte video uploads through standard HTTP controllers saturates server memory and event loops.
- **Race Conditions & Quota Bypasses**: Simple database reads and writes (`SELECT` then `INSERT`) permit concurrent upload requests to exceed user storage limits.
- **HLS Complexity**: Authoring adaptive multi-bitrate HLS streams (master playlists, rendition ladders, variant playlists) requires specialized RFC 8216 compliance.
- **Custom Player Overhead**: Developing an embeddable HTML5 video player with adaptive bitrate selection, keyboard shortcuts, buffering recovery, responsive aspect ratios, and custom branding requires hundreds of lines of boilerplate.
- **Privacy-Preserving Metrics**: Ingesting high-frequency video playback heartbeats without storing raw PII or overwhelming the transactional database.

Vedora addresses these challenges with an integrated, developer-first platform: direct-to-cloud chunked presigned uploads, PostgreSQL advisory locks for quota reservations, asynchronous manifest generation, customizable embed players, and high-throughput batched telemetry.

---

## ⚡ Core Capabilities

1. **Direct-to-Cloud Ingestion & TypeScript SDK (`@vedora/sdk`)**:
   Video files are sliced and uploaded directly to cloud storage using presigned multipart chunk URLs with bounded exponential backoff retries and `AbortSignal` cancellation, preventing multi-gigabyte payloads from proxying through application servers.
2. **Dual-Layer Authentication & Multi-Tier Caching**:
   `DualAuthGuard` validates either Clerk session JWTs (for dashboard users) or high-entropy API keys (`VDR_<32hex>_<secret>`). Keys are hashed with Argon2id; verification follows a 3-tier sequence (L1 local in-memory LRU, L2 Redis with HMAC-SHA256 digest keys, L3 Neon PostgreSQL).
3. **Atomic Quota Enforcement via PostgreSQL Advisory Locks**:
   PostgreSQL transaction-level advisory locks (`pg_advisory_xact_lock`) serialize concurrent upload requests per user, guaranteeing that active storage plus incoming reservations never exceed tier caps.
4. **Adaptive HLS Playback & Customizable Embed Player**:
   Generates RFC 8216 HLS master manifests and variant playlists (360p to 1080p). Built-in `<VedoraPlayer />` and `<EmbedVideoModal />` provide adaptive streaming via `hls.js`, HTML5 fallback, responsive iframe code generation, custom themes, and watermark branding.
5. **Privacy-Preserving Telemetry & Usage-Based Billing**:
   Playback heartbeat pings are pseudonymized using HMAC-SHA256, buffered in Redis, and asynchronously persisted to PostgreSQL in batched windows (`7d`, `30d`, `90d`). Stripe webhook listeners sync subscription tiers and manage monthly playback-minute resets.

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Clients["Client Layer"]
        Dashboard["Next.js Dashboard<br/>(Port 3001)"]
        Landing["Next.js Landing<br/>(Port 3000)"]
        EmbedPlayer["Embed Video Player<br/>(HLS.js / HTML5)"]
        SDK["@vedora/sdk<br/>(TypeScript)"]
    end

    subgraph Gateway["NestJS API Gateway (Port 8080 /api/v1)"]
        DualAuth["DualAuthGuard<br/>(Clerk JWT / API Key)"]
        QuotaLock["pg_advisory_xact_lock<br/>(Atomic Quotas)"]
        VideoService["Video & Playlist Engine"]
        TranscodeService["Transcoding Engine"]
        TelemetryService["Analytics Ping Collector"]
    end

    subgraph Caches["Multi-Tier Cache & Queues"]
        L1["L1: Local In-Memory LRU"]
        L2["L2: Redis 7 (Docker)<br/>• Transcode Queue<br/>• Telemetry Buffer"]
    end

    subgraph Persistence["Storage & Database"]
        NeonDB[("Neon PostgreSQL<br/>(Drizzle ORM)")]
        Storage[("Cloud Storage / Resilient Local<br/>• Presigned Chunks<br/>• HLS Manifests")]
    end

    Clients -->|"HTTP / REST API"| Gateway
    SDK -->|"1. /videos/init"| VideoService
    SDK -->|"2. Direct Multipart Chunks"| Storage
    SDK -->|"3. /videos/complete"| VideoService

    DualAuth --> L1
    L1 -->|"Cache Miss"| L2
    L2 -->|"Cache Miss"| NeonDB

    VideoService --> QuotaLock
    QuotaLock --> NeonDB

    TranscodeService -->|"Enqueue Job"| L2
    TelemetryService -->|"Buffered Pings"| L2
    L2 -.->|"Batched Write"| NeonDB

    EmbedPlayer -->|"HLS Stream / Range Requests"| Storage
```

---

## 📸 Product Preview

### Embed Video Player Modal
Full-featured interactive video player modal with responsive (16:9) and fixed pixel aspect ratios, live HLS/MP4 preview, custom brand watermark, player theme colors, and instant iframe embed code generation:

![Vedora Embed Player Modal](docs/assets/screenshots/embed-player-modal.png)

### Video Management Dashboard
User video library displaying lifecycle status badges (`uploading`, `uploaded`, `processing`, `ready`, `failed`), multi-resolution encoding presets (720p/1080p), playlist filtering, size/duration metrics, and direct embed code extraction:

![Vedora Video Management Dashboard](docs/assets/screenshots/my-videos-dashboard.png)

### Interface Walkthrough Checklist
| View | Route | Implemented & Verified Capabilities |
| :--- | :--- | :--- |
| **API Keys Management** | `/` (Dashboard Root) | Argon2id key generation, one-time reveal modal, 5-minute cooldown regeneration, revocation |
| **Playlists Management** | `/playlists` | Playlist creation, user-scoped limit checks (10 max), atomic video count increments |
| **Direct Upload Studio** | `/uploads` | Drag-and-drop ingestion, metadata parsing, resolution toggles, real-time speed & ETA telemetry |
| **Video Library** | `/my-videos` | Real-time TanStack Query cache, grid/table view, lifecycle badges, embed code modal launcher |
| **Embeddable Player** | `/embed/[videoid]` | Standalone viewport playback, HLS.js adaptive streaming, speed selector, PiP, keyboard shortcuts |
| **Custom Player Settings**| `/player` | Primary color picker, control bar styling, watermark position/opacity slider, UI control toggles |
| **Playback Analytics** | `/analytics` | Views, watch minutes, unique viewers, retention curve, device/browser distribution via Recharts |
| **Subscription Billing** | `/billing` | Active plan tier, allocated vs used playback minutes, renewal dates, Stripe checkout links |

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: `v20.x` or `v24.x` (LTS recommended)
- **Docker Desktop**: For running Redis 7
- **PostgreSQL Database**: Neon serverless PostgreSQL connection string (or local PostgreSQL 16+)
- **Clerk Authentication**: Free Clerk account with Publishable & Secret keys

### 2. Workspace Installation
Vedora is organized as a multi-package repository. Install dependencies in each workspace:

```bash
# Backend services
cd services
npm install

# TypeScript SDK
cd ../sdks/vedora-sdk
npm install
npm run build

# Dashboard application
cd ../../apps/main-dashboard
npm install

# Landing page
cd ../landing-page
npm install
```

### 3. Environment Configuration
Configure environment variables using the provided workspace `.env.example` templates:

```bash
# 1. Backend Services
cp services/.env.example services/.env

# 2. Main Dashboard
cp apps/main-dashboard/.env.example apps/main-dashboard/.env

# 3. Landing Page
cp apps/landing-page/.env.example apps/landing-page/.env
```

#### Core Backend Variables (`services/.env`)
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | API server listening port | `8080` |
| `DATABASE_URL` | PostgreSQL pooler connection URL | `postgresql://user:pass@ep-pooler.neon.tech/neondb?sslmode=require` |
| `REDIS_HOST` | Distributed cache host | `localhost` |
| `REDIS_PORT` | Distributed cache port | `6379` |
| `REDIS_PASSWORD` | Redis authentication password | `vedorasecret` |
| `API_KEY_DIGEST_SECRET` | 32+ character HMAC secret for derived cache indexing | Random 32+ character string |
| `CLERK_SECRET_KEY` | Clerk server-side secret key | `sk_test_...` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public frontend key | `pk_test_...` |

### 4. Start Infrastructure (Redis)
Start Redis 7 with Docker Compose:

```bash
cd services
docker compose up -d
```
*(Note: If Docker is unavailable, the backend automatically detects this and falls back safely to Neon PostgreSQL without interrupting authentication or API operations).*

### 5. Apply Database Migrations
Apply Drizzle schema migrations to Neon PostgreSQL:

```bash
cd services
npm run db:migrate
```

### 6. Run Applications Locally
Open separate terminal tabs for each service:

```bash
# Terminal 1: Backend API (port 8080)
cd services
npm run start:dev

# Terminal 2: Main Dashboard (port 3001)
cd apps/main-dashboard
npm run dev -- -p 3001

# Terminal 3: Marketing Landing Page (port 3000)
cd apps/landing-page
npm run dev -- -p 3000
```

### 7. Interactive API Documentation (Swagger)
Once the backend is running, open the interactive Swagger UI:
- **Swagger UI**: [http://localhost:8080/api/docs](http://localhost:8080/api/docs)
- **OpenAPI 3.0 Spec**: Statically exported at [`docs/openapi.json`](docs/openapi.json)

---

## 🧪 Testing & Verification

Run tests, typechecks, and builds across all workspaces:

```bash
# 1. Backend unit & integration test suite (80 tests across 11 suites)
cd services
npm test

# 2. Backend TypeScript compilation
npm run build

# 3. TypeScript SDK test suite
cd ../sdks/vedora-sdk
npm test

# 4. Main dashboard typecheck & build
cd ../../apps/main-dashboard
npx tsc --noEmit
npm run build

# 5. Landing page typecheck & build
cd ../landing-page
npm run build
```

---

## 🏛️ Technical Architecture & Engineering Decisions

Vedora's design decisions are documented as formalized **Architecture Decision Records (ADRs)** in [`docs/decisions/`](docs/decisions/):

| Record | Focus | Core Problem & Engineering Trade-Off |
| :--- | :--- | :--- |
| **[ADR-001](docs/decisions/ADR-001-api-key-security-and-caching.md)** | API Key Security & Multi-Tier Caching | Plaintext keys cannot be stored in database or Redis. Solved via Argon2id database hashes + HMAC-SHA256 derived cache keys across a 3-tier cache (L1 LRU, L2 Redis, L3 DB). |
| **[ADR-002](docs/decisions/ADR-002-dual-authentication-guard.md)** | Dual-Authentication Guard | Unifies Clerk browser session JWTs and machine-to-machine API keys into a single `DualAuthGuard` attaching a normalized `req.user`. |
| **[ADR-003](docs/decisions/ADR-003-debounced-last-used-tracking.md)** | Debounced Activity Tracking | Updating `last_used_at` on every request creates write amplification. Solved with a 60-second Redis debounce filter before writing to PostgreSQL. |
| **[ADR-004](docs/decisions/ADR-004-database-quota-concurrency.md)** | Concurrency-Safe Quota Enforcement | Prevents concurrent upload races via PostgreSQL transaction-level advisory locks (`pg_advisory_xact_lock(hashtext(userId))`). |
| **[ADR-005](docs/decisions/ADR-005-video-storage-token-proxy.md)** | Storage Token Proxy & Telemetry | Decouples cloud storage credentials from client devices using short-lived presigned upload authorizations. |
| **[ADR-006](docs/decisions/ADR-006-plan-based-quotas-and-direct-uploads.md)** | Plan-Based Storage Quotas | Accounts for both raw video sizes and projected transcoding output before issuing upload authorization. |
| **[ADR-007](docs/decisions/ADR-007-vedora-upload-sdk-architecture.md)** | Standalone TypeScript SDK | Custom `@vedora/sdk` client handling chunking, upload progress calculation, exponential backoff retries, and `AbortSignal` cancellation. |
| **[ADR-008](docs/decisions/ADR-008-hls-transcoding-and-rendition-ladder.md)** | Asynchronous HLS Transcoding | Multi-rendition adaptive streaming ladder (360p to 1080p), RFC 8216 master playlist generation, and HMAC webhook verification. |
| **[ADR-009](docs/decisions/ADR-009-segment-level-analytics-and-pseudonymous-telemetry.md)** | Playback Telemetry Ingestion | Ingests 10-second segment heartbeat pings, pseudonymizes client IP with HMAC-SHA256, buffers in Redis, and batches into PostgreSQL. |
| **[ADR-010](docs/decisions/ADR-010-subscription-billing-and-usage-accounting.md)** | Subscription Billing & Minute Accounting | Integrates Stripe webhooks (`customer.subscription.updated`, `invoice.paid`) and scheduled UTC monthly cron to reset playback minutes while preserving accrued storage. |
| **[ADR-011](docs/decisions/ADR-011-safe-modularity-and-frontend-reusability.md)** | Frontend Reusability & Embed Player | Encapsulates video streaming into a reusable `<VedoraPlayer />` and `<EmbedVideoModal />` with HLS.js adaptive streaming and native HTML5 fallback. |

---

## 📚 Engineering Documentation & Ledgers

- 📖 **[Master Engineering Log & Ledger (`docs/ENGINEERING_LOG.md`)](docs/ENGINEERING_LOG.md)**: Full chronological ledger documenting every implementation run, exact changes, design rationale, and test verification results.
- 📐 **[System Design & Architecture Document (`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`)](docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md)**: Deep architectural blueprints, threat modeling, multi-tier caching sequences, and telemetry engines.
- 🚀 **[Swagger / OpenAPI 3.0 API Documentation (`docs/api-docs/README.md`)](docs/api-docs/README.md)**: Comprehensive developer API reference, Swagger UI configuration, DTO schemas, dual authentication, webhooks, and client generation.
- 🌐 **[Raw OpenAPI 3.0 Specification (`docs/openapi.json`)](docs/openapi.json)**: Fully typed, machine-readable OpenAPI 3.0 specification for Postman, Insomnia, and SDK code generation.
- 🛠️ **[Bug Fixes & Incident Ledger (`docs/bug-fixes/README.md`)](docs/bug-fixes/README.md)**: Immutable record of incidents, root-cause analyses, and resolutions (BUG-001 through BUG-010).

---

## 🛡️ Security Best Practices Implemented

1. **Zero Plaintext Storage**: Plaintext API keys (`VDR_<hex>_<secret>`) are returned exactly once upon creation. Only Argon2id hashes are stored in PostgreSQL.
2. **Dedicated HMAC Digest Cache Keys**: Plaintext keys are never stored in Redis. Only HMAC-SHA256 digests derived with server-side secrets are used for cache validation.
3. **Prompt Cache Invalidation**: Revoking or regenerating an API key invalidates both Level 1 (LRU) and Level 2 (Redis) cache entries immediately and guards against concurrent rehydration.
4. **Server-Side Quotas**: Quotas (e.g., 10 playlists per user, plan storage caps) are enforced in PostgreSQL transactions using advisory locks, preventing quota bypasses from concurrent race conditions.
5. **Privacy-Preserving Telemetry**: Raw IP addresses are never persisted in analytics records; pseudonymized HMAC hashes are generated with server-side secrets.
6. **Cryptographic Webhook Signatures**: Transcoding completion and Stripe billing webhooks require verified HMAC signatures before executing state transitions.
7. **Server-Authoritative Plan Entitlements**: Client applications cannot override watermarks, resolution caps, or subscription tiers; all playback and quota logic is verified server-side.
8. **Permanent Storage Accounting**: Monthly billing resets refresh playback minutes while preserving accrued storage size to guarantee accurate quota enforcement across billing cycles.

---

## ⚠️ Known Limitations & Active Fallbacks

To maintain complete technical transparency:
1. **Third-Party Storage Outage & Resilient Local Fallback**:
   The third-party storage provider (OneMinute Cloud) currently encounters an upstream internal server error on multipart initiation (`POST /objects/initiate -> 500`). Vedora automatically activates its built-in **Resilient Storage Provider Fallback**, buffering and assembling chunks on the local filesystem (`services/storage_local/`) and serving playback through HTTP 206 Partial Content range requests. As documented in [BUG-010](docs/bug-fixes/BUG-010-oneminute-bucket-zero-files-and-fallback-flower-video.md), once third-party storage or Cloudflare R2 credentials are provided, uploads route directly to cloud storage.
2. **Asynchronous Transcoding Worker**:
   The current background transcode worker generates valid RFC 8216 HLS master manifests (`master.m3u8`) and multi-rendition variant playlists (360p to 1080p). Multi-bitrate video encoding is orchestrated through BullMQ/Redis; production deployments connect this queue to an external FFmpeg worker fleet or cloud transcoder (e.g. Cloudflare Stream / AWS MediaConvert).
3. **Deployment Hosting**:
   The platform is currently optimized for local multi-service development. A hosted public production deployment is part of the roadmap.

---

## 🗺️ Roadmap

- [ ] **Cloudflare R2 Native Storage Driver**: Native S3-compatible driver support with 0 egress fees.
- [ ] **Distributed FFmpeg Worker Fleet**: Containerized GPU-accelerated video encoding worker pool.
- [ ] **AI-Powered Subtitles**: Automated multi-language subtitle generation via Whisper AI worker hooks.
- [ ] **Team & Organization RBAC**: Multi-tenant team workspaces with granular permission tiers.
- [ ] **Automated CI/CD Pipeline**: GitHub Actions workflows for continuous integration, linting, and automated Docker container builds.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
