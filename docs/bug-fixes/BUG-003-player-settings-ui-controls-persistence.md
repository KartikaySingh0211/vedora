# BUG-003: Player Settings 'Enabled UI Controls' Not Persisting to Database

- **ID**: BUG-003
- **Date**: 2026-10-24
- **Component**: Database, Backend API, Dashboard & Embed Player
- **Severity**: High (User configuration loss)
- **Status**: Resolved

---

## 1. Symptoms & Incident Description

When users customized the list of enabled UI controls (e.g. Play/Pause, 10s Forward, Fullscreen, Volume, Mute) on the Player Settings page (`/player`), changes were lost on page reload. Inspecting PostgreSQL revealed that no column existed in `player_settings` to store control preferences.

---

## 2. Root Cause Analysis

1. **Database Schema**: The `player_settings` table in `services/src/database/schema.ts` lacked an `enabled_controls` column.
2. **DTO & Controller**: `UpdatePlayerSettingsDto` did not define `enabledControls`, causing validation pipes to discard the attribute.
3. **Service Logic**: `PlayerSettingsService` did not persist or return `enabled_controls`.
4. **Dashboard Frontend**: In `apps/main-dashboard/app/player/page.tsx`, `enabledControls` was held in isolated local React state and was omitted from the `updateMutation` PUT payload.
5. **Embed Player**: In `apps/main-dashboard/app/embed/[videoid]/page.tsx`, controls were statically rendered without checking owner preferences.

---

## 3. Implementation Details

1. **Database Schema & Drizzle Migration**:
   - Added `enabled_controls: jsonb('enabled_controls').$type<string[]>().default([...]).notNull()` to `services/src/database/schema.ts`.
   - Generated migration `services/drizzle/0004_flimsy_blur.sql`:
     ```sql
     ALTER TABLE "player_settings" ADD COLUMN "enabled_controls" jsonb DEFAULT '["Play / Pause","10s Backward","10s Forward","Full Screen","Captions","Volume","Mute"]'::jsonb NOT NULL;
     ```
   - Applied cleanly to Neon PostgreSQL via `npm run db:migrate`.

2. **DTO & Service Mapping**:
   - Updated `UpdatePlayerSettingsDto` with `@IsArray()`, `@IsString({ each: true })`, `@IsOptional()`.
   - Updated `PlayerSettingsService.getSettings`, `updateSettings`, and `getPublicPlayerConfig` to persist and return `enabledControls`.
   - Updated test mocks in `player-settings.service.spec.ts`.

3. **Dashboard Frontend Synchronization**:
   - Updated `PlayerSettingsItem` in `apps/main-dashboard/lib/api-client.ts`.
   - In `apps/main-dashboard/app/player/page.tsx`, hydrated `enabledControls` state on query load and included it in the `updateMutation` body.

4. **Embed Player Conditional Rendering**:
   - In `apps/main-dashboard/app/embed/[videoid]/page.tsx`, added `isControlEnabled(name)` helper and wrapped player controls in conditional checks according to owner configuration.

---

## 4. Verification & Testing

- Direct SQL verification: Confirmed `enabled_controls (jsonb)` column exists on Neon PostgreSQL and row updates persist accurately.
- Backend tests: `npm test` in `services` passed (11/11 suites, 79/79 tests passed).
- Frontend typecheck: `npx tsc --noEmit` passed with 0 errors.
