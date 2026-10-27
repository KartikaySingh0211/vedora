# ADR-011: Safe Modularity, Cross-Cutting Cache Keys, and Reusable Frontend Components

## Status
**Accepted** (Implemented in Safe Modularity Refactor - 2026-10-27)

## Context
As the Vedora platform grew across backend microservices and multiple Next.js dashboards, architectural duplication accrued across layers:
1. **Hardcoded Distributed Lock & Cache Keys**: Advisory lock keys (`vedora_storage_quota_${userId}`, `vedora_playlist_quota_${userId}`) and Redis buffer keys (`vedora:analytics:buffer`) were hardcoded as raw string literals across disparate service modules, creating a risk of key collision or typos during concurrent operations.
2. **Duplicated Utility & Parsing Logic**: User-Agent and referrer classification logic was duplicated inside `AnalyticsService`, while byte and duration formatters were ad-hoc in individual frontend pages.
3. **Frontend Component Duplication**: Dashboard pages (`my-videos`, `playlists`, `billing`, `branding`, `player`) contained copy-pasted breadcrumb navigation, heading blocks, loading spinners, error alerts, and empty-state placeholders.
4. **DTO & Schema Inference**: Drizzle models in `services/src/database/schema.ts` lacked exported canonical entity types (`Video`, `Playlist`, `ApiKey`), leading to inconsistent typing across service methods.

## Decision

1. **Centralized Backend Cache & Lock Key Registry (`CACHE_KEYS`)**:
   - Establish `services/src/common/cache-keys.ts` as the single source of truth for:
     - PostgreSQL transaction advisory lock keys (`storageQuotaLock(userId)`, `playlistQuotaLock(userId)`).
     - Redis pub/sub channels and analytics buffers.
     - BullMQ queue names and prefix constants.
2. **Pure Utility Modules with Isolated Unit Testing**:
   - Extract `services/src/utils/user-agent.util.ts` (`detectBrowser`, `detectDevice`, `cleanReferrer`).
   - Add unit test coverage in `services/src/utils/user-agent.util.spec.ts` (11 tests).
3. **Atomic Entity Serialization & Calculation**:
   - Consolidate Drizzle entity response formatting (`serializePlaylist`, `serializeVideo`).
   - Extract `calculateUserActiveStorageUsage(tx, userId)` in `VideoService` to deduplicate active quota calculations across reservation checks.
4. **Standardized Reusable Dashboard Components (`apps/main-dashboard/components/common`)**:
   - **`PageHeader`**: Unified breadcrumbs, title, descriptive subtitle, and action slots.
   - **`StatusBadge`**: Type-safe video status pills (`ready`, `processing`, `uploading`, `uploaded`, `failed`).
   - **`LoadingState`**: Uniform spinner card with accessible ARIA labeling.
   - **`ErrorState`**: Uniform alert card with optional retry callback.
   - **`EmptyState`**: Uniform empty state placeholder with contextual icon and call-to-action button.
5. **Centralized Frontend Formatters**:
   - Introduce `apps/main-dashboard/lib/formatters.ts` (`formatBytes`, `formatDuration`, `formatNumber`).
6. **Strict Backward Compatibility**:
   - Maintain `apps/main-dashboard/lib/utils/index.ts` re-exporting from `@/lib/utils` to prevent breaking existing UI imports.
   - Preserve existing route aliases (`/upload`, `/playlist`, `/videos`).

## Consequences

### Positive
- **Guaranteed Consistency**: Advisory locks and Redis queues cannot diverge between modules.
- **Enhanced Maintainability**: Reduced over 400 lines of repetitive UI and parsing boilerplate across pages.
- **Test Integrity**: Test coverage increased from 11 suites (79 tests) to 12 suites (91 tests) with 100% pass rate.
- **Zero Breakage**: No changes to API endpoints, database schemas, environment variables, or frontend styling behavior.

### Negative / Trade-offs
- Developers must import shared keys from `CACHE_KEYS` rather than defining ad-hoc string constants.
