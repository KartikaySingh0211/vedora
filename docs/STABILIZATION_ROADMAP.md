# Vedora Platform Stabilization & Hardening Roadmap

This document serves as the canonical engineering specification and execution plan for stabilizing, hardening, and verifying the **Vedora Video Infrastructure Platform**. It defines four sequential phases of work required to transition the codebase from rapid feature completion to a production-grade, hardened open-source media delivery system.

---

## Executive Overview & Architectural Context

Following the complete de-monetization of Vedora (ADR-010) and the elimination of unimplemented roadmap claims (such as Whisper AI subtitles), Vedora is positioned as a **100% open-source, self-hosted video infrastructure platform** with native Cloudflare R2 object storage, FFmpeg adaptive HLS ladder transcoding, and a resilient Redis-backed queue.

To ensure production viability, the platform requires systematic hardening:
1. **Security & Cryptographic Integrity**: Closing configuration fallbacks and verifying raw HTTP payloads for external webhooks.
2. **Elimination of Test Code from Production**: Removing unit test fallbacks, synthetic playlist generators, and defensive mock compatibility checks from runtime service logic.
3. **Automated CI/CD & Documentation Synchronization**: Enforcing test passes and build integrity on every pull request, and reconciling architectural terminology across the repository.
4. **Empirical Verification**: Establishing end-to-end synthetic pipelines that prove video ingestion, queue recovery, and HLS streaming without relying on static assertions.

---

## Execution Governance

| Phase | Title | Priority | Status | Target Area | Primary Dependencies |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Security and Reliability Fixes | **P0 (Immediate)** | `Completed` | Backend Services, Queue, Webhooks | None |
| **Phase 2** | Project Credibility & Documentation | **P1** | `Completed` | CI/CD, Documentation, Specifications | Phase 1 Completion |
| **Phase 3** | Demonstration and Verification | **P2** | `Not Started` | Integration Tests, Benchmarks, Media Assets | Phase 1 & 2 Completion |
| **Phase 4** | Architecture & Security Improvements | **P3** | `Not Started` | Worker Topologies, Throttling, Video DRM/Tokens | Phase 1, 2 & 3 Completion |

> [!IMPORTANT]
> **Phase 1 is the immediate and mandatory priority.** Phases 2, 3, and 4 must not be treated as complete simply because they are documented here. Each phase requires explicit empirical verification and code review before advancing to subsequent phases.

---

## Phase 1 — Security and Reliability Fixes

### Objective & Architectural Rationale
Eliminate security vulnerabilities, eliminate hardcoded secret fallbacks, and remove mock/test-specific branches embedded inside production services. Guarantee that video records never transition to `ready` unless all media assets have been genuinely transcoded and verified in storage.

- **Status**: `Completed`
- **Priority**: P0 (Immediate Priority)
- **Dependencies**: None

### Detailed Task Specifications

#### Task 1.1: Webhook Secret Fallback Elimination & Strict Configuration Validation
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder.service.ts` (`verifyWebhookSignature`)
  - `services/src/config/configuration.ts`
  - `services/src/modules/transcoder/transcoder.controller.ts`
- **Problem Statement**:
  In `transcoder.service.ts` (lines 553–556), `verifyWebhookSignature()` falls back to a hardcoded string if neither `transcoder.webhookSecret` nor `apiKeyDigestSecret` is provided:
  ```typescript
  const webhookSecret =
    this.configService.get<string>('transcoder.webhookSecret') ||
    this.configService.get<string>('apiKeyDigestSecret') ||
    'vedora_transcoder_default_secret_32bytes!';
  ```
  If `TRANSCODER_WEBHOOK_SECRET` is unset in production, an attacker who knows this default string can forge valid HMAC signatures and maliciously transition video records to `ready` or `failed`.
- **Planned Implementation**:
  1. Remove the `'vedora_transcoder_default_secret_32bytes!'` string and the fallback to `apiKeyDigestSecret` (which conflates API key caching keys with webhook authentication).
  2. Require `TRANSCODER_WEBHOOK_SECRET` to be explicitly defined when the transcoder module initializes.
  3. Throw a `ServiceUnavailableException` or fast-fail startup if webhook endpoints are enabled without a dedicated, cryptographically strong secret ($\ge 32$ bytes).

#### Task 1.2: Raw Body Webhook Signature Verification
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder.controller.ts` (`handleWebhook`)
  - `services/src/main.ts`
- **Problem Statement**:
  In `transcoder.controller.ts` (lines 74–79), incoming webhooks are validated by re-stringifying the parsed DTO:
  ```typescript
  const rawPayload = JSON.stringify(dto);
  return await this.transcoderService.handleWebhook(signature, rawPayload, dto);
  ```
  `JSON.stringify(dto)` does not preserve exact key order, whitespace, or Unicode escaping present in the incoming HTTP request stream. Legitimate webhooks from standard external workers (such as AWS MediaConvert or custom transcode fleets) will fail verification, or subtle payload alterations could bypass validation.
- **Planned Implementation**:
  1. Enable `rawBody: true` in NestJS application bootstrap (`services/src/main.ts`).
  2. Inject the exact `req.rawBody` buffer into `handleWebhook()` using a custom decorator `@RawBody()` or standard NestJS raw body access.
  3. Verify the `x-transcoder-signature` HMAC-SHA256 against the unparsed byte buffer before performing any JSON deserialization or DTO validation.

#### Task 1.3: Unsafe Production Mock/Test Fallbacks Removal
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder.service.ts` (`processJob`)
- **Problem Statement**:
  In `transcoder.service.ts` (lines 328–400), `processJob()` contains a 70+ line synthetic fallback branch labeled `// 5. Fallback for mock unit test suites without FfmpegService:`. If `this.ffmpegService` is absent or bypassed, the service synthesizes dummy `.m3u8` playlists in-memory, uploads placeholder text files, and sets the video status to `ready`.
  Having test-specific mock branches in production code violates defense-in-depth and creates the risk that corrupted or missing video files are marked `ready` with empty manifests.
- **Planned Implementation**:
  1. Make `FfmpegService` a mandatory injected dependency in `TranscoderService`.
  2. Completely delete the fallback block (lines 328–400).
  3. If video probing or transcode execution fails, the job must throw an error, trigger the retry/recovery mechanism, and mark the video `failed` if retries are exhausted.
  4. Update `transcoder.service.spec.ts` to supply a Jest mock of `FfmpegService` via NestJS dependency injection rather than relying on production code branching.

#### Task 1.4: Elimination of Mock-Specific Redis Runtime Hacks
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder.service.ts`
  - `services/src/infra/redis/redis.service.ts`
  - `services/src/modules/transcoder/transcoder.service.spec.ts`
- **Problem Statement**:
  Throughout `transcoder.service.ts` (e.g. lines 102, 108, 122, 140, 168, 184, 210, 418, 613, 693), defensive runtime checks check whether methods exist on `this.redisService`:
  ```typescript
  if (typeof this.redisService.rpoplpush === 'function') { ... }
  if (!rawJob && typeof this.redisService.lpop === 'function') { ... }
  if (typeof this.redisService.lrem === 'function') { ... }
  ```
  These checks were added to prevent tests with incomplete mock objects from throwing `TypeError`. In production, this obscures failures when Redis methods fail to execute and compromises queue delivery guarantees.
- **Planned Implementation**:
  1. Define a strict TypeScript interface `IRedisService` matching all queue, hash, and lock operations.
  2. Implement a dedicated test double / in-memory fake (`MockRedisService`) implementing the complete interface for use in unit tests.
  3. Remove all `typeof this.redisService.<method> === 'function'` runtime guards from production service code.

#### Task 1.5: Atomic State Machine & Transcoding Error Propagation
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder.service.ts`
  - `services/src/modules/transcoder/ffmpeg.service.ts`
- **Problem Statement**:
  If an individual variant rendition fails or an S3/R2 direct upload throws a network exception after partial files have been written, temporary files on disk may remain uncollected and video records could remain trapped in `processing` indefinitely.
- **Planned Implementation**:
  1. Wrap the entire transcode-upload-finalize sequence in a `try...catch...finally` block.
  2. Ensure the working temporary directory (`/tmp/vedora-transcode-...`) is unconditionally purged in `finally`.
  3. Record detailed, sanitized error diagnostics (`sanitizedErrorMessage`) in `video.status_message` when marking a video `failed`.

#### Task 1.6: Webhook & Transcode Completion Regression Test Suite
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder-webhook.spec.ts` (New test suite)
  - `services/src/modules/transcoder/transcoder-e2e.spec.ts`
- **Planned Implementation**:
  1. Add tests asserting that webhooks signed with mismatched secrets, malformed headers, or modified bodies return HTTP 401 Unauthorized.
  2. Add tests asserting that missing `TRANSCODER_WEBHOOK_SECRET` fails fast.
  3. Verify that non-zero FFmpeg exits or failed object storage uploads transition video status to `failed` and release Redis processing locks.

### Acceptance Criteria for Phase 1
- [x] No hardcoded fallback secrets exist in `transcoder.service.ts` or any configuration file.
- [x] Webhook HMAC-SHA256 signature verification validates against the exact incoming raw body buffer.
- [x] Production `TranscoderService` contains zero mock unit test branches or synthetic playlist generation fallbacks.
- [x] Zero `typeof this.redisService.X === 'function'` runtime checks exist in production code.
- [x] All unit and integration test suites pass (`npm --prefix services test`).

---

## Phase 2 — Project Credibility and Documentation

### Objective & Architectural Rationale
Ensure the open-source repository reflects genuine, verifiable system capabilities. Reconcile stale terminology, align bug ledgers, eliminate legacy references to retired architectures (BullMQ, OneMinuteCloud), and establish automated CI workflows so code quality is continuously enforced.

- **Status**: `Completed`
- **Priority**: P1
- **Dependencies**: Phase 1 Completion

### Detailed Task Specifications

#### Task 2.1: Automated GitHub Actions CI/CD Workflows
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `.github/workflows/ci.yml` (New workflow file)
  - `.github/workflows/docker-build.yml` (New workflow file)
- **Problem Statement**:
  While comprehensive test suites exist across workspaces, they are currently executed manually. Without an automated continuous integration pipeline, regressions in TypeScript compilation, linting, or unit tests can go unnoticed.
- **Planned Implementation**:
  1. Create `.github/workflows/ci.yml` matrix runner:
     - Backend tests (`npm --prefix services test`) with Node 20 & 22.
     - Backend build (`npm --prefix services run build`).
     - TypeScript SDK build & tests (`npm --prefix sdks/vedora-sdk test`).
     - Next.js Main Dashboard build (`npm --prefix apps/main-dashboard run build`).
     - Next.js Landing Page build (`npm --prefix apps/landing-page run build`).
  2. Configure Docker build verification workflow to ensure container images build cleanly without caching errors.

#### Task 2.2: Stale Documentation, README Claims, and Terminology Audit
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `README.md`
  - `services/src/modules/transcoder/transcoder.controller.ts` (Swagger annotation line 90 referencing BullMQ)
  - `docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`
- **Problem Statement**:
  - In `transcoder.controller.ts` line 90, Swagger annotations state: `Submits an asynchronous HLS transcoding job to the BullMQ transcode queue`. BullMQ was retired in favor of the custom atomic Redis `RPOPLPUSH` queue.
  - In `ARCHITECTURE_AND_SYSTEM_DESIGN.md` line 3, Vedora is described as a "SaaS Platform" rather than an open-source video infrastructure platform.
  - Test count badges and walkthrough commands in `README.md` must remain in lockstep with actual execution outputs.
- **Planned Implementation**:
  1. Purge all residual mentions of BullMQ from Swagger decorators and code docstrings.
  2. Align all references in `README.md` and architecture blueprints with Vedora's 100% open-source, non-SaaS positioning.
  3. Validate that every badge and command in `README.md` can be run cleanly from a fresh checkout.

#### Task 2.3: Centralized Bug Ledger & Incident Index Reconciliation
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `docs/bug-fixes/README.md`
  - `docs/bug-fixes/BUG-014-*.md`
- **Planned Implementation**:
  1. Audit `docs/bug-fixes/README.md` to ensure all 14 resolved bug incident records are indexed with consistent severity, timestamps, and cross-links.
  2. Ensure the bug logging standard is strictly maintained for any new fixes in Phase 1.

#### Task 2.4: Open-Source Video Infrastructure Positioning
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `README.md`
  - `docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`
  - `apps/landing-page/app/page.tsx`
- **Planned Implementation**:
  1. Clearly emphasize Vedora's role as a self-hostable, developer-first video pipeline (similar to self-hosted Mux or Cloudflare Stream alternative).
  2. Document the zero-egress benefits of Cloudflare R2 object storage coupled with local storage fallback for offline development.

### Acceptance Criteria for Phase 2
- [x] GitHub Actions CI workflow runs automatically on PRs and pushes to `main`, executing all test suites and builds.
- [x] Zero references to BullMQ or OneMinuteCloud remain in active code, docstrings, or Swagger descriptions.
- [x] All architectural documentation and README files describe Vedora as an open-source platform.
- [x] All bug fix records in `docs/bug-fixes/` are indexed and up to date.

---

## Phase 3 — Demonstration and Verification

### Objective & Architectural Rationale
Provide reproducible, empirical proof that the platform works as claimed under real-world conditions. Build end-to-end integration tests using synthetic media, create walkthrough demonstrations, and publish genuine benchmark measurements.

- **Status**: `Not Started`
- **Priority**: P2
- **Dependencies**: Phase 1 & 2 Completion

### Detailed Task Specifications

#### Task 3.1: Complete and Publish End-to-End Walkthrough Demonstration
- **Classification**: **Investigation Required**
- **Affected Files**:
  - `docs/assets/demo/`
  - `README.md` (Walkthrough section)
- **Problem Statement**:
  Users and evaluators need clear visual and programmatic evidence of the complete lifecycle: direct presigned multipart upload $\to$ background queue processing $\to$ multi-resolution HLS packaging in Cloudflare R2 $\to$ responsive video player playback.
- **Planned Implementation**:
  1. Execute a complete live verification cycle against a local stack with Cloudflare R2 (or local storage fallback).
  2. Capture screenshots and/or video recordings of:
     - Dashboard upload studio progress.
     - Background worker logs showing FFmpeg probe and variant playlist generation.
     - Cloudflare R2 bucket containing `master.m3u8`, variant playlists (`720p.m3u8`, `480p.m3u8`), and `.ts` media segments.
     - Browser playback in `<VedoraPlayer />` switching renditions seamlessly.
  3. Publish structured evidence in `docs/assets/demo/` and link from `README.md`.

#### Task 3.2: Automated Synthetic Video End-to-End Test Suite
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/modules/transcoder/transcoder-live-e2e.spec.ts` (New test file)
- **Problem Statement**:
  Existing E2E tests mock parts of the storage layer or media files. A fully automated test generating synthetic video in-memory (using FFmpeg `testsrc` and `sine` audio filters) will verify the complete real pipeline without external video dependencies.
- **Planned Implementation**:
  1. Generate a 2-second 640x360 test video with real audio track using local FFmpeg binaries during test setup.
  2. Run the test video through the complete ingestion pipeline:
     - Storage initialization.
     - Redis queue job dispatch (`RPOPLPUSH`).
     - Worker media probe (`ffprobe`).
     - Variant transcoding and HLS playlist generation (`ffmpeg`).
     - Master manifest assembly and storage persistence.
  3. Assert that all output `.m3u8` and `.ts` files exist on disk/storage, are non-empty, and contain valid HLS tags (`#EXT-X-VERSION`, `#EXTINF`).

#### Task 3.3: Canonical Technical Deep-Dives
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`
  - `docs/ENGINEERING_LOG.md`
- **Planned Implementation**:
  Document detailed technical explanations with sequence diagrams for:
  1. **Redis Crash Recovery**: Atomic `RPOPLPUSH` from `vedora:transcode:queue` to `vedora:transcode:processing`, heartbeat lease renewal, and `recoverStuckJobs` sweeper.
  2. **Storage Quota Enforcement**: Atomic PostgreSQL transaction-level advisory locks (`pg_advisory_xact_lock(hashtext('user_quota_' || user_id))`) preventing race-condition overages.
  3. **3-Tier API Key Cache**: Level 1 (LRU, 60s), Level 2 (Redis HMAC digest, 5m), Level 3 (PostgreSQL Argon2id hash) with immediate cache eviction upon revocation.

#### Task 3.4: Empirical Performance Benchmarks
- **Classification**: **Investigation Required**
- **Affected Files**:
  - `docs/BENCHMARKS.md` (New documentation file)
- **Planned Implementation**:
  1. Benchmark transcoding performance across standardized test clips (1080p 30s, 720p 60s) measuring real CPU/memory utilization, transcode speed factor (e.g. `2.5x`), and chunk upload throughput.
  2. Record measurements only with explicit hardware specifications and environment details. No speculative or estimated benchmarks will be published.

### Acceptance Criteria for Phase 3
- [ ] An automated test executes real FFmpeg transcoding on synthetic media from input to playable HLS files with zero mocked video filters.
- [ ] Demonstration assets showing upload, Cloudflare R2 bucket objects, and dashboard playback are documented in `README.md`.
- [ ] Technical deep-dives for queue recovery, advisory lock quotas, and cache invalidation are complete with Mermaid diagrams.
- [ ] All published benchmarks reflect genuinely measured execution metrics.

---

## Phase 4 — Architecture and Security Improvements

### Objective & Architectural Rationale
Evaluate and implement higher-level architectural optimizations to ensure enterprise scalability, process isolation, API protection, and streaming security.

- **Status**: `Not Started`
- **Priority**: P3
- **Dependencies**: Phase 1, 2 & 3 Completion

### Detailed Task Specifications

#### Task 4.1: Worker Process Decoupling Evaluation
- **Classification**: **Investigation Required**
- **Affected Files**:
  - `docker-compose.yml`
  - `services/src/worker.ts` (Evaluated)
- **Investigation Scope**:
  Currently, `TranscoderService` runs inside the same NestJS process that serves HTTP requests. Under heavy video encoding load, CPU-intensive FFmpeg child processes can starve the Node.js event loop, causing API latency spikes or health check timeouts.
- **Trade-Off Analysis**:
  - *Option A (Monolithic Worker)*: Simple deployment, lower memory footprint, single Node process.
  - *Option B (Dedicated Worker Container)*: Complete CPU/memory isolation, independent horizontal scaling of encoding workers (`docker compose scale vedora-worker=3`), prevents worker crashes from impacting the HTTP API gateway.
- **Expected Outcome**:
  Author an Architecture Decision Record (`docs/decisions/ADR-012-transcoder-worker-process-isolation.md`) and, if approved, configure a distinct worker entrypoint and Docker Compose service.

#### Task 4.2: Production Rate Limiting & HTTP Security Headers
- **Classification**: **Confirmed Finding**
- **Affected Files**:
  - `services/src/app.module.ts`
  - `services/src/main.ts`
- **Problem Statement**:
  Public endpoints (such as `POST /api/v1/videos/init` and telemetry pings) currently lack strict rate limiting. While abuse-prevention quotas exist for user accounts, unauthenticated or malicious bursts could cause resource exhaustion.
- **Planned Implementation**:
  1. Integrate `@nestjs/throttler` with Redis storage provider to enforce distributed rate limits (e.g., 60 requests/minute for video init; 300 requests/minute for telemetry pings).
  2. Configure `helmet` in `main.ts` with strict Content Security Policy (CSP), HTTP Strict Transport Security (HSTS), and `X-Frame-Options` headers.

#### Task 4.3: Signed URLs and Private Video Access Architecture
- **Classification**: **Investigation Required**
- **Affected Files**:
  - `services/src/modules/videos/`
  - `services/src/infra/storage/`
- **Investigation Scope**:
  Currently, all ready videos generate publicly accessible HLS manifest keys. For proprietary or internal video platforms, access to master manifests and `.ts` media segments must be restricted to authorized users.
- **Planned Implementation**:
  1. Evaluate token-authenticated stream URLs (e.g. `master.m3u8?token=<hmac_token>&expires=<timestamp>`).
  2. Assess Cloudflare R2 Presigned URLs vs Cloudflare Token Authentication / Worker proxies for segmented HLS delivery.
  3. Draft an ADR detailing access control models, edge token validation, and performance trade-offs.

#### Task 4.4: FFmpeg Encoding Presets, Profile/Level Tuning, and HLS Codec Strings
- **Classification**: **Investigation Required**
- **Affected Files**:
  - `services/src/modules/transcoder/ffmpeg.service.ts`
- **Investigation Scope**:
  Ensure all generated HLS streams maximize cross-platform browser compatibility (Chrome, Safari, Firefox, iOS, Android).
- **Planned Implementation**:
  1. Verify H.264 profiles (`-profile:v high -level 4.1` for 1080p; `-profile:v main -level 3.1` for 720p/480p).
  2. Standardize GOP sizes (`-g 60 -keyint_min 60 -sc_threshold 0`) to align video keyframes exactly with 2-second or 6-second HLS segment boundaries.
  3. Ensure `#EXT-X-STREAM-INF` playlist metadata specifies correct `CODECS="avc1.640028,mp4a.40.2"` strings to avoid playback initialization delays in mobile Safari.

### Acceptance Criteria for Phase 4
- [ ] ADR published evaluating standalone worker process decoupling.
- [ ] Production API rate limiting configured via `@nestjs/throttler` backed by Redis.
- [ ] Helmet security headers active and verified via HTTP response header inspection.
- [ ] Technical access-control specification established for private video streaming.
- [ ] FFmpeg encoding profiles, keyframe intervals, and RFC 8216 codec declarations validated across major browser rendering engines.

---

## Verification & Tracking Ledger

As implementation progresses through each phase, update this ledger with dates, commit hashes, and verification outputs:

```markdown
| Phase | Task | Status | Completion Date | Commit Hash | Verified By |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Phase 1 | 1.1 Webhook Secret Validation | Completed | 2026-10-30 | f81d680 | Jest Suite (19 passed) |
| Phase 1 | 1.2 Raw Body Signature Verification | Completed | 2026-10-30 | f81d680 | Jest Suite (19 passed) |
| Phase 1 | 1.3 Remove Production Mock Fallbacks | Completed | 2026-10-30 | f81d680 | Jest Suite (19 passed) |
| Phase 1 | 1.4 Eliminate Redis Mock Hacks | Completed | 2026-10-30 | f81d680 | Jest Suite (19 passed) |
| Phase 1 | 1.5 Transcoder Error Propagation | Completed | 2026-10-30 | f81d680 | Jest Suite (19 passed) |
| Phase 1 | 1.6 Webhook Regression Tests | Completed | 2026-10-30 | f81d680 | Jest Suite (158 passed across 17 suites) |
| Phase 2 | 2.1 GitHub Actions CI Pipeline | Completed | 2026-10-30 | Working Tree | .github/workflows/ci.yml validated |
| Phase 2 | 2.2 Reconcile Stale Documentation | Completed | 2026-10-30 | Working Tree | Audit confirmed & updated |
| Phase 2 | 2.3 Bug Ledger Synchronization | Completed | 2026-10-30 | Working Tree | 14/14 incidents indexed in README & ledger |
| Phase 2 | 2.4 Open-Source Positioning | Completed | 2026-10-30 | Working Tree | README, landing, and architecture aligned |
| Phase 3 | 3.1 Walkthrough Demo & Media | Not Started | — | — | — |
| Phase 3 | 3.2 Synthetic Video E2E Test Suite | Not Started | — | — | — |
| Phase 3 | 3.3 Architecture Deep-Dives | Not Started | — | — | — |
| Phase 3 | 3.4 Measured Benchmarks | Not Started | — | — | — |
| Phase 4 | 4.1 Worker Decoupling Evaluation | Not Started | — | — | — |
| Phase 4 | 4.2 Throttling & Security Headers | Not Started | — | — | — |
| Phase 4 | 4.3 Signed URLs & Private Videos | Not Started | — | — | — |
| Phase 4 | 4.4 FFmpeg Profiles & HLS Codecs | Not Started | — | — | — |
```
