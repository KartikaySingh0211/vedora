# Vedora Engineering Log & Implementation Ledger

> **Standard Operating Procedure (SOP)**: Every run, architectural modification, infrastructure update, schema evolution, and critical fix must be documented in this ledger with full **Context**, **What Was Done**, **Why It Was Done (Rationale & Threat Modeling)**, **Alternatives Considered & Rejected**, and **Verification Evidence**.

---

## Run 1: End-to-End Core Infrastructure & Implementation (Phases 0–5)

- **Date**: 2026-10-20
- **Author**: Antigravity IDE (Gemini 3.8 Flash)
- **Scope**: Complete implementation of Vedora Video SaaS platform across backend services, infrastructure, database, and frontend dashboard applications.

---

### 1. Phase 0: Non-Destructive Repository Audit & Database Inspection

#### Context & Objective
Before writing code or changing configurations, audit the repository to inspect dependencies, database connection, existing schemas, migrations, package managers, and security constraints. Ensure existing databases and secrets are never overwritten, exposed, or destroyed.

#### What Was Done
1. Inspected monorepo layout: `services/` (NestJS 11), `apps/main-dashboard/` (Next.js 16), `apps/landing-page/` (Next.js 16), `infra/`, and `sdks/`.
2. Checked lockfiles and standardized on `npm` throughout all sub-projects.
3. Inspected existing environment keys in `services/.env` without printing or logging values: verified that `PORT` and `DATABASE_URL` were configured.
4. Created non-destructive verification script in isolated scratch space to test Neon PostgreSQL connectivity and schema state.
5. Discovered that Neon database was live, contained `public.api_key` table, and had migration `0000_funny_puck` tracked in `drizzle.__drizzle_migrations`.
6. Generated initial checklist and progress tracking artifact.

#### Why (Rationale & Architectural Decisions)
- **Strict Data Preservation**: Overwriting or regenerating `.env` or running destructive resets (`drizzle-kit push --force` or table drops) would destroy user's Neon database state.
- **Secret Zero-Exposure**: Secret values in `.env` must never appear in shell output, stdout logs, or LLM output to prevent credential harvesting.
- **Safe Baseline**: Identifying existing uncommitted or draft files (`api-key.controller.ts`, `api-key.service.ts` with TypeScript/lint errors) allowed us to plan their refactoring into clean modules without breaking legacy expectations.

#### Verification Evidence
- Neon connection test:
  ```json
  All non-system tables: [
    { "table_schema": "drizzle", "table_name": "__drizzle_migrations" },
    { "table_schema": "public", "table_name": "api_key" }
  ]
  api_key row count: 0
  ```

---

### 2. Phase 1: Infrastructure & Backend Foundation

#### Context & Objective
Set up the NestJS backend foundation according to enterprise SaaS standards: URI versioning (`/api/v1`), global prefix (`api`), strict DTO validation, centralized CORS, structured exception handling, Docker Compose Redis 7 Alpine configuration, and self-healing Redis fallback.

#### What Was Done
1. **Installed Backend Dependencies**: Added `class-validator`, `class-transformer`, `ioredis`, `@types/ioredis`, `lru-cache`, `@nestjs/schedule`, `argon2`, and `@clerk/backend`.
2. **Configured Redis 7 in Docker Compose** (`services/docker-compose.yml`):
   - Image: `redis:7-alpine`
   - Memory limit: 512 MB with `allkeys-lru` eviction policy
   - Append-only persistence enabled (`appendonly yes`)
   - Persistent named Docker volume (`redis_data`)
   - Built-in container health checks using `redis-cli ping`
3. **Resilient Redis Service** (`services/src/infra/redis/redis.service.ts` & `redis.module.ts`):
   - Configured non-blocking `lazyConnect: true`, capped retries (`maxRetriesPerRequest: 1`), and custom `retryStrategy`.
   - Trapped `error` events to prevent unhandled rejections from crashing the process when Redis container is not running.
   - Built atomic operations: `get`, `set`, `del`, `setnxWithExpiry`, `hset`, `hgetall`, `hdel`, `ping`.
4. **Centralized Configuration** (`services/src/config/configuration.ts`):
   - Type-safe config mapping port, database connection, Redis parameters, HMAC digest secret, Clerk secrets, and allowed CORS origins.
5. **Centralized Exception Filter** (`services/src/utils/all-exceptions.filter.ts`):
   - Structured JSON response: `{ statusCode, timestamp, path, error, message }`.
   - URL & query parameter sanitizer masking `key`, `secret`, `token` values.
   - Masks internal database error traces from clients while logging them securely on the server.
6. **Health Check Module** (`services/src/modules/health/health.controller.ts` & `health.module.ts`):
   - Responds on both neutral route `/api/health` and versioned `/api/v1/health`.
   - Executes live `SELECT 1` on Neon PostgreSQL pool.
   - Pings Redis and reports: `status: 'ok', dependencies: { database: 'up', redis: 'up' | 'down (fallback to db active)' }`.
7. **NestJS Bootstrap** (`services/src/main.ts`):
   - Configured global prefix `api`, URI versioning default `1`.
   - Configured CORS for frontend origins (`http://localhost:3000`, `http://localhost:3001`, `.vercel.app`).
   - Configured Swagger OpenAPI at `/api/docs`.
   - Fixed `services/tsconfig.build.json` to exclude `drizzle.config.ts`, ensuring output compiles directly to `dist/main.js`.
8. **Safe Environment Placeholders**: Created root `.env.example` and `services/.env.example`.

#### Why (Rationale & Architectural Decisions)
- **Why Safe Redis Fallback?** In developer workstations or environments without Docker Desktop running (or Windows environments lacking admin privileges to start background services), hard-failing backend startup would make local development impossible. By making Redis connections non-blocking and falling back cleanly to PostgreSQL, the API remains 100% operational regardless of infrastructure state.
- **Why Global ValidationPipe with `whitelist: true` & `forbidNonWhitelisted: true`?** Prevents mass assignment vulnerabilities and strips or rejects unexpected payload properties.
- **Why Dual Health Paths (`/api/health` and `/api/v1/health`)?** Load balancers (e.g. AWS ALB, GCP Cloud Run, Kubernetes readiness probes) often expect unversioned `/api/health`, while frontend dashboards consume `/api/v1/health`. Supporting both avoids probe routing errors.

#### Verification Evidence
- Live curl/fetch to `http://localhost:8080/api/v1/health`:
  ```json
  {
    "status": "ok",
    "service": "vedora-services",
    "version": "1.0.0",
    "timestamp": "2026-10-19T19:15:10.371Z",
    "dependencies": {
      "database": "up",
      "redis": "down (fallback to db active)"
    }
  }
  ```

---

### 3. Phase 2: API-Key Authentication System

#### Context & Objective
Design a hardened API key system supporting machine-to-machine integration alongside user session authentication. Keys must be stored with zero plaintext persistence, validated through a 3-tier cache hierarchy to minimize database CPU and latency, and debounced to prevent database write exhaustion.

#### What Was Done
1. **API Key Cryptographic Utilities** (`services/src/utils/api-key.util.ts`):
   - Key format: `VDR_<32-hex-key-id>_<base64url-secret>`.
   - Key generator creates 16 cryptographically random bytes for `keyId` (32 hex characters) and 32 bytes for `secret` (43 base64url characters).
   - Bidirectional converter maps 32-character hex ID directly to RFC 4122 UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), enabling O(1) indexed primary key lookups in PostgreSQL without table scans.
   - Argon2id hashing (`argon2.hash` with 64 MB memory cost, time cost 3, parallelism 1).
   - HMAC-SHA256 digest derivation using server-side secret (`API_KEY_DIGEST_SECRET`).
2. **Three-Tier Verification Service** (`services/src/modules/api-key/api-key.service.ts` & `api-key-cache.service.ts`):
   - **Level 1 (In-Memory LRU Cache)**: Key `v1:<keyId>`, 5-minute soft TTL, 100,000 maximum entries. Validates HMAC digest and cached revocation state.
   - **Level 2 (Redis Distributed Cache)**: Key `vedora:api_key:v1:<keyId>`, 10-minute hard TTL. On cache hit, verifies digest and rehydrates Level 1 LRU cache.
   - **Level 3 (Neon PostgreSQL)**: O(1) indexed lookup `WHERE id = :uuid`. Rejects revoked keys (`revoked_at IS NOT NULL`). Verifies plaintext key against stored Argon2id hash. Only on success, populates Redis and LRU caches with HMAC digest.
3. **Dual-Authentication Guard** (`services/src/guards/dual-auth.guard.ts`):
   - Checks `x-api-key` header or `Authorization: Bearer VDR_...` ➔ routes to API key verification.
   - Checks `Authorization: Bearer <clerk_jwt>` ➔ routes to Clerk SDK `verifyToken`.
   - Injects normalized context: `req.user = { id: ... }`, `req.authType = 'api_key' | 'clerk'`.
   - Throws HTTP 401 on missing or invalid credentials.
4. **Debounced Last-Used Tracking Worker** (`services/src/modules/api-key/api-key-activity.service.ts`):
   - When key authenticates, attempts atomic Redis lock: `SET vedora:api_key:last_used_lock:v1:<keyId> 1 EX 60 NX`.
   - If acquired, writes timestamp to Redis hash `vedora:api_key:last_used:v1` (or in-memory map if Redis is offline).
   - Scheduled task (`@Cron(CronExpression.EVERY_5_MINUTES)`) acquires distributed flush lock (`vedora:api_key:flush_lock`) and batches timestamps into a single parameterized transaction:
     ```sql
     UPDATE api_key SET last_used_at = $1 WHERE id = $2::uuid AND revoked_at IS NULL
     ```
   - Entries are cleared from the buffer only **after** PostgreSQL transaction commits, guaranteeing zero activity loss during transient database spikes.
5. **Prompt Revocation & Invalidation**:
   - `revokeApiKey` and `regenerateApiKey` endpoints delete the key in Level 1 LRU and Level 2 Redis, update PostgreSQL `revoked_at = NOW()`, and invalidate caches a second time to prevent concurrent lookup rehydration.

#### Why (Rationale & Architectural Decisions)
- **Why Argon2id over Bcrypt?** Argon2id is the memory-hard winner of the Password Hashing Competition (PHC), providing superior resistance against specialized ASIC and GPU brute-force attacks compared to legacy bcrypt.
- **Why HMAC Digest Indexing in Caches?** Plaintext API keys must **never** be cached in plaintext in Redis or memory. If Redis were compromised or inspected in memory dumps, attackers would obtain raw credentials. By hashing the key with a server-side HMAC secret before caching, an attacker possessing the Redis dump cannot reconstruct the API keys.
- **Why Debounce Last-Used Writes?** High-volume video ingestion APIs handle hundreds of requests per second. Writing `UPDATE api_key SET last_used_at = NOW()` on every request would saturate database IOPS, generate write amplification, and trigger table lock contention. Debouncing with a 60-second window and 5-minute scheduled batch flushes reduces database writes by >99.9%.

#### Verification Evidence
- 19 unit & integration tests passing in `api-key.service.spec.ts`, `dual-auth.guard.spec.ts`, and `api-key.util.spec.ts`.
- Protected endpoint rejection test:
  ```json
  {
    "statusCode": 401,
    "path": "/api/v1/api-keys",
    "error": "Unauthorized",
    "message": "Missing authentication credentials. Please provide a Bearer token or x-api-key."
  }
  ```

---

### 4. Phase 3: Playlist Management Module

#### Context & Objective
Implement a multi-tenant playlist management module with server-enforced quotas (maximum 10 playlists per user) that cannot be bypassed by concurrent race conditions.

#### What Was Done
1. **Drizzle Schema Extension** (`services/src/database/schema.ts`):
   - Added `playlist` table: `id` (UUID default random), `user_id` (text not null), `name` (text not null), `description` (text nullable), `playlist_limit` (integer default 10), `total_videos` (integer default 0), `created_at` (timestamptz default now).
   - Added B-tree index `playlist_user_id_idx` on `user_id` column.
2. **Generated & Applied Controlled Migration**:
   - Generated `drizzle/0001_uneven_sheva_callister.sql` via `npx drizzle-kit generate`.
   - Executed `npx drizzle-kit migrate` against Neon PostgreSQL, safely preserving existing `api_key` records.
3. **DTOs with Class-Validator**:
   - `CreatePlaylistDto`: validates `name` (non-empty string, max 100) and `description` (optional string, max 500).
   - `UpdatePlaylistDto`: validates optional `name` and `description`.
4. **Atomic Quota Enforcement & Service** (`services/src/modules/playlist/playlist.service.ts`):
   - Wrapped playlist creation in a PostgreSQL transaction.
   - Acquired transaction-scoped advisory lock based on user ID:
     ```sql
     SELECT pg_advisory_xact_lock(hashtext('vedora_playlist_quota_' || userId))
     ```
   - Checked count of existing playlists for the user. If `>= 10`, threw `BadRequestException('Playlist quota exceeded')`.
   - Implemented CRUD: `createPlaylist`, `listPlaylists`, `getPlaylist`, `updatePlaylist`, `deletePlaylist`.
   - All operations strictly query `WHERE user_id = :userId` to ensure complete cross-tenant isolation.
5. **Controller** (`services/src/modules/playlist/playlist.controller.ts`):
   - Protected with `@UseGuards(DualAuthGuard)` and documented with Swagger annotations.

#### Why (Rationale & Architectural Decisions)
- **Why Transaction Advisory Locks (`pg_advisory_xact_lock`)?** In multi-threaded or distributed environments, two simultaneous `POST /playlists` requests from the same user when they have 9 playlists could both execute `SELECT COUNT(*)`, both read 9, both proceed to insert, and result in 11 playlists (bypassing the quota). Table-level locks would serialize all users across the entire system. `pg_advisory_xact_lock` using a hash of the user ID locks **only that specific user's quota check** for the microsecond duration of the transaction without blocking other users.
- **Why Tenant Scoping on All Reads/Writes?** A client should never be able to read or modify playlists by guessing a UUID. By enforcing `WHERE id = :id AND user_id = :userId`, any attempt to inspect another user's playlist yields a clean `404 Not Found` without information leakage.

#### Verification Evidence
- Applied migration verified in Neon PostgreSQL:
  ```json
  Recorded migrations: [
    { "id": 1, "hash": "228dcfc...", "created_at": "1788632267856" },
    { "id": 2, "hash": "9d821c4...", "created_at": "1792436509377" }
  ]
  ```
- 10 unit tests passing in `playlist.service.spec.ts` testing quota enforcement, advisory locks, and cross-user isolation.

---

### 5. Phase 4: Frontend Dashboard Integrations

#### Context & Objective
Replace mock data and static placeholders in the Next.js App Router dashboard (`apps/main-dashboard`) with live TanStack Query integrations, one-time secret key modals, reactive playlist CRUD, and secure token-proxied video uploads using OneMinute Cloud Storage.

#### What Was Done
1. **Installed Frontend Dependencies**:
   - `timeago.js` for human-readable relative timestamps.
   - `@oneminutecloud/storage-bucket-next` for multipart video chunk uploads.
   - Resolved React 19 / `react-simple-maps` peer dependency conflict using `--legacy-peer-deps`.
2. **API Client Helper** (`apps/main-dashboard/lib/api-client.ts`):
   - Created typed helper `fetchWithAuth<T>` attaching Clerk bearer token (`getToken()`) and extracting structured backend error messages.
3. **Developer Access Settings** (`apps/main-dashboard/app/settings/page.tsx`):
   - Integrated `useQuery` for `GET /api/v1/api-keys`.
   - Integrated `useMutation` for key creation, regeneration, and revocation with automatic query invalidation.
   - Created modal displaying the plaintext API key **once** with copy-to-clipboard feedback and security guidance.
   - Implemented 5-minute cooldown UI logic for regeneration using a reactive `currentTime` state, adhering to React 19 compiler purity standards.
   - Handled loading spinners, empty states, and error alerts.
4. **Playlists Dashboard** (`apps/main-dashboard/app/playlists/page.tsx` & `/playlist/page.tsx`):
   - Connected `GET /api/v1/playlists` via TanStack Query.
   - Added create, edit, and delete modals with optimistic feedback and validation.
   - Rendered live quota tracker (`X / 10 used`) and quota warning banner when limit is reached.
   - Supported both singular `/playlist` and plural `/playlists` routes via clean Next.js re-exports.
5. **Video Upload Flow & Server-Side Token Proxy**:
   - Implemented token proxy route handlers in `apps/main-dashboard/app/api/oneminutecloud/[provider]/route.ts` and `provider/route.ts`.
   - Verified Clerk session server-side (`await auth()`) before proxying requests to OneMinute Cloud backend, ensuring provider API keys remain exclusively server-side.
   - Implemented upload page in `apps/main-dashboard/app/uploads/page.tsx` & `/upload/page.tsx`.
   - Connected `@oneminutecloud/storage-bucket-next` `storage.upload` with live multipart chunk progress tracking.
   - Calculated upload telemetry: transfer speed (`MB/s`) and estimated remaining time (`ETA`), safely guarding against division by zero, NaN, or Infinity on completed/zero-elapsed intervals.
   - Retained the returned cloud object key and presented confirmation state for subsequent media transcoding/HLS packaging phases.
6. **Build & Lint Fixes**:
   - Created missing `components/common/logo.tsx` to fix Turbopack build failure in branding page.
   - Fixed React 19 impure `Math.random()` and `Date.now()` during render across dashboard and landing page components.

#### Why (Rationale & Architectural Decisions)
- **Why Server-Side Token Proxy (`/api/oneminutecloud/provider`)?** Directly exposing cloud storage master API keys (`ONEMINUTECLOUD_API_KEY`) in client bundles would allow anyone to upload arbitrary files to your buckets. The token proxy requires an authenticated Clerk session, issues short-lived presigned multipart URLs, and keeps provider credentials strictly on the server.
- **Why Ephemeral One-Time Display for Keys?** Plaintext keys are never stored in the database. Displaying them only once upon generation enforces zero-knowledge storage on the backend.
- **Why Defensive Telemetry Math?** Network connections can have brief stalls where elapsed time is zero or speed drops to zero. Without defensive bounds checking (`Math.max(0.1, elapsed)` and `isFinite`), progress UI flashes `NaN MB/s` or `Infinity s remaining`.

#### Verification Evidence
- Next.js 16 (Turbopack) build succeeded cleanly:
  ```text
  Route (app)
  ┌ ○ /
  ├ ○ /_not-found
  ├ ○ /analytics
  ├ ƒ /api/oneminutecloud/[provider]
  ├ ƒ /api/oneminutecloud/provider
  ├ ○ /billing
  ├ ○ /branding
  ├ ○ /my-videos
  ├ ○ /player
  ├ ○ /playlist
  ├ ○ /playlists
  ├ ○ /settings
  ├ ○ /support
  ├ ○ /upload
  ├ ○ /uploads
  └ ƒ /video/[videoid]
  ```

---

### 6. Phase 5: Production Verification & Documentation

#### Context & Objective
Execute comprehensive regression testing, static analysis, type checking, and production builds across all monorepo workspaces. Verify live API behavior and deliver exhaustive documentation.

#### What Was Done
1. **Executed Full Test Suite**: 5 test suites, 29/29 tests passed in `services`.
2. **Executed Linters**: 0 errors across `services`, `main-dashboard`, and `landing-page`.
3. **Executed Production Builds**: All 3 workspaces compiled with zero errors.
4. **Verified Live Endpoints**:
   - `GET /api/v1/health` ➔ 200 OK with live database connection verified.
   - `GET /api/v1/playlists` ➔ 401 Unauthorized with structured error.
   - `GET /api/v1/api-keys` ➔ 401 Unauthorized with structured error.
   - `GET /api/v1/api-keys` (with malformed key) ➔ 401 with `Invalid or revoked API key`.
5. **Authored Root Documentation**: Created comprehensive [README.md](README.md) detailing architecture, setup steps, security principles, and environment variables.

---

## 2. Summary of Verification Test Suite

```text
PASS src/utils/api-key.util.spec.ts
  ApiKey Utilities
    √ should generate a valid key matching VDR_<32-hex-key-id>_<base64url-secret>
    √ should reject invalid key formats immediately before expensive crypto
    √ should convert bidirectionally between 32-hex keyId and UUID
    √ should hash with Argon2id and verify valid key, and reject invalid key
    √ should derive consistent HMAC-SHA256 digests with dedicated secret

PASS src/modules/playlist/playlist.service.spec.ts
  PlaylistService
    createPlaylist
      √ should throw UnauthorizedException if userId is missing
      √ should create playlist when current user count is below limit (10)
      √ should reject creation with BadRequestException when playlist limit (10) is reached
    listPlaylists
      √ should list only playlists belonging to the authenticated user
    getPlaylist
      √ should return playlist when found and owned by the user
      √ should throw NotFoundException if playlist does not exist or belongs to another user
    updatePlaylist
      √ should update playlist when owned by user
      √ should throw NotFoundException when trying to update another users playlist
    deletePlaylist
      √ should delete playlist when owned by user
      √ should throw NotFoundException when trying to delete another users playlist

PASS src/guards/dual-auth.guard.spec.ts
  DualAuthGuard
    √ should throw UnauthorizedException when no headers are provided
    √ should authenticate valid API key from x-api-key header
    √ should reject invalid or revoked API key with 401
    √ should authenticate valid Clerk token from Authorization Bearer header
    √ should reject invalid Clerk token with 401

PASS src/modules/api-key/api-key.service.spec.ts
  ApiKeyService
    createApiKey
      √ should generate an API key, save Argon2id hash in DB, and populate caches
    verifyApiKey
      √ should return null immediately for malformed key format without DB lookup
      √ Level 1: should verify from LRU cache without hitting Redis or DB
      √ Level 2: should verify from Redis when LRU misses, and rehydrate LRU
      √ Level 3: should query DB, verify Argon2id hash, and populate caches on cache misses
      √ should reject a revoked key even if found in cache or DB
      √ should safely fall back to PostgreSQL if Redis is down
    revokeApiKey
      √ should mark key as revoked in DB and invalidate both LRU and Redis caches

PASS src/app.controller.spec.ts
  AppController
    root
      √ should return "Hello World!"

Test Suites: 5 passed, 5 total
Tests:       29 passed, 29 total
Snapshots:   0 total
```

---

## 3. Cycle 1 Release, Monorepo Git Hygiene & Remote Synchronization

#### Context & Objective
Prepare the codebase for remote publication to `https://github.com/KartikaySingh0211/vedora.git` representing Cycle 1 of development. Establish ironclad git hygiene to prevent accidental leak of sensitive credentials, environment files, build artifacts, and dependency trees.

#### What Was Done
1. **Root Git Configuration & Secret Protection**:
   - Created top-level `.gitignore` enforcing universal exclusions:
     - Dependency trees: `node_modules/`, `.pnp.*`, `.yarn/`
     - Compilation artifacts: `dist/`, `.next/`, `build/`, `out/`, `*.tsbuildinfo`, `next-env.d.ts`
     - Secrets & Environment variables: `.env`, `.env.*`, `.env.local` (safely whitelisting `.env.example`)
     - Runtime logs and PID locks: `*.log`, `npm-debug.log*`, `pids`, `*.pid`
     - Local platform/OS artifacts: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/*`
2. **Repository Initialization & Validation**:
   - Initialized Git repository targeting `main` branch.
   - Performed dry-run status and ignored files inspection (`git status --ignored -s`) confirming that active `.env` files across `apps/landing-page/`, `apps/main-dashboard/`, and `services/` are completely excluded.
3. **Remote Binding**:
   - Configured `origin` remote to `https://github.com/KartikaySingh0211/vedora.git`.
   - Verified remote accessibility and branch readiness via `git ls-remote origin`.

#### Why (Rationale & Security Modeling)
- **Zero-Exposure Credential Policy**: In modern SaaS environments, credential exposure via accidental git pushes accounts for over 70% of cloud security incidents. Hardening `.gitignore` at the root and inspecting git status with `--ignored` guarantees that active Neon connection strings and Clerk API secrets remain strictly local.
- **Reproducible Monorepo Builds**: Build caches (`.next/`, `dist/`) and OS artifacts create build friction and non-deterministic behavior across development machines and CI/CD runners. Ignoring them ensures clean builds from source.

---

## Run 2: Video Infrastructure, Direct-to-Cloud Ingestion, Plan Quotas & TypeScript SDK (Part 2)

- **Date**: 2026-10-20
- **Author**: Antigravity IDE (Gemini 3.8 Flash)
- **Scope**: Video metadata management, direct-to-cloud ingestion with OneMinute Cloud Storage, plan-based storage quotas and resolution restrictions, custom `@vedora/sdk` package, and dashboard upload/listing integration.

---

### 1. Phase 1: Database & Quota Foundations

#### Context & Objective
Extend the database schema to support video entities with 20 distinct metadata fields, lifecycle states (`uploading`, `uploaded`, `processing`, `ready`, `failed`), and referential integrity to playlists. Define centralized subscription tier caps (Free: 5 GiB, Starter: 250 GiB, Pro: 600 GiB, Business: 2 TiB), resolution rules (1080p prohibited on Free), and concurrency-safe transactional reservation mechanisms.

#### What Was Done
1. **Schema Extension (`services/src/database/schema.ts`)**:
   - Added `videos` table containing `id` (UUID default random), `user_id` (indexed), `playlist_id` (foreign key to `playlist.id` with `ON DELETE SET NULL`, indexed), `title`, `slug`, `description`, `tags` (JSONB default `[]`), `storage_key`, `bucket_id`, `size` (Bigint), `estimated_transcoded_size` (Bigint), `duration` (integer), `status` (text with union type default `'uploading'`, indexed), `resolutions` (JSONB default `['720p']`), `thumbnail_url`, `generate_subtitles` (boolean), `include_watermark` (boolean), `master_m3u8_key`, and timezone-aware timestamps `created_at` and `updated_at`.
2. **Drizzle Migration**:
   - Generated `drizzle/0002_uneven_cardiac.sql` and applied it to the active Neon PostgreSQL database.
   - Verified that all 3 tables (`api_key`, `playlist`, `videos`) and migration journals are tracked and healthy.
3. **Plan Configuration & Safe Math (`services/src/config/plans.config.ts`)**:
   - Established binary unit constants (`GIB_BYTES = 1073741824n`, `TIB_BYTES = 1099511627776n`).
   - Configured exact plan limits and resolution gates:
     - `free`: 5 GiB cap, 1080p prohibited.
     - `starter`: 250 GiB cap, 1080p permitted.
     - `pro`: 600 GiB cap, 1080p permitted.
     - `business`: 2 TiB cap, 1080p permitted.
   - Implemented `calculateEstimatedTranscodedSize` using native BigInt arithmetic: 720p at `(rawSize * 70n) / 100n` (0.7x), multi-resolution including 1080p at `(rawSize * 175n) / 100n` (1.75x).
   - Incoming reservation = `rawSize + estimatedTranscodedSize`.

#### Why (Rationale & Threat Modeling)
- **Zero Floating-Point Imprecision**: File sizes in gigabytes exceed JavaScript's 32-bit bitwise limit. Using native BigInt integer arithmetic ensures that byte accounting never suffers from IEEE 754 floating-point rounding drifts.
- **Transactional Advisory Lock Concurrency Defense**: Querying table sums without locks exposes applications to race conditions where simultaneous concurrent uploads bypass plan limits. Acquiring `pg_advisory_xact_lock(hashtext('vedora_storage_quota_' || userId))` inside the database transaction serializes reservation evaluations per user without table-level locking.
- **Active Reservation Counting**: Marking newly initialized uploads as `status: 'uploading'` immediately accounts for incoming bytes in active quota sums, preventing users from initiating multiple simultaneous uploads that exceed their tier limits.

---

### 2. Phase 2: Backend Video Module

#### Context & Objective
Implement enterprise RESTful endpoints under `/api/v1/videos` supporting upload initialization, completion confirmation, user-scoped listing, detail fetching, and deletion with quota and playlist reconciliation.

#### What Was Done
1. **Validated DTOs**:
   - `CreateVideoInitDto`: Validates `title`, alphanumeric kebab-case `slug`, positive integer `size`, optional `resolutions` (`720p`, `1080p`), optional `playlistId` (UUID v4), optional description, tags, subtitle, and watermark flags.
   - `CompleteVideoUploadDto`: Validates `videoId` (UUID v4), `storageKey`, and non-negative integer `duration`.
2. **Upload Video Guard (`services/src/guards/upload-video.guard.ts`)**:
   - Enforces user authentication, validates body, rejects negative or zero byte sizes, checks requested resolutions, resolves user plan from server-side metadata, forbids 1080p on Free tier with HTTP 403, and rejects requests exceeding total plan capacity.
3. **OneMinute Cloud Storage Integration (`services/src/infra/storage/storage.service.ts`)**:
   - Communicates directly with OneMinute Cloud Storage (`https://api.oneminutecloud.com/api/v1`) using server-side `ONEMINUTECLOUD_API_KEY`.
   - `initiateMultipartUpload`: Generates presigned chunk PUT endpoints and object metadata.
   - `completeMultipartUpload`: Confirms completion with the storage provider.
4. **Video Service & Controller (`services/src/modules/videos/`)**:
   - `POST /api/v1/videos/init`: Transactional advisory lock, quota verification, playlist validation, storage authorization, and `uploading` record persistence.
   - `POST /api/v1/videos/complete`: Idempotent state transition (`uploading` -> `uploaded`), storage key match verification, duration recording, and atomic playlist `total_videos` increment.
   - `GET /api/v1/videos`: Scoped video listing with optional `playlistId` filter and stable descending sort.
   - `GET /api/v1/videos/:id`: Video detail verification.
   - `DELETE /api/v1/videos/:id`: Atomic playlist counter decrement (`GREATEST(0, total_videos - 1)`), video removal, and quota release.
5. **Unit Tests**:
   - Added comprehensive test suites: `upload-video.guard.spec.ts` (7 tests) and `video.service.spec.ts` (14 tests). All 50 tests pass across 7 suites.

---

### 3. Phase 3: Custom TypeScript SDK (`@vedora/sdk`)

#### Context & Objective
Build an independent, reusable TypeScript SDK located at `sdks/vedora-sdk` for browser and Node.js runtimes.

#### What Was Done
1. **Scaffolded Package**: `package.json` (`@vedora/sdk` v1.0.0), `tsconfig.json` with bundler resolution.
2. **Types (`src/types.ts`)**: Defined `UploadProgress` (`percent`, `uploadedBytes`, `totalBytes`, `speedBps`, `etaSeconds`), `VideoMetadataInput`, `VideoRecord`, and `VedoraError` hierarchy with phase tags (`init`, `upload`, `complete`, `general`).
3. **Direct-to-Cloud Uploader (`src/uploader.ts`)**:
   - Slices files into chunks via `file.slice(start, end)`.
   - Transfers chunks directly to presigned storage URLs via HTTP PUT.
   - Extracts ETags and tracks loaded bytes.
   - Implements bounded exponential backoff with jitter on transient 5xx errors (up to 3 retries, capped at 8s).
   - Rejects 4xx client errors immediately without wasteful retries.
   - Supports `AbortSignal` for user upload cancellation.
   - Enforces safe progress math (bounds between 0% and 100%, safe division by zero, non-negative numbers).
4. **VedoraClient (`src/client.ts`)**:
   - Supports configurable `baseUrl`, `apiKey`, and dynamic `bearerToken` (accepting async Clerk token provider).
   - Orchestrates the full 3-step upload pipeline in `client.videos.upload`.
   - Provides CRUD methods: `init`, `complete`, `list`, `get`, `delete`.
5. **Verified Build & Tests**:
   - Compiled `.d.ts` and `.js` via `tsc`.
   - Passed test suite via Node.js test runner (`node --test`).

---

### 4. Phase 4: Dashboard Integrations

#### Context & Objective
Connect the Next.js dashboard to the `@vedora/sdk` package, live playlist selector, resolution picker, real-time upload telemetry, and reactive video library listing.

#### What Was Done
1. **Monorepo Workspace Link**:
   - Added `"@vedora/sdk": "file:../../sdks/vedora-sdk"` to `apps/main-dashboard/package.json`.
   - Configured `turbopack: { root: path.resolve(process.cwd(), "../../") }` and `transpilePackages: ["@vedora/sdk"]` in `next.config.ts`.
2. **Enhanced Upload Page (`apps/main-dashboard/app/uploads/page.tsx` & `/upload`)**:
   - Integrated `VedoraClient` with Clerk `getToken()` bearer authentication.
   - Added resolution selection toggles: `720p` (standard) and `1080p` (gated with plan notice).
   - HTML5 video metadata duration derivation.
   - Real-time progress overlay displaying percentage, MB/s speed, and estimated time remaining.
   - Success banner detailing created video ID and storage key with quick navigation to My Videos.
   - Error banner displaying structured server rejection messages (quota exceeded, prohibited resolution).
3. **Reactive Video Library (`apps/main-dashboard/app/my-videos/page.tsx` & `/videos`)**:
   - Integrated TanStack Query hooks fetching real data from `GET /api/v1/videos`.
   - Connected playlist filter mapping raw IDs to playlist names.
   - Built Table and Grid view toggle.
   - Created status badges for all 5 lifecycle states: `uploading` (amber ping), `uploaded` (blue), `processing` (purple pulse), `ready` (green), `failed` (red).
   - Displayed resolution tags, formatted duration (`mm:ss`), and humanized file sizes (`MB`/`GB`).
   - Implemented Copy Video ID action with visual checkmark feedback.
   - Implemented Copy Embed Template action with modal/toast disclaimer noting player integration in Part 3.
   - Implemented Delete Video modal with confirmation and query cache invalidation.

---

### 5. Phase 5: Verification & Monorepo Test Summary

```text
=== Services Test Suite ===
PASS src/guards/upload-video.guard.spec.ts (7 tests)
PASS src/modules/videos/video.service.spec.ts (14 tests)
PASS src/modules/playlist/playlist.service.spec.ts (10 tests)
PASS src/modules/api-key/api-key.service.spec.ts (7 tests)
PASS src/guards/dual-auth.guard.spec.ts (5 tests)
PASS src/utils/api-key.util.spec.ts (5 tests)
PASS src/app.controller.spec.ts (2 tests)

Test Suites: 7 passed, 7 total
Tests:       50 passed, 50 total
Snapshots:   0 total

=== SDK Test Suite ===
▶ Vedora SDK
  ✔ should initialize VedoraClient with default config
  ✔ should accept custom baseUrl and apiKey
  ✔ should reject empty or zero-byte file in client.videos.upload
✔ Vedora SDK (3 tests passed)

=== Static Analysis & Linters ===
services:            0 errors, 0 warnings
apps/main-dashboard: 0 errors
apps/landing-page:   0 errors

=== Production Builds ===
services:            Compiled successfully (dist/main.js)
sdks/vedora-sdk:     Compiled successfully (dist/index.d.ts, dist/index.js)
apps/main-dashboard: Compiled successfully via Turbopack (17 static & dynamic routes)
apps/landing-page:   Compiled successfully via Turbopack (5 routes)

=== Live Endpoints Verified ===
GET  /api/v1/health             ➔ 200 OK (DB up, Redis fallback active)
GET  /api/v1/videos             ➔ 401 Unauthorized (Missing credentials)
POST /api/v1/videos/init        ➔ 401 Unauthorized (Missing credentials)
POST /api/v1/videos/init (VDR_) ➔ 401 Unauthorized (Invalid or revoked API key)
```

---

## Run 3: Cycle 3 Implementation — Transcoding, HLS Player, Analytics & Billing

**Execution Date**: 2026-10-20  
**Phase Target**: Video Transcoding, Rendition Ladders, Standalone Embeddable Player, Segment-Level Analytics Telemetry, Custom Player Settings, and Subscription Billing Engine.

---

### 1. Architectural Decisions & Scope

Cycle 3 completes the Vedora video infrastructure platform by connecting video uploads to an asynchronous transcoding pipeline, adaptive-bitrate playback, privacy-first telemetry aggregation, and billing synchronization.

Key architectural deliverables:
1. **Drizzle Schema Finalization & Neon Migration**:
   - `player_settings`: User-scoped playback customization (theme colors, control bar styling, watermark image, position, opacity, subtitle toggles).
   - `subscriptions`: Stripe billing lifecycle state, customer mappings, plan tiers (`free`, `starter`, `pro`, `business`), allocated vs. used playback minutes, and billing period tracking.
   - `video_views`: High-performance session-level playback telemetry records with country, browser, device, duration, and segment counts.
   - `videos.transcoded_size`: Discrete tracking of transcoded storage size to preserve raw upload size (`size_bytes`) and prevent quota skew.
2. **Asynchronous Transcoding Pipeline (`TranscoderModule`)**:
   - Multi-rendition adaptive bitrate ladder (360p, 480p, 720p, 1080p).
   - Non-blocking job processing via Redis worker queue (`vedora:queue:transcode`).
   - Generation of standard HLS RFC 8216 master playlists (`master.m3u8`) and variant media playlists (`index.m3u8`).
   - Direct binary buffer streaming to cloud storage buckets.
   - Cryptographic HMAC-SHA256 signature verification on completion webhook callbacks (`POST /api/v1/transcoder/webhook`).
   - Automatic video status progression (`uploaded` ➔ `processing` ➔ `ready`).
3. **Embeddable Standalone Player (`apps/main-dashboard/app/embed/[videoid]`)**:
   - Native Safari HLS and `hls.js` adaptive bitrate streaming.
   - Complete custom theme styling, manual and automatic resolution selector, fullscreen controls, and error states.
   - Enforced server-derived branding: Mandatory "Powered by Vedora" watermark on Free tier; custom owner watermarks on paid tiers.
   - Isolated full-viewport shell decoupled from dashboard navigation for clean `<iframe>` embedding.
4. **Segment-Level Analytics Telemetry (`AnalyticsModule`)**:
   - Public ingestion endpoint (`POST /api/v1/analytics/segment-ping`).
   - Cryptographic HMAC pseudonymous viewer session token generation (zero raw IP addresses stored).
   - Redis high-throughput buffer (`vedora:analytics:buffer`) flushed periodically into batched PostgreSQL inserts.
   - Multi-window metrics API (`7d`, `30d`, `90d`) returning total views, watch duration, unique viewers, average view duration, device breakdown, browser share, and time-series charts.
   - Connected `apps/main-dashboard/app/analytics` page with TanStack Query and Recharts.
5. **Player Settings API & UI (`PlayerSettingsModule`)**:
   - Authenticated user settings CRUD (`GET`/`PUT` `/api/v1/player-settings`) and public embed config resolution (`GET /api/v1/player-settings/public/:videoId`).
   - Connected `apps/main-dashboard/app/player` page with real-time color pickers, opacity sliders, position toggles, and toast feedback.
6. **Subscription Management & Billing Engine (`BillingModule`)**:
   - Stripe webhook synchronization (`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`).
   - Centralized plan entitlements: Free (1,000 mins / 5 GiB), Starter (10,000 mins / 250 GiB), Pro (22,000 mins / 600 GiB), Business (50,000 mins / 2 TiB).
   - Playback-minute accounting attributed to video owners.
   - UTC-synchronized monthly reset cron (`@Cron('0 0 1 * *', { timeZone: 'UTC' })`) that archives and resets playback minutes while permanently preserving accrued storage.
   - Connected `apps/main-dashboard/app/billing` page with live usage percentages and plan cards.

---

### 2. Implementation Log by Phase

#### Phase 1: Database Finalization
- Modified `services/src/database/schema.ts`:
  - Added `player_settings`, `subscriptions`, and `video_views` tables with indexes on `(user_id, created_at)` and `(video_id, created_at)`.
  - Added `transcoded_size` column to `videos` table.
- Generated migration `0003_tan_aaron_stack.sql` via `drizzle-kit generate`.
- Applied migration safely to Neon PostgreSQL (`drizzle-kit migrate`). Verified all 6 tables: `api_key`, `playlist`, `player_settings`, `subscriptions`, `videos`, `video_views`.

#### Phase 2: Asynchronous Transcoding Pipeline
- Implemented `services/src/modules/transcoder/transcoder.service.ts`:
  - Enqueueing transcoding jobs upon upload completion in `VideoService.completeVideo`.
  - Rendition specifications (360p, 480p, 720p, 1080p) conforming to standard resolutions and bitrates.
  - Generating master manifest and variant media playlists.
  - Uploading generated HLS artifacts to cloud storage via `StorageService`.
  - HMAC webhook validation and atomic transition of video status to `ready`.
- Implemented `transcoder.processor.ts` for queue consumption.
- Implemented `transcoder.controller.ts` exposing `POST /api/v1/transcoder/webhook`.
- Added list/queue operations (`rpush`, `lpop`, `lrange`, `ltrim`, `llen`) to `RedisService`.
- Authored 9 unit tests in `transcoder.service.spec.ts`.

#### Phase 3: Standalone Embeddable Player
- Installed `hls.js` in `apps/main-dashboard`.
- Created `apps/main-dashboard/components/dashboard-shell.tsx` to conditionally bypass sidebar and margins for `/embed` routes.
- Created `apps/main-dashboard/app/embed/[videoid]/page.tsx`:
  - Loads public player configuration from `/api/v1/player-settings/public/:videoId`.
  - Initializes HLS stream with adaptive bitrate and manual quality selector.
  - Renders custom primary color, control bar glassmorphism, and custom/free-tier watermarks.
  - Sends 10-second playback telemetry pings to `/api/v1/analytics/segment-ping`.

#### Phase 4: Segment-Level Analytics Telemetry
- Implemented `services/src/modules/analytics/analytics.service.ts`:
  - Public telemetry ingestion with rate bounding (max 30s per ping).
  - HMAC-SHA256 pseudonymous session hashing.
  - Redis list buffering (`vedora:analytics:buffer`).
  - Batched persistence into PostgreSQL `video_views`.
  - Authenticated query engine for `7d`, `30d`, and `90d` time windows.
- Implemented `analytics.processor.ts` running scheduled 5-second buffer flushes.
- Implemented `analytics.controller.ts` with dual auth guards.
- Connected `apps/main-dashboard/app/analytics/page.tsx` with TanStack Query and Recharts.
- Authored 6 unit tests in `analytics.service.spec.ts`.

#### Phase 5: Player Settings API and Dashboard
- Implemented `services/src/modules/player-settings/player-settings.service.ts`:
  - Automatic creation of default settings.
  - Color, opacity, play icon, and position validation.
  - Public endpoint exposing only non-sensitive playback configuration.
- Implemented `player-settings.controller.ts`.
- Connected `apps/main-dashboard/app/player/page.tsx` with real-time form bindings, query cache invalidation, and toast feedback.
- Authored 6 unit tests in `player-settings.service.spec.ts`.

#### Phase 6: Subscription Management & Billing Integration
- Installed `stripe` in `services`.
- Updated `plans.config.ts` with playback-minute allocations across Free, Starter, Pro, and Business plans.
- Implemented `services/src/modules/billing/billing.service.ts`:
  - Fetching user subscription and default Free tier initialization.
  - Stripe webhook handling (`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`).
  - Playback-minute accounting and usage tracking.
  - Playback-minute reset logic preserving storage counters.
- Implemented `billing-cycle.cron.ts` running `@Cron('0 0 1 * *', { timeZone: 'UTC' })`.
- Implemented `billing.controller.ts`.
- Connected `apps/main-dashboard/app/billing/page.tsx` to live API.
- Authored 8 unit tests in `billing.service.spec.ts`.

---

### 3. Verification & Monorepo Test Summary

```text
=== Services Test Suite ===
PASS src/guards/upload-video.guard.spec.ts (7 tests)
PASS src/app.controller.spec.ts (2 tests)
PASS src/modules/playlist/playlist.service.spec.ts (10 tests)
PASS src/utils/api-key.util.spec.ts (5 tests)
PASS src/modules/transcoder/transcoder.service.spec.ts (9 tests)
PASS src/modules/videos/video.service.spec.ts (14 tests)
PASS src/guards/dual-auth.guard.spec.ts (5 tests)
PASS src/modules/player-settings/player-settings.service.spec.ts (6 tests)
PASS src/modules/analytics/analytics.service.spec.ts (6 tests)
PASS src/modules/billing/billing.service.spec.ts (8 tests)
PASS src/modules/api-key/api-key.service.spec.ts (7 tests)

Test Suites: 11 passed, 11 total
Tests:       79 passed, 79 total
Snapshots:   0 total
Time:        9.674 s

=== SDK Test Suite ===
▶ Vedora SDK
  ✔ should initialize VedoraClient with default config
  ✔ should accept custom baseUrl and apiKey
  ✔ should reject empty or zero-byte file in client.videos.upload
✔ Vedora SDK (3 tests passed)

=== Static Analysis & Linters ===
services:            0 errors, 0 warnings
apps/main-dashboard: 0 errors, 0 warnings
apps/landing-page:   0 errors, 0 warnings

```

---

## Run 2: Safe Modularity, Code Reusability & Frontend Component Architecture

- **Date**: 2026-10-27
- **Author**: Antigravity IDE (Senior Staff Software Engineer)
- **Scope**: Safe modularity refactor across NestJS backend services, Next.js main dashboard, landing page, and SDK. Preserved 100% of existing contracts, database schemas, authentication, and functionality while eliminating code duplication, centralizing cache/lock registries, and standardizing frontend component architecture.

---

### 1. Backend Modularity & Infrastructure Refactoring

#### Context & Objectives
- Eliminate raw string literals for transaction advisory locks (`vedora_storage_quota_${userId}`, `vedora_playlist_quota_${userId}`) and Redis buffer keys.
- Extract duplicated user-agent and referrer parsing into pure, testable utility functions.
- Deduplicate active storage calculation queries and playlist serialization across services.
- Resolve 7 baseline ESLint errors in storage infrastructure modules without breaking local chunk uploads.

#### What Was Done
1. **Centralized Lock and Cache Keys (`services/src/common/cache-keys.ts`)**:
   - Created typed `CACHE_KEYS` object containing:
     - `storageQuotaLock(userId: string): string`
     - `playlistQuotaLock(userId: string): string`
     - `analyticsBuffer: 'vedora:analytics:buffer'`
     - `transcodeQueue: 'vedora:transcode'`
2. **Decoupled User-Agent & Referrer Parsing (`services/src/utils/user-agent.util.ts`)**:
   - Extracted pure helper functions: `detectBrowser(userAgent)`, `detectDevice(userAgent)`, `cleanReferrer(referrer)`.
   - Created comprehensive unit test suite `services/src/utils/user-agent.util.spec.ts` with 11 test cases (Chrome, Safari, Firefox, Edge, iPhone, iPad, Android, desktop, domain cleanup).
   - Updated `AnalyticsService` to consume the utility and typed buffer key.
3. **Canonical Drizzle Type Exports (`services/src/database/schema.ts`)**:
   - Exported `Video`, `InsertVideo`, `Playlist`, `InsertPlaylist`, `ApiKey`, `InsertApiKey`.
4. **Service-Level Deduplication**:
   - **`PlaylistService`**: Introduced private `serializePlaylist(record: Playlist): PlaylistResponse`, removing 4x copy-pasted mapping blocks. Integrated `CACHE_KEYS.playlistQuotaLock`.
   - **`VideoService`**: Extracted private `calculateUserActiveStorageUsage(tx, userId): Promise<bigint>`, consolidating active storage calculations (`uploading`, `uploaded`, `processing`, `ready`). Integrated `CACHE_KEYS.storageQuotaLock`.
5. **Baseline Lint Fixes**:
   - `storage.controller.ts`: Added typed casting for chunk registry JSON parsing (`Record<string, string>`).
   - `storage.service.ts`: Removed unused `BadGatewayException`, typed chunk registry, documented non-fatal chunk cleanup `catch` block.

---

### 2. Frontend Component Architecture & Utilities (`apps/main-dashboard`)

#### Context & Objectives
- Eliminate copy-pasted breadcrumb navigation, title headers, and loading/error/empty blocks across all dashboard pages.
- Centralize byte and duration formatting functions.
- Preserve all existing route aliases (`/upload`, `/playlist`, `/videos`) and layout styling.

#### What Was Done
1. **Centralized Formatters (`apps/main-dashboard/lib/formatters.ts`)**:
   - `formatBytes(bytes: number, decimals?: number): string`
   - `formatDuration(seconds: number): string`
   - `formatNumber(num: number): string`
2. **Reusable Common Components (`apps/main-dashboard/components/common/`)**:
   - **`PageHeader`**: Unified breadcrumbs (`{ label, href }[]`), page title, descriptive subtitle, and contextual action buttons.
   - **`StatusBadge`**: Visual status pill with color-coded badges for video lifecycle states (`ready`, `processing`, `uploading`, `uploaded`, `failed`).
   - **`LoadingState`**: Uniform accessible loading spinner with custom messaging and height.
   - **`ErrorState`**: Standardized alert card with title, message, and optional retry action.
   - **`EmptyState`**: Empty state card with icon, title, description, and action button.
   - **`index.ts`**: Barrel export for easy consumption.
3. **Application Across Dashboard Pages**:
   - `app/my-videos/page.tsx`: Applied `PageHeader`, `StatusBadge`, `LoadingState`, `ErrorState`, `EmptyState`, and `formatBytes`.
   - `app/playlists/page.tsx`: Replaced duplicated breadcrumb/header and spinner/alert blocks with `PageHeader`, `LoadingState`, and `ErrorState`.
   - `app/billing/page.tsx`: Replaced breadcrumbs and header markup with `PageHeader`.
   - `app/branding/page.tsx`: Replaced breadcrumbs and header markup with `PageHeader`.
   - `app/player/page.tsx`: Replaced breadcrumbs, header markup, and loading spinner with `PageHeader` and `LoadingState`.
4. **Contract Alignment & Backward Compatibility**:
   - Added and exported `PublicPlayerConfig` in `lib/api-client.ts`.
   - Refactored `components/player/vedora-player.tsx` to use `API_BASE_URL` and `PublicPlayerConfig`.
   - Maintained `apps/main-dashboard/lib/utils/index.ts` re-export shim guaranteeing zero breakage for existing UI imports.

---

### 3. Verification & Monorepo Test Summary

```text
=== Services Test Suite ===
PASS src/utils/api-key.util.spec.ts (5 tests)
PASS src/guards/upload-video.guard.spec.ts (7 tests)
PASS src/utils/user-agent.util.spec.ts (11 tests) [NEW]
PASS src/app.controller.spec.ts (2 tests)
PASS src/modules/playlist/playlist.service.spec.ts (10 tests)
PASS src/modules/player-settings/player-settings.service.spec.ts (6 tests)
PASS src/modules/analytics/analytics.service.spec.ts (6 tests)
PASS src/modules/transcoder/transcoder.service.spec.ts (9 tests)
PASS src/guards/dual-auth.guard.spec.ts (5 tests)
PASS src/modules/billing/billing.service.spec.ts (8 tests)
PASS src/modules/videos/video.service.spec.ts (14 tests)
PASS src/modules/api-key/api-key.service.spec.ts (7 tests)

Test Suites: 12 passed, 12 total (+1 suite)
Tests:       91 passed, 91 total (+12 tests)
Snapshots:   0 total
Time:        4.865 s

=== SDK Test Suite ===
▶ Vedora SDK
  ✔ should initialize VedoraClient with default config
  ✔ should accept custom baseUrl and apiKey
  ✔ should reject empty or zero-byte file in client.videos.upload
✔ Vedora SDK (3 tests passed)

=== Static Analysis & Linters ===
services:            0 errors, 0 warnings (7 baseline errors fixed)
apps/main-dashboard: 0 errors, 0 warnings (7 baseline warnings fixed)
apps/landing-page:   0 errors, 0 warnings

=== Production Builds ===
services:            Compiled successfully via nest build (dist/main.js)
sdks/vedora-sdk:     Compiled successfully via tsc (dist/index.d.ts, dist/index.js)
apps/main-dashboard: Compiled successfully via next build Turbopack (17 static & dynamic routes)
apps/landing-page:   Compiled successfully via next build Turbopack (5 static & dynamic routes)
```

---

## [2026-10-27] — Run #10: Complete Swagger / OpenAPI 3.0 Documentation & Developer API Docs Hub

### 1. Problem Statement & Audit
Prior to this run, the Vedora backend exposed a Swagger UI interface at `/api/docs`, but endpoints suffered from severe documentation drift:
- Request bodies for key mutations (e.g. `POST /api/v1/videos/init`, `POST /api/v1/videos/complete`, `POST /api/v1/analytics/segment-ping`, `PUT /api/v1/player-settings`) rendered as empty `{}` schemas because DTO properties lacked `@ApiProperty()` / `@ApiPropertyOptional()` decorators or used plain interfaces.
- Response sections frequently displayed only generic status codes (`200`, `201`) without typed schema payloads or realistic JSON examples.
- Security definitions in Swagger UI were missing or unconfigured for the DualAuthGuard architecture (Clerk JWT `bearer` and `x-api-key`).
- Standard error responses (`400`, `401`, `403`, `404`, `413`) were completely undocumented, making client integration and error handling unpredictable.
- No standalone, developer-first documentation existed under `docs/api-docs/` to guide developers, SDK consumers, or external integrators.

### 2. Architecture & Design Decisions

1. **Enterprise DTO Schema Standardization**:
   - Created reusable standard response envelopes in [`services/src/common/dto/error-response.dto.ts`](services/src/common/dto/error-response.dto.ts): `ErrorResponseDto` (for 401, 403, 404, 413, 500), `ValidationErrorResponseDto` (for 400 with string array message), and `ActionSuccessResponseDto`.
   - Created typed response DTOs for every module:
     - Health: `HealthResponseDto`, `HealthDependenciesDto`
     - API Keys: `ApiKeyResponseDto`, `CreatedApiKeyResponseDto`
     - Playlists: `PlaylistResponseDto`
     - Videos: `VideoResponseDto`, `StoragePartDto`, `StorageInitiateResultDto`, `VideoInitResponseDto`
     - Storage: `StorageUploadResponseDto`
     - Transcoder: `TranscoderWebhookResponseDto`, `TranscoderProcessResponseDto`
     - Player Settings: `PlayerSettingsResponseDto`, `PublicPlayerConfigResponseDto`
     - Analytics: `MetricsResponseDto`, `DeviceBreakdownDto`, `BrowserBreakdownDto`, `TimeSeriesPointDto`, `TopVideoDto`, `SegmentPingResponseDto`
     - Billing: `SubscriptionResponseDto`, `BillingWebhookResponseDto`
2. **Dual Security Scheme Integration in DocumentBuilder**:
   - In [`services/src/main.ts`](services/src/main.ts), configured both `addBearerAuth` (name: `bearer`, scheme: `bearer`, format: `JWT`) and `addApiKey` (name: `x-api-key`, in: `header`).
   - Enabled `persistAuthorization: true` to preserve developer tokens across browser reloads.
3. **Controller Documentation & Decorator Pass**:
   - Fully decorated all 10 controllers across 19 endpoints with `@ApiTags`, `@ApiOperation`, `@ApiParam`, `@ApiQuery`, `@ApiHeader`, `@ApiBearerAuth('bearer')`, `@ApiSecurity('x-api-key')`, and standard typed responses (`@ApiOkResponse`, `@ApiCreatedResponse`, `@ApiAcceptedResponse`, `@ApiBadRequestResponse`, `@ApiUnauthorizedResponse`, etc.).
   - Explicitly configured media streaming endpoints with `@ApiProduces('video/mp4', 'application/vnd.apple.mpegurl')` and `@ApiResponse({ status: 206, description: 'Partial Content' })`.
4. **Automated OpenAPI Spec Generation & Testing**:
   - Created [`services/src/swagger.spec.ts`](services/src/swagger.spec.ts), which compiles `AppModule`, generates the complete OpenAPI 3.0 document, verifies tag taxonomy and security schemes, and automatically exports the 109KB specification to [`docs/openapi.json`](docs/openapi.json).
5. **Dedicated API Documentation Hub**:
   - Established `docs/api-docs/` containing:
     - [`docs/api-docs/README.md`](docs/api-docs/README.md): Master developer documentation with complete 19-endpoint reference, curl examples, and schema overviews.
     - [`docs/api-docs/SWAGGER_GUIDE.md`](docs/api-docs/SWAGGER_GUIDE.md): Deep-dive into Swagger configuration, UI usage, decorator best practices, CI testing, and client code generation.
     - [`docs/api-docs/SCHEMAS_AND_MODELS.md`](docs/api-docs/SCHEMAS_AND_MODELS.md): Exhaustive dictionary of all 24 DTOs, field types, constraints, and validation rules.
     - [`docs/api-docs/AUTHENTICATION.md`](docs/api-docs/AUTHENTICATION.md): DualAuthGuard specification, Clerk Bearer tokens, Argon2id API key hashing, and 3-tier caching (LRU + Redis).
     - [`docs/api-docs/WEBHOOKS_AND_EVENTS.md`](docs/api-docs/WEBHOOKS_AND_EVENTS.md): Transcoder HMAC-SHA256 signatures, Stripe billing webhooks, idempotency, and local simulation.

### 3. Verification & Monorepo Test Summary

```text
=== Services Test Suite ===
PASS src/utils/api-key.util.spec.ts (5 tests)
PASS src/app.controller.spec.ts (2 tests)
PASS src/utils/user-agent.util.spec.ts (11 tests)
PASS src/modules/playlist/playlist.service.spec.ts (10 tests)
PASS src/guards/upload-video.guard.spec.ts (7 tests)
PASS src/modules/player-settings/player-settings.service.spec.ts (6 tests)
PASS src/modules/transcoder/transcoder.service.spec.ts (9 tests)
PASS src/modules/analytics/analytics.service.spec.ts (6 tests)
PASS src/modules/videos/video.service.spec.ts (14 tests)
PASS src/guards/dual-auth.guard.spec.ts (5 tests)
PASS src/modules/billing/billing.service.spec.ts (8 tests)
PASS src/swagger.spec.ts (5 tests) [NEW]
PASS src/modules/api-key/api-key.service.spec.ts (7 tests)

Test Suites: 13 passed, 13 total (+1 suite)
Tests:       96 passed, 96 total (+5 tests)
Snapshots:   0 total
Time:        4.074 s

=== Static Analysis & Linters ===
services:            0 errors, 0 warnings

=== Production Builds ===
services:            Compiled successfully via nest build (dist/main.js)
```

---

## [2026-10-28 / 2026-10-29] — Run #11: Cloudflare R2 Migration, Non-Blocking Background Upload Queue, and Automatic Adaptive Rendition Ladder (Option A)

### 1. Problem Statement & Audit
Following initial video ingestion and transcode development:
1. **Third-Party Storage Instability**: Reliance on OneMinute Cloud caused intermittent upstream 500/502 errors during multipart initiate and lacked zero-egress predictability.
2. **Blocking Upload UX**: When users uploaded video files in the dashboard, a modal overlay remained permanently pinned to the screen, preventing navigation to `/my-videos` or multitasking. Furthermore, video statuses on `/my-videos` did not update without manual browser page reloads.
3. **Single-Rendition Selection vs. Adaptive Ladders**: Choosing 720p or 1080p in the upload form encoded only that exact single rendition rather than a full multi-bitrate adaptive ladder, undermining HLS adaptive bitrate switching (ABR) on mobile and constrained connections.

### 2. Architecture & Design Decisions

1. **Cloudflare R2 Native S3 Driver (`StorageService`)**:
   - Replaced OneMinute Cloud with native Cloudflare R2 using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
   - Credentials configured via `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_PUBLIC_URL`.
   - In `initiateMultipartUpload`, generates S3-compliant presigned `UploadPartCommand` URLs directly to `https://<account-id>.r2.cloudflarestorage.com`.
   - In `uploadDirectBuffer`, persists buffers to both local storage (`storage_local/objects/`) and Cloudflare R2 (`PutObjectCommand`), maintaining zero-downtime offline fallback capability.
   - Preserved folder separation: `raw/<bucket>/<timestamp>-<filename>` for original uploads, and `videos/<videoId>/` for HLS assets.

2. **Persistent Non-Blocking Background Upload Queue (`UploadQueueContext`)**:
   - Built a global React upload queue context (`apps/main-dashboard/context/upload-queue-context.tsx`) rendering inside a dedicated right sidebar.
   - When a user submits an upload, they are immediately redirected to `/my-videos`. The upload proceeds in the background with real-time transfer telemetry (MB/s speed, progress bar, estimated time remaining).
   - Configured reactive polling in `/my-videos` (`refetchInterval: 3000` while videos are in `uploading` or `processing` states), dynamically transitioning video cards to `ready` without requiring manual page reloads.

3. **Option A: Automatic Adaptive Rendition Ladder with Quality Ceilings**:
   - Configured standard ladder specifications in [`FfmpegService`](services/src/modules/transcoder/ffmpeg.service.ts):
     - `360p`: 640x360, 800 kbps video, 96 kbps audio, 30 fps
     - `480p`: 854x480, 1400 kbps video, 128 kbps audio, 30 fps
     - `720p`: 1280x720, 2800 kbps video, 128 kbps audio, 30 fps
     - `1080p`: 1920x1080, 5000 kbps video, 192 kbps audio, 60 fps
   - **Quality Ceiling Expansion**:
     - `360p` $\to$ `['360p']`
     - `480p` $\to$ `['360p', '480p']`
     - `720p` $\to$ `['360p', '480p', '720p']`
     - `1080p` $\to$ `['360p', '480p', '720p', '1080p']`
   - **Strict No-Upscaling Rule**: Source video dimensions are probed before encoding; renditions with height greater than source height are pruned (`cand.height <= probe.height`).
   - **Sub-360p Fallback**: If source height is below 360p (e.g. 240p), encodes a custom source-dimension rendition with even dimensions.
   - Master playlist (`master.m3u8`) links every successfully generated rendition variant in descending order.
   - Upload form UI updated to clearly present maximum quality ceilings with descriptions of the generated adaptive stream.

### 3. Verification & Monorepo Test Summary

```text
=== Services Test Suite ===
PASS src/utils/api-key.util.spec.ts (5 tests)
PASS src/modules/playlist/playlist.service.spec.ts (10 tests)
PASS src/modules/analytics/analytics.service.spec.ts (6 tests)
PASS src/guards/dual-auth.guard.spec.ts (5 tests)
PASS src/modules/health/health.controller.spec.ts (3 tests)
PASS src/utils/user-agent.util.spec.ts (11 tests)
PASS src/guards/upload-video.guard.spec.ts (7 tests)
PASS src/modules/billing/billing.service.spec.ts (8 tests)
PASS src/app.controller.spec.ts (2 tests)
PASS src/modules/player-settings/player-settings.service.spec.ts (6 tests)
PASS src/modules/videos/video.service.spec.ts (14 tests)
PASS src/modules/transcoder/transcoder.service.spec.ts (9 tests)
PASS src/infra/storage/storage.controller.spec.ts (5 tests)
PASS src/modules/api-key/api-key.service.spec.ts (7 tests)
PASS src/swagger.spec.ts (5 tests)
PASS src/modules/transcoder/transcoder-e2e.spec.ts (11 tests)
PASS src/modules/transcoder/ffmpeg.service.spec.ts (24 tests)

Test Suites: 17 passed, 17 total
Tests:       138 passed, 138 total
Snapshots:   0 total
Time:        13.007 s

=== SDK Test Suite ===
▶ Vedora SDK
  ✔ should initialize VedoraClient with default config
  ✔ should accept custom baseUrl and apiKey
  ✔ should reject empty or zero-byte file in client.videos.upload
✔ Vedora SDK (3 tests passed)

=== Production Builds ===
services:            Compiled successfully via nest build (dist/main.js)
sdks/vedora-sdk:     Compiled successfully via tsc (dist/index.d.ts, dist/index.js)
apps/main-dashboard: Compiled successfully via next build Turbopack (16 static & dynamic routes)

=== Live Cloudflare R2 Ingestion Verification ===
Bucket: vedora-media
Ceiling: 720p on 720p synthetic fixture
Generated:
  - videos/<id>/master.m3u8 (316 bytes)
  - videos/<id>/720p/index.m3u8 & segment_000.ts (33.4 KB)
  - videos/<id>/480p/index.m3u8 & segment_000.ts (26.1 KB)
  - videos/<id>/360p/index.m3u8 & segment_000.ts (26.5 KB)
All objects retrieved and verified via GetObject/HeadObject; cleaned up afterward.
```


---

## [2026-10-29] - Run #12: Mandatory Pre-Commit Documentation Update Rule & Workspace Assistant Policy

### 1. Context & User Directive
To ensure zero documentation drift across the lifetime of the Vedora project, the user established a strict development rule:
> "create a rule to always update relevant documentation before every commit"

### 2. Architecture & Rule Configuration
1. **Rule Definition (`.agents/rules/documentation-before-commit.md`)**:
   - Implemented an agent rule targeting all files (`globs: ["**/*"]`).
   - Defined a mandatory 6-point pre-commit audit checklist covering:
     1. `docs/ENGINEERING_LOG.md` (Dated run entries for non-trivial changes).
     2. `README.md` (Capabilities, walkthroughs, test badges, environment requirements).
     3. `docs/decisions/ADR-XXX-*.md` (Architectural patterns, storage, queues, schemas).
     4. `docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md` (Topology, sequence diagrams, threat models).
     5. `docs/api-docs/` & `docs/openapi.json` (Endpoints, DTOs, schemas, Swagger).
     6. `docs/bug-fixes/` (`BUG-XXX` entries and updated index table).
   - Codified a 4-step execution workflow: Verify $\to$ Audit & Update Docs $\to$ Stage Atomically $\to$ Commit.

2. **Root Workspace Guidelines (`GEMINI.md`)**:
   - Created top-level `GEMINI.md` defining always-on directory guidance: Documentation-First Policy, Bug Fix Logging Policy, and Empirical Verification Standards.

3. **Git Configuration & Privacy Boundary (`.gitignore`)**:
   - Configured `.gitignore` to explicitly ignore `.agents/` and `GEMINI.md` so that AI assistant configuration, local agent artifacts, and agent rules remain strictly local to the workspace and are never pushed to the public/remote Git repository.
   - Removed `.agents/` and `GEMINI.md` from Git index tracking (`git rm --cached`).


---

## [2026-10-29] - Run #13: Replaced Static Dashboard Mock Data with Live Telemetry, Quota & Video Storage Aggregations

### 1. Context & User Directive
The user reported:
> "the dashboard is showing static data, fix this"

### 2. Technical Findings
1. `apps/main-dashboard/app/page.tsx` was relying on hardcoded placeholder constants:
   - Minutes streamed card: `129 / 1K` and `12.9%` usage.
   - Total requests card: `129` with `96 Avg / Day` and `+12% Growth`.
   - Storage used card: `3.2 GB / 5 GB Total` with `2 Videos` and `1.8 GB Free`.
   - `GeographicalMap`: rendered an internal static `countryData` constant.
   - Top requested URLs table: rendered dummy paths (`/portfolio`, `/projects`, `/course/javascript`).
2. The backend `/analytics/metrics` endpoint did not aggregate geographic country visitors or request referrers from PostgreSQL `video_views`.

### 3. Implementation
1. **Backend Analytics (`services/src/modules/analytics/`)**:
   - Extended `MetricsResponseDto` with `CountryBreakdownDto` and `TopReferrerDto`.
   - Added database aggregations in `AnalyticsService.getMetrics` for `countryBreakdown` (distinct viewer sessions per country) and `topReferrers` (request counts per referrer).
   - Regenerated `docs/openapi.json` and updated `docs/api-docs/SCHEMAS_AND_MODELS.md`.
2. **Dashboard API Client (`apps/main-dashboard/lib/api-client.ts`)**:
   - Added `CountryBreakdownItem` and `TopReferrerItem` interfaces.
   - Updated `AnalyticsMetricsResponse` and `SubscriptionItem` types.
3. **Dynamic Geographical Map (`apps/main-dashboard/components/charts/geoMap.tsx`)**:
   - Replaced internal static array with `data?: GeoCountryData[]` and `isLoading?: boolean` props.
   - Added ISO-2 country code to full name mapping for SVG geography matching.
   - Added empty state indicator for accounts with no recorded viewer traffic yet.
4. **Live Root Dashboard Page (`apps/main-dashboard/app/page.tsx`)**:
   - Integrated TanStack Query hooks fetching `/billing/subscription`, `/videos`, and `/analytics/metrics?window=30d`.
   - Dynamically computed minutes streamed, real-time requests, and active storage consumption (raw size + estimated transcoded size).
   - Rendered Getting Started onboarding guides when user has zero videos, transitioning seamlessly to live statistics upon video upload.
   - Handled empty states and loading skeletons cleanly.
5. **Bug Logging (`docs/bug-fixes/`)**:
   - Authored `BUG-012-dashboard-static-data-replaced-with-live-telemetry.md` and updated `docs/bug-fixes/README.md`.

### 4. Verification Evidence
- `npm --prefix services test`: 17 passed suites, 138 passed tests.
- `npm --prefix sdks/vedora-sdk test`: 3 passed tests.
- `npm --prefix apps/main-dashboard run build`: Turbopack build succeeded with 16 routes and 0 TypeScript errors.

---

## 2026-10-29: Open-Source De-Monetization, Audit Remediation & Infrastructure Hardening

### 1. Context & Motivation
1. **Transition to 100% Open-Source MIT Architecture**: Vedora transitioned into a non-monetized, zero-vendor-cost open-source platform. All Stripe dependencies, subscription tables, commercial tiers, and billing UIs were eliminated and replaced with robust, server-enforced technical safeguards.
2. **Production-Readiness Audit Remediation**: Fixed eight identified security, reliability, media processing, and queue robustness findings across Cloudflare R2, CORS, FFmpeg portrait scaling, local storage 404s, HLS manifest codecs, API-key timing-safe comparisons, queue crash recovery, and Docker PostgreSQL driver compatibility.

### 2. Implementation Details

#### A. Complete Removal of Billing & Subscriptions
- **Backend Services**:
  - Uninstalled `stripe` and removed Stripe credentials from `.env.example` and `configuration.ts`.
  - Deleted `services/src/modules/billing/` (`BillingModule`, `BillingController`, `BillingService`, `BillingCycleCron`, and DTOs).
  - Dropped `subscriptions` table from `services/src/database/schema.ts` and generated Drizzle migration `0005_bouncy_boomerang.sql` (`DROP TABLE "subscriptions" CASCADE;`).
  - Removed subscription updates from `AnalyticsService` and plan-based watermark locks from `PlayerSettingsService`.
- **Frontend Dashboard & Landing Page**:
  - Deleted `apps/main-dashboard/app/billing/` route.
  - Updated `apps/main-dashboard/app/page.tsx`: Replaced `/billing/subscription` queries with direct telemetry from `/analytics/metrics` and `/videos`.
  - Updated `apps/main-dashboard/app/branding/page.tsx`, `components/sidebar.tsx`, and `components/command-menu.tsx` to remove Pro tier badges and upgrade banners.
  - Updated `apps/landing-page` pricing, CTA, navbar, and hero components to represent a $0 open-source platform.
- **Technical Ingestion Safeguards (`services/src/config/plans.config.ts`)**:
  - Replaced commercial plan checks with configurable technical safeguards: `MAX_FILE_SIZE_BYTES` (default 10 GiB), `USER_STORAGE_CAP_BYTES` (default 500 GiB), and unlocked 1080p for all users.
  - Enforced safeguards atomically using PostgreSQL advisory locks (`pg_advisory_xact_lock`).

#### B. Production-Readiness Audit Fixes
- **Cloudflare R2 Reliability**:
  - `StorageService.completeMultipartUpload` and `uploadDirectBuffer` now propagate errors immediately instead of returning false-positive success payloads.
  - Transcoding pipelines verify all HLS assets are persisted before transitioning video state to `READY`.
- **CORS Hardening (`main.ts`)**:
  - Removed wildcard `.endsWith('.vercel.app')` suffix matching.
  - Restricted browser origins strictly to explicit `corsOrigins`, dashboard URLs, and `localhost`/`127.0.0.1`.
- **FFmpeg Portrait & Odd-Dimension Processing (`ffmpeg.service.ts`)**:
  - Implemented dynamic aspect-ratio ladder in `selectRenditions`, inverting dimensions for portrait videos (`height > width`) without upscaling.
  - Formulated universal aspect-ratio preserving scaling with FFmpeg's `-2` dimension token:
    `scale='if(gt(a,W/H),W,-2)':'if(gt(a,W/H),-2,H)',pad=W:H:(ow-iw)/2:(oh-ih)/2,format=yuv420p` with `-profile:v main -level 3.1`.
  - Guaranteed strictly even dimensions across all renditions, fully satisfying `yuv420p` pixel format constraints.
- **Local Storage Missing-File Behavior (`storage.controller.ts`)**:
  - Removed fallback redirecting missing video files to Mozilla's external sample video; returns semantic `404 Not Found` JSON error.
- **RFC 8216 HLS Master Playlist CODECS**:
  - Dynamically injects RFC 8216 compliant codec strings: `CODECS="avc1.4d401f,mp4a.40.2"` when audio is present, and `CODECS="avc1.4d401f"` when audio is absent.
- **API-Key Timing-Safe Comparison (`api-key.util.ts`)**:
  - Implemented `timingSafeEqualHex` using `crypto.timingSafeEqual` with buffer length validation to prevent timing side-channel attacks on cached HMAC-SHA256 digests.
- **Queue Reliability & Crash Recovery (`redis.service.ts` & `transcoder.service.ts`)**:
  - Added atomic job claiming via `RPOPLPUSH` from `vedora:transcode:queue` into `vedora:transcode:processing`.
  - Added heartbeat lock renewal during transcoding and automated stuck job recovery (`recoverStuckJobs`) for worker crashes with up to 3 retries and at-least-once delivery guarantees.
- **Dual Database Driver Selection (`database.module.ts`)**:
  - Added dynamic driver selection: `@neondatabase/serverless` for Neon cloud databases, and `pg.Pool` with `drizzle-orm/node-postgres` for standard PostgreSQL (e.g. local Docker container).

### 3. Verification Evidence
- **Backend Unit & Integration Tests**: `npm --prefix services test`
  - 16 test suites passed, 139 tests passed (including real FFmpeg transcoding tests, portrait tests, odd dimensions, and OpenAPI validation).
- **Swagger / OpenAPI Documentation**: `npm --prefix services test -- swagger.spec.ts`
  - 5 tests passed; regenerated `docs/openapi.json`.
- **TypeScript SDK**: `npm --prefix sdks/vedora-sdk test` & `npm --prefix sdks/vedora-sdk run build`
  - 3 tests passed; build succeeded with zero errors.
- **Dashboard Next.js App**: `npm --prefix apps/main-dashboard run build`
  - Compiled and prerendered 15 routes cleanly with zero TypeScript errors.
- **Landing Page Next.js App**: `npm --prefix apps/landing-page run build`
  - Compiled and prerendered 5 routes cleanly with zero TypeScript errors.

#### C. Dashboard Top Requested URLs Alignment Fix (`apps/main-dashboard/app/page.tsx`)
- **Symptoms**: The "Top Requested URLs" table displayed severe vertical misalignment: the pathname cell (`[L] localhost`) snapped to the top of the container while the rank medal (`🥇`) and requests count floated in the middle/bottom.
- **Root Cause**:
  1. `display: flex` was placed directly on `<td className="... flex items-center ...">`, breaking native table-cell layout and vertical centering in Chromium/Firefox/WebKit.
  2. The `<table>` element had `min-h-75` applied directly to it, forcing a single table row to stretch to ~250px tall.
- **Fix**:
  1. Replaced direct flex styling on `<td>` with an internal `<div className="flex items-center gap-2.5">`, restoring standard `display: table-cell` with vertical centering (`align-middle`).
  2. Removed `min-h-75` from the `<table>` element so rows maintain natural, compact vertical padding (`py-3.5`).
  3. Structured the section into a responsive `grid grid-cols-1 lg:grid-cols-12 gap-8 items-start` layout (`lg:col-span-7` for Visitor Countries map and `lg:col-span-5` for Top URLs table). Wrapped both modules in unified `rounded-xl border border-gray-200 dark:border-[#1f2023] bg-white dark:bg-[#101217]` card containers.
- **Verification**: `npm --prefix apps/main-dashboard run build` compiled and prerendered all 15 routes with 0 errors.

---

## 2026-10-30: AI Subtitle Roadmap References Removal & Documentation Synchronization

### 1. Context & Motivation
Following the removal of billing and subscriptions in favor of a 100% open-source architecture, a comprehensive audit identified legacy and aspirational references to Whisper AI, automated subtitle generation, and transcription pipelines across the landing page, dashboard, README, and API documentation. Because AI transcription is not implemented in the codebase, these references created misleading claims about platform capabilities.

### 2. Actions Executed
- **Landing Page (`apps/landing-page/components/features/index.tsx`)**:
  - Removed `Subtitles` icon import from `lucide-react`.
  - Removed promotional feature card "AI-Powered Captions" (`Auto-generate accurate subtitles and transcriptions for every video.`).
- **Dashboard Upload Studio (`apps/main-dashboard/app/uploads/page.tsx`)**:
  - Removed the non-functional `Generate Subtitles?` form field that included `<option value="yes">Yes (Whisper AI)</option>`.
  - Re-balanced the upload options grid by pairing `Playlist` and `Include Brand Watermark?` together in a responsive 2-column container.
  - Set `generateSubtitles: false` in submission payload to preserve backend API contract compatibility without false UI promises.
- **Support & FAQ (`apps/main-dashboard/app/support/page.tsx`)**:
  - Removed the FAQ entry claiming "Vedora uses AI to automatically generate accurate subtitles in multiple languages."
- **Player Settings UI (`apps/main-dashboard/app/player/page.tsx`)**:
  - Refined description to "Automatically render subtitles track button when subtitle tracks are provided", preserving genuine player caption customization controls while eliminating the automated generation implication.
- **Backend DTOs & OpenAPI (`services/src/modules/videos/dto/`, `docs/openapi.json`)**:
  - Updated Swagger description in `create-video-init.dto.ts` from `'Flag indicating whether automated AI subtitle generation should be initiated'` to `'Flag indicating whether subtitle track processing should be enabled'`, and removed obsolete `(Pro/Business tiers)` description.
  - Updated `video-response.dto.ts` description from `'Whether subtitles should be automatically generated'` to `'Whether subtitle tracks are enabled for this video'`.
  - Regenerated `docs/openapi.json` via Jest OpenAPI test runner.
- **API Documentation (`docs/api-docs/SCHEMAS_AND_MODELS.md`)**:
  - Updated `generateSubtitles` description from `AI subtitle generation flag` to `Subtitle track flag` with `Default: false`.
- **Project README (`README.md`)**:
  - Removed roadmap item `- [ ] **AI-Powered Subtitles**: Automated multi-language subtitle generation via Whisper AI worker hooks.`
  - Corrected test count badge from `(128 tests across 17 suites)` to `(139 tests across 16 suites)` matching actual test suite outputs.

### 3. Empirical Verification Evidence
- **Backend Unit & Integration Test Suite**: `npm --prefix services test`
  - 16 test suites passed, 139 tests passed.
- **Swagger / OpenAPI Generation**: `npm --prefix services test -- swagger.spec.ts`
  - 5 tests passed; regenerated `docs/openapi.json`.
- **Dashboard Build**: `npm --prefix apps/main-dashboard run build`
  - Compiled successfully; 15 static/dynamic routes prerendered cleanly.
- **Landing Page Build**: `npm --prefix apps/landing-page run build`
  - Compiled successfully; 5 static/dynamic routes prerendered cleanly.
- **TypeScript SDK Tests**: `npm --prefix sdks/vedora-sdk test`
  - 1 suite passed, 3 tests passed.
- **Git Repository Audit**:
  - `git grep -in "whisper"`: 0 matches.
  - `git grep -in "transcrib"`: 0 matches.
  - `git diff --check`: 0 whitespace issues.
- **Strict Compliance**: No commits or pushes performed (`git commit` and `git push` withheld per user instructions).

---

## 2026-10-30: Phase 1 & Phase 2 Stabilization Hardening, CI/CD Pipeline & Documentation Reconcile

### 1. Context & Motivation
Following the stabilization roadmap outlined in `docs/STABILIZATION_ROADMAP.md`, Phase 1 and Phase 2 focused on hardening critical backend infrastructure (transcoder webhooks, queue recovery, mock removal) and establishing repository credibility through automated CI/CD workflows and synchronized documentation.

### 2. Actions Executed

#### Phase 1: Security and Reliability Fixes (Commit `f81d680`)
- **Webhook Secret Validation (`services/src/modules/transcoder/transcoder.service.ts`)**:
  - Enforced mandatory startup and runtime validation of `TRANSCODER_WEBHOOK_SECRET` requiring a minimum length of 32 characters after trimming whitespace.
  - Removed all unsafe hardcoded fallbacks and secondary digest secrets (`apiKeyDigestSecret`).
  - Updated `services/.env.example` with clear non-functional placeholders.
- **Raw-Body HMAC Verification (`services/src/main.ts`, `services/src/modules/transcoder/transcoder.controller.ts`)**:
  - Configured NestJS `rawBody: true` and routed exact raw request buffers through `req.rawBody` for HMAC-SHA256 calculation.
  - Enforced `crypto.timingSafeEqual` with zero leakage or secret logging.
- **Mock Fallback Removal & Queue Reliability (`services/src/modules/transcoder/transcoder.service.ts`, `services/src/infra/redis/redis.service.ts`)**:
  - Eliminated mock/dev execution branches that prematurely marked videos `ready` without genuine transcoding.
  - Replaced ad-hoc Redis compatibility hacks with robust command detection.
  - Implemented reliable stalled job recovery (`vedora:transcode:processing` tracking and heartbeat timeout renewal) preventing job abandonment.
  - Added comprehensive regression test suite (`transcoder-phase1-regression.spec.ts`).

#### Phase 2: Project Credibility & GitHub Actions CI Workflow
- **Automated CI Workflow (`.github/workflows/ci.yml`)**:
  - Created automated GitHub Actions matrix covering 4 parallel jobs: `backend-services`, `typescript-sdk`, `main-dashboard`, and `landing-page`.
  - Configured jobs to run on pull requests and pushes to `main`.
  - Added build step dependencies ensuring the SDK compiles before dashboard consumption.
  - Supplied mock/dummy CI environment variables to test builds without external cloud access.
- **Documentation & Positioning Reconciliation**:
  - **`README.md`**: Updated test badge to 158 passing tests across 17 suites; updated bug fix ledger to BUG-014; clarified that 500 GiB storage capacity is a configurable per-user default (`MAX_USER_STORAGE_CAP_BYTES`) rather than a global instance limit; marked CI/CD roadmap item as completed.
  - **`apps/landing-page/components/pricing/index.tsx`**: Replaced `$0 / month` with `$0 (Software License)` and added explicit copy clarifying that Vedora is MIT-licensed open-source software, but self-hosting users incur storage, bandwidth, and compute costs directly from their cloud providers.
  - **`apps/landing-page/components/story/index.tsx`**: Refined story copy to emphasize self-hosted, 100% open-source video infrastructure.
  - **`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`**: Synchronized platform title to 100% open-source video infrastructure platform.
  - **`docs/api-docs/README.md` & `docs/decisions/ADR-011-safe-modularity-and-frontend-reusability.md`**: Reconciled legacy BullMQ mentions with the Redis 7 custom `RPOPLPUSH` transcode queue keys.
  - **`docs/STABILIZATION_ROADMAP.md`**: Updated Phase 1 and Phase 2 status to `Completed` with verification evidence.

### 3. Empirical Verification Evidence
- **Backend Test Suite (`npm --prefix services test`)**: 17 test suites passed, 158 tests passed.
- **Backend Build (`npm --prefix services run build`)**: TypeScript compiled cleanly with exit code 0.
- **SDK Test Suite (`npm --prefix sdks/vedora-sdk test`)**: 1 suite passed, 3 tests passed.
- **SDK Build (`npm --prefix sdks/vedora-sdk run build`)**: TypeScript compiled cleanly with exit code 0.
- **Main Dashboard Build (`npm --prefix apps/main-dashboard run build`)**: All 15 routes compiled and prerendered cleanly with exit code 0.
- **Landing Page Lint & Build (`npm --prefix apps/landing-page run lint && npm --prefix apps/landing-page run build`)**: ESLint passed; all 5 routes compiled with exit code 0.
- **CI Workflow Validation**: `.github/workflows/ci.yml` validated via `js-yaml` with 0 syntax errors.
- **Whitespace & Diff Verification**: `git diff --check` passed with 0 errors.

---

## 2026-10-30: Phase 3 Stabilization Demonstration, Synthetic Media E2E Testing & Empirical Benchmarks

### 1. Context & Motivation
Following the stabilization roadmap in `docs/STABILIZATION_ROADMAP.md`, Phase 3 focuses on providing empirical, reproducible verification of the video processing pipeline. This phase establishes genuine evidence for the end-to-end upload and transcoding lifecycle, measures real encoding throughput across standardized test clips, documents canonical architecture deep-dives with Mermaid sequence diagrams, and publishes a structured walkthrough gallery.

### 2. Actions Executed

#### Task 3.1: End-to-End Walkthrough Demonstration (`docs/assets/demo/`, `README.md`)
- Created structured visual demonstration gallery under `docs/assets/demo/`:
  - `01-direct-upload-studio.png`: Upload studio with drag-and-drop ingestion and real-time sidebar transfer progress.
  - `02-cloudflare-r2-raw-storage.png`: Cloudflare R2 bucket (`raw/vedora-media/`) showing direct client-uploaded master files.
  - `03-cloudflare-r2-master-manifest.png`: Cloudflare R2 bucket (`videos/<uuid>/`) showing `master.m3u8` multivariant playlist.
  - `04-cloudflare-r2-hls-segments.png`: Cloudflare R2 variant directory (`720p/`) containing `index.m3u8` and 4-second `.ts` media segments.
  - `05-video-library-management.png`: Video management dashboard displaying real-time status badges, duration, file sizes, and embed launcher.
  - `06-embed-player-adaptive-playback.png`: Interactive `<VedoraPlayer />` modal demonstrating adaptive bitrate streaming via HLS.js.
- Authored comprehensive walkthrough guide in `docs/assets/demo/README.md` with complete sequence diagram and local reproduction instructions.
- Linked walkthrough gallery and updated test badges in `README.md`.

#### Task 3.2: Automated Synthetic Video End-to-End Test Suite (`services/src/modules/transcoder/transcoder-live-e2e.spec.ts`)
- Created automated synthetic E2E test suite generating 2-second 640x360 media with synchronized audio using FFmpeg `lavfi` (`testsrc` and `sine` filters).
- Verified full pipeline without mocks:
  - Redis queue dispatch (`vedora:transcode:queue`).
  - Worker atomic claim via `RPOPLPUSH` (`vedora:transcode:processing`).
  - Worker media metadata probing via `ffprobe`.
  - HLS variant encoding and master manifest assembly via `ffmpeg`.
  - Storage persistence of `master.m3u8`, variant playlists (`360p/index.m3u8`), and `.ts` media chunks.
  - RFC 8216 tag validation (`#EXTM3U`, `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION`, `#EXTINF`, `#EXT-X-ENDLIST`).
  - Verified MPEG-TS sync byte `0x47` across all generated `.ts` chunks.
  - Programmatically probed generated `.ts` segments using `ffprobe` to verify real playable H.264 video streams.
  - Verified safe failure handling and error sanitization for corrupted inputs.

#### Task 3.3: Canonical Architecture Deep-Dives (`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`)
- **Cache Eviction & Anti-Rehydration Sequence (`### 3.1`)**: Mermaid sequence diagram detailing dual-invalidation of Level 1 LRU and Level 2 Redis caches before and after database revocation updates to prevent concurrent read rehydration.
- **Atomic Storage Quota Enforcement (`### 6.1`)**: Mermaid sequence diagram illustrating PostgreSQL transaction advisory lock (`pg_advisory_xact_lock`), summing active storage + incoming reservation against `MAX_USER_STORAGE_CAP_BYTES` (500 GiB default), and serializing concurrent upload requests.
- **Redis Worker Crash Recovery & Sweeper Sequence (`### 7.2`)**: Mermaid sequence diagram documenting atomic `RPOPLPUSH` claiming, worker crash simulation, heartbeat lease expiration, and `recoverStuckJobs` sweeper re-enqueuing.

#### Task 3.4: Empirical Performance Benchmarks (`docs/BENCHMARKS.md`, `services/test/run-benchmark.ts`)
- Implemented standalone benchmark harness (`services/test/run-benchmark.ts`) measuring real transcoding performance across standardized 10-second synthetic test clips on physical hardware (AMD Ryzen 5 5625U, 12 threads, 15.34 GB RAM).
- Published genuine measured results in `docs/BENCHMARKS.md`:
  - **Standard 360p SD Clip**: Transcoded in 1,118 ms (**8.94x real-time speed factor**).
  - **Adaptive 720p HD Ladder**: 3 variant ladders (`720p`, `480p`, `360p`) transcoded in 4,563 ms (**2.19x real-time speed factor**).
  - **Full Ladder 1080p FHD Ingestion**: 4 variant ladders (`1080p`, `720p`, `480p`, `360p`) transcoded in 8,681 ms (**1.15x real-time speed factor**).
- Zero speculative or estimated metrics published.

### 3. Empirical Verification Evidence
- **Backend Test Suite (`npm --prefix services test`)**: 18 test suites passed, 161 tests passed (up from 158 tests / 17 suites).
- **Backend Build (`npm --prefix services run build`)**: TypeScript compiled cleanly with exit code 0.
- **TypeScript SDK Tests (`npm --prefix sdks/vedora-sdk test`)**: 1 suite passed, 3 tests passed.
- **SDK Build (`npm --prefix sdks/vedora-sdk run build`)**: TypeScript compiled cleanly with exit code 0.
- **Main Dashboard Build (`npm --prefix apps/main-dashboard run build`)**: All 15 routes compiled and prerendered cleanly with exit code 0.
- **Landing Page Build (`npm --prefix apps/landing-page run build`)**: All 5 routes compiled and prerendered cleanly with exit code 0.
- **Git Whitespace & Formatting (`git diff --check`)**: Passed with 0 whitespace errors or conflict markers.

---

## 2026-10-30 — Incident Resolution: BUG-015 Stale Docker Image & Player Settings Subscriptions Query

### 1. Context & Incident Diagnosis
During video playback verification, the user reported that after successfully uploading and transcoding 2 videos (`178060d7-da70-4be3-add5-37eae3621a30` and `5fda0f64-50cb-43e5-a8f5-eee9b2a602ad`), the frontend embed player displayed `Playback Status: Video not found or unavailable (HTTP 500)`. Both videos were present in Neon PostgreSQL (status `ready`, `master_m3u8_key` populated) and all HLS media playlists and chunks were present in Cloudflare R2.
The backend logs emitted:
```text
ERROR [AllExceptionsFilter] [GET] /api/v1/player-settings/public/<videoId> - Status: 500 - Error: Failed query: select "id", "user_id", "stripe_customer_id", ... from "subscriptions" where "subscriptions"."user_id" = $1 limit $2
```

### 2. Root Cause
1. In commit `d0e69c5a` (de-monetization refactor), the `subscriptions` table was dropped via Drizzle migration `0005_bouncy_boomerang.sql`, and all queries referencing `subscriptions` were removed from source code.
2. However, the Docker image `vedora-api:latest` was built on 2026-10-28 (`2026-10-28T18:44:09Z`) prior to the de-monetization commit. When running via Docker Compose without `--build`, Docker reused the stale image containing pre-Oct 30 compiled JavaScript binaries that still queried `subscriptions`.
3. Additionally, `PlayerSettingsService.getPublicPlayerConfig` lacked defensive error handling, failing with HTTP 500 if supplementary player settings encountered database query errors even though the underlying video and HLS streams were ready.

### 3. Implementation Details
1. Rebuilt the production Docker image with `docker compose build api`. Verified that `/app/dist/` in the new image contains 0 occurrences of `subscriptions`. Tagged `vedora-api:latest` and `services-api:latest`.
2. Hardened `services/src/modules/player-settings/player-settings.service.ts`:
   - Added `.onConflictDoNothing()` and race condition try/catch recovery in `getSettings(userId)`.
   - Added defensive fallback defaults in `getPublicPlayerConfig(videoId)` to ensure public playback config never fails even if database settings retrieval encounters errors.
3. Added regression unit test in `services/src/modules/player-settings/player-settings.service.spec.ts`.
4. Logged `BUG-015` in `docs/bug-fixes/BUG-015-stale-docker-image-player-settings-subscriptions-query-500.md` and indexed in `docs/bug-fixes/README.md`.

### 4. Verification Evidence
- `docker run --rm vedora-api:latest grep -r "subscriptions" /app/dist/`: Exited with code 1 (no occurrences).
- `npm --prefix services test -- player-settings.service.spec.ts`: 1 suite passed, 8 tests passed.
- `npm --prefix services test`: 18 suites passed, 161 tests passed.
- `git diff --check`: 0 whitespace errors.
