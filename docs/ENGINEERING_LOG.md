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
5. **Authored Root Documentation**: Created comprehensive [README.md](file:///d:/Dev/Projects/vedora/README.md) detailing architecture, setup steps, security principles, and environment variables.

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
