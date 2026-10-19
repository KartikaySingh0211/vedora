# Vedora — Video Infrastructure SaaS Platform

**Vedora** is a production-grade video infrastructure platform designed for ingesting, managing, and delivering video content at scale. Built with a modern microservices and web application architecture, it provides developer-first APIs, dual-layer authentication (Clerk JWTs & hashed API keys), multi-level caching, atomic quota enforcement, and chunked cloud storage ingestion.

---

## 📚 Engineering Documentation

Detailed, industry-standard architectural specifications, threat assessments, and decision records are maintained in the [`docs/`](file:///d:/Dev/Projects/vedora/docs) directory:

- 📖 **[Master Engineering Log & Ledger (`docs/ENGINEERING_LOG.md`)](file:///d:/Dev/Projects/vedora/docs/ENGINEERING_LOG.md)**: Full chronological ledger documenting every implementation run, exact changes, design rationale, and test verification results.
- 📐 **[System Design & Architecture Document (`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`)](file:///d:/Dev/Projects/vedora/docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md)**: Deep architectural blueprints, threat modeling, multi-tier caching sequences, and telemetry engines.
- 🏛️ **Architecture Decision Records (ADRs)**:
  - [ADR-001: API Key Security, Cryptographic Hashing, and Multi-Tier Caching](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-001-api-key-security-and-caching.md)
  - [ADR-002: Dual-Authentication Guard (Clerk JWT & Vedora API Keys)](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-002-dual-authentication-guard.md)
  - [ADR-003: Debounced Last-Used Activity Tracking with Fault-Tolerant Batching](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-003-debounced-last-used-tracking.md)
  - [ADR-004: Atomic Quota Enforcement via PostgreSQL Advisory Locks](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-004-database-quota-concurrency.md)
  - [ADR-005: Video Ingestion Token Proxy & Client-Side Telemetry](file:///d:/Dev/Projects/vedora/docs/decisions/ADR-005-video-storage-token-proxy.md)

---

## 🏗️ Architecture Overview

```
                               ┌────────────────────────────────────────┐
                               │             Next.js Apps               │
                               │  • Landing Page (port 3000)            │
                               │  • Main Dashboard (port 3001)          │
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
                                     Level 2 Cache │ Activity Buffering
                                                   ▼
                                       ┌───────────────────────┐
                                       │    Redis 7 (Docker)   │
                                       │ (Safe DB Fallback)    │
                                       └───────────────────────┘
```

### Components
1. **`services/`**: NestJS backend providing `/api/v1` routes:
   - **Authentication**: Dual-auth Guard supporting Clerk user JWTs and Vedora API keys (`VDR_<32hex>_<secret>`).
   - **Key Caching**: 3-tier verification order:
     - **Level 1**: Local LRU cache (`v1:<keyId>`, 5m soft TTL, max 100k items).
     - **Level 2**: Redis distributed cache (`vedora:api_key:v1:<keyId>`, 10m hard TTL).
     - **Level 3**: Neon PostgreSQL with Argon2id hash verification.
   - **Debounced Activity Tracking**: 60s atomic Redis lock with scheduled 5-minute batch persistence to Neon.
   - **Playlists Module**: User-scoped playlist management with atomic transaction advisory locks enforcing server-side quotas (max 10 playlists/user).
   - **Resilience**: Graceful, non-blocking fallback to PostgreSQL when Redis is offline.
2. **`apps/main-dashboard/`**: Next.js 16 App Router dashboard:
   - **Developer Access**: Key generation with one-time secret modal, copy-once interaction, regeneration with 5-minute cooldown, and relative timestamps via `timeago.js`.
   - **Playlist Management**: Reactive playlists dashboard with TanStack Query, optimistic state updates, and quota indicators.
   - **Video Upload**: Multipart upload flow with `@oneminutecloud/storage-bucket-next`, live progress bar, transfer speed (MB/s), and estimated remaining time (ETA).
   - **Token Proxy**: `/api/oneminutecloud/provider` and `[provider]` verifying Clerk session server-side.
3. **`apps/landing-page/`**: Next.js 16 marketing website with sleek dark theme and responsive UI.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Backend API** | NestJS 11, TypeScript 5.7, Express |
| **Database** | PostgreSQL hosted on Neon |
| **ORM & Migrations** | Drizzle ORM, Drizzle Kit, `@neondatabase/serverless` |
| **User Authentication** | Clerk (`@clerk/backend`, `@clerk/nextjs`) |
| **API Key Hashing** | Argon2id (`argon2`) |
| **API Key Digest Indexing** | Node.js `crypto` (HMAC-SHA256) |
| **Local Caching** | `lru-cache` |
| **Distributed Caching** | Redis 7 Alpine (`ioredis`), Docker Compose |
| **Scheduler** | `@nestjs/schedule` |
| **Frontend Dashboard** | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| **Server-State Management**| TanStack Query v5 |
| **Relative Time** | `timeago.js` |
| **Video Storage** | OneMinute Cloud Storage (`@oneminutecloud/storage-bucket-next`) |

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
# Backend unit & integration tests
cd services
npm test

# Backend linter & build
npm run lint
npm run build

# Dashboard linter & build
cd ../apps/main-dashboard
npm run lint
npm run build

# Landing page linter & build
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
5. **No Secret Leaking**: Centralized exception filters sanitize URLs, query params, tokens, and database stack traces before logging or returning error responses.
6. **Token Proxy**: Video upload provider credentials remain server-side in `/api/oneminutecloud/provider`.

---

## 📋 Known Limitations & Subsequent Phases

- **Media Processing / HLS**: Current phase delivers cloud object key ingestion and storage staging. Asynchronous video transcoding, HLS packaging, and thumbnail generation will be connected in subsequent media pipeline phases.
- **Docker in Non-Elevated Environments**: In restricted Windows environments where Docker Desktop daemon requires administrator elevation, the system seamlessly uses the tested PostgreSQL fallback mode.
