# Vedora — Bug Fixes & Incident Log

This directory serves as the centralized, immutable engineering ledger for all bugs, regressions, configuration failures, and upstream provider anomalies identified and resolved in the Vedora codebase.

---

## Bug Log Index

| ID | Date | Component | Severity | Description | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [BUG-001](./BUG-001-transcoder-module-di-missing-api-key-module.md) | 2026-10-24 | Backend / Transcoder | Critical | NestJS DI dependency resolution failure during server startup | Resolved |
| [BUG-002](./BUG-002-redis-noauth-password-mismatch.md) | 2026-10-24 | Infra / Redis | High | Redis connection authentication rejection (`NOAUTH HELLO`) | Resolved |
| [BUG-003](./BUG-003-player-settings-ui-controls-persistence.md) | 2026-10-24 | Database & Frontend | High | Player settings 'Enabled UI Controls' not persisting to database | Resolved |
| [BUG-004](./BUG-004-oneminute-cloud-upload-initiate-502.md) | 2026-10-24 | Backend / Storage | Critical | Direct-to-cloud video upload initiate throwing 500/502 Bad Gateway | Resolved |
| [BUG-005](./BUG-005-swagger-path-to-regexp-wildcard-syntax.md) | 2026-10-25 | Backend / Swagger | Critical | NestJS Swagger bootstrap failure due to path-to-regexp wildcard syntax | Resolved |
| [BUG-006](./BUG-006-upload-success-card-storage-key-overflow.md) | 2026-10-25 | Frontend / Dashboard | Low | Video upload completion card storage key text overflow | Resolved |
| [BUG-007](./BUG-007-player-stream-url-fallback-and-embed-player.md) | 2026-10-25 | Fullstack / Player | Medium | Missing stream URL fallback & incomplete embed video player architecture | Resolved |
| [BUG-008](./BUG-008-embed-player-infinite-buffering-dns-resolution.md) | 2026-10-25 | Fullstack / Storage & Player | High | Embed video player infinite buffering & invalid storage domain DNS failure | Resolved |
| [BUG-009](./BUG-009-mock-upload-disk-persistence-and-hls-redirect-mismatch.md) | 2026-10-25 | Fullstack / Storage | High | Discarded mock upload payloads & unexpected 10-minute video playback | Resolved |
| [BUG-010](./BUG-010-oneminute-bucket-zero-files-and-fallback-flower-video.md) | 2026-10-25 | Storage / Embed Player / SDK | High | OneMinute Cloud bucket zero files & fallback flower video playback | Resolved |
| [BUG-011](./BUG-011-cloudflare-r2-cors-and-non-blocking-upload-queue.md) | 2026-10-28 | Storage / Cloudflare R2 / Frontend | High | Cloudflare R2 presigned multipart PUT CORS preflight rejection & blocking modal upload UX | Resolved |
| [BUG-012](./BUG-012-dashboard-static-data-replaced-with-live-telemetry.md) | 2026-10-29 | Frontend / Dashboard & Analytics | Medium | Home dashboard page displayed static hardcoded placeholder stats instead of live user data | Resolved |
| [BUG-013](./BUG-013-production-readiness-audit-remediation.md) | 2026-10-29 | Storage / Transcoder / Queue / Driver / Auth | High | Production audit remediation: R2 errors, CORS, FFmpeg portrait scaling, queue recovery, dual DB drivers | Resolved |

---

## Bug Fix Documentation Standard

Every bug fix entry in this directory MUST follow this structure:

1. **Bug Metadata**: ID, Date, Author, Component, Severity, Resolution Status.
2. **Symptoms & Error Logs**: Verbatim terminal output, exception stack traces, or UI error messages.
3. **Root Cause Analysis (RCA)**: Deep technical explanation of why the failure occurred.
4. **Implementation & Fix Details**: Specific code changes across files, schemas, and configurations.
5. **Verification & Testing**: Commands executed and evidence confirming resolution.
6. **Prevention & Safeguards**: Architectural safeguards to prevent recurrence.
