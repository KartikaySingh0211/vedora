# BUG-015: Stale Docker Container Image & Player Settings Subscriptions Query 500

## Bug Metadata
- **ID**: `BUG-015`
- **Date**: 2026-10-30
- **Component**: Backend / Player Settings & Docker Runtime
- **Severity**: High
- **Resolution Status**: Resolved

---

## 1. Symptoms & Error Logs

When opening the Embed Player modal or attempting video playback on `/my-videos` for newly uploaded and successfully transcoded videos (e.g. `178060d7-da70-4be3-add5-37eae3621a30` and `5fda0f64-50cb-43e5-a8f5-eee9b2a602ad`), the frontend modal displayed:
```text
Playback Status
Video not found or unavailable (HTTP 500)
```
The browser DevTools Network tab recorded:
```http
GET http://localhost:8080/api/v1/player-settings/public/178060d7-da70-4be3-add5-37eae3621a30 500 Internal Server Error
```
The backend container logs emitted the following verbatim error:
```text
[Nest] 1 - 10/30/2026, 2:32:56 PM ERROR [AllExceptionsFilter] [GET] /api/v1/player-settings/public/5fda0f64-50cb-43e5-a8f5-eee9b2a602ad - Status: 500 - Client: 172.19.0.1 - Error: Failed query: select "id", "user_id", "stripe_customer_id", "stripe_subscription_id", "plan", "status", "allocated_minutes", "used_minutes", "current_period_start", "current_period_end", "updated_at" from "subscriptions" where "subscriptions"."user_id" = $1 limit $2
params: user_3IutBTNYQmmuP2obDKlp6UF3xkY,1
```

---

## 2. Root Cause Analysis (RCA)

1. **Stale Docker Container Image**:
   Inspection of `docker inspect` revealed that the running container image (`vedora-api:latest`) was created on `2026-10-28T18:44:09Z`.
   On `2026-10-30`, commit `d0e69c5a` de-monetized the codebase and removed subscription billing:
   - Migration `0005_bouncy_boomerang.sql` executed `DROP TABLE "subscriptions" CASCADE;` against the Neon PostgreSQL database.
   - The TypeScript source code in `services/src/modules/player-settings/player-settings.service.ts` was refactored to remove all queries against `schema.subscriptions`.
   - However, standard `docker compose up -d` does not rebuild an existing image unless `--build` is explicitly passed. Consequently, the container running in Docker was executing stale pre-Oct 30 JavaScript binaries (`/app/dist/modules/player-settings/player-settings.service.js`) containing legacy queries to the dropped `subscriptions` table.
2. **Missing Resilience & Error Handling in Public Endpoint**:
   The `getPublicPlayerConfig` endpoint in `PlayerSettingsService` previously depended on `getSettings(video.user_id)` without defensive fallback defaults or race condition handling (`.onConflictDoNothing()`). If any database write or transient error occurred while fetching player settings, the entire public video playback config endpoint failed with HTTP 500 even when the underlying video and HLS master manifest existed and were ready in Cloudflare R2.

---

## 3. Implementation Details

1. **Docker Container Image Rebuild**:
   - Rebuilt the production NestJS Docker image using `docker compose build api`.
   - Verified that `/app/dist/` in the freshly built image has 0 occurrences of `subscriptions`:
     ```bash
     docker run --rm vedora-api:latest grep -r "subscriptions" /app/dist/  # exits with code 1 (no matches)
     ```
   - Synchronized tags: tagged `vedora-api:latest` to `services-api:latest`.
2. **Defensive Player Settings Hardening (`services/src/modules/player-settings/player-settings.service.ts`)**:
   - Added `.onConflictDoNothing()` and race condition try/catch recovery in `getSettings(userId)` to ensure concurrent initialization requests for the same user do not throw constraint errors.
   - Wrapped player settings retrieval in `getPublicPlayerConfig(videoId)` with a try/catch and fallback defaults. If settings cannot be loaded from the database, the service falls back to default open-source player configurations (primary color `#2563eb`, default controls, and `"Powered by Vedora"` text) without failing video playback.
3. **Regression Test Suite (`services/src/modules/player-settings/player-settings.service.spec.ts`)**:
   - Added unit test: `should return resilient default player configuration if database settings retrieval fails` verifying that public player config succeeds and returns default UI configuration even on simulated database query failure.

---

## 4. Verification & Testing Evidence

- **Unit Tests**:
  ```bash
  npm --prefix services test -- player-settings.service.spec.ts
  ```
  Result: 1 suite passed, 8 tests passed.
- **Full Backend Suite**:
  ```bash
  npm --prefix services test
  ```
  Result: 18 test suites passed, 161 tests passed.
- **Container Verification**:
  ```bash
  docker run --rm vedora-api:latest grep -r "subscriptions" /app/dist/
  ```
  Result: Exit code 1 (no occurrences of `subscriptions`).

---

## 5. Prevention & Safeguards

- Always instruct `docker compose up -d --build` in documentation and deployment instructions so that changes in local source code or database migrations are immediately compiled into the running container image.
- Public read endpoints (such as embed video players) should never fail outright if supplementary customization records fail to load; always provide sensible default fallbacks.
