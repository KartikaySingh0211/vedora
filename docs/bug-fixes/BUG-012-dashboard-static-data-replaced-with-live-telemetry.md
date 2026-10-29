# BUG-012: Home Dashboard Displayed Static Hardcoded Placeholder Stats

## Bug Metadata
- **ID**: BUG-012
- **Date**: 2026-10-29
- **Component**: Frontend / Main Dashboard & Analytics API
- **Severity**: Medium
- **Status**: Resolved

---

## 1. Symptoms & Problem Statement
When navigating to the root home page (`/`) of the Vedora dashboard (`apps/main-dashboard/app/page.tsx`), the interface displayed static placeholder data that did not reflect the authenticated user's actual assets:
- **Minutes Streamed**: Hardcoded to `129 / 1K` and `12.9%` with `871 mins remaining`.
- **Total Requests**: Hardcoded to `129` with `96 Avg / Day` and `+12% Growth`.
- **Storage Used**: Hardcoded to `3.2 GB / 5 GB Total` with `• 2 Videos • 1.8 GB Free`.
- **Top Visitor Countries**: `GeographicalMap` rendered static mock country records (e.g., USA: 50, India: 120, Chile: 21) independent of user video views.
- **Top Requested URLs**: Rendered static dummy paths (`/portfolio`, `/projects`, `/course/javascript`).

---

## 2. Root Cause Analysis (RCA)
1. **Frontend Hardcoding in Root Page**: While subpages (`/my-videos`, `/billing`, `/analytics`, `/player`) were previously integrated with TanStack Query and `fetchWithAuth`, `apps/main-dashboard/app/page.tsx` retained early prototype mock objects.
2. **Missing Analytics API Breakdown Fields**: `AnalyticsService.getMetrics` aggregated totals, devices, browsers, and daily timeseries, but did not aggregate geographic visitor countries (`countryBreakdown`) or request paths (`topReferrers`) from the `video_views` PostgreSQL table.
3. **Hardcoded Map Component**: `apps/main-dashboard/components/charts/geoMap.tsx` had an internal `countryData` constant and did not accept dynamic props.

---

## 3. Implementation Details

### A. Backend Analytics Aggregations & Schemas
1. **Extended DTOs (`services/src/modules/analytics/dto/analytics-response.dto.ts`)**:
   - Added `CountryBreakdownDto` (`country`, `visitors`).
   - Added `TopReferrerDto` (`pathname`, `requests`).
   - Added `countryBreakdown` and `topReferrers` to `MetricsResponseDto`.
2. **Aggregated Database Queries (`services/src/modules/analytics/analytics.service.ts`)**:
   - Queried `schema.video_views.country` with distinct viewer session counts.
   - Queried `schema.video_views.referrer` grouped by pathname.
3. **OpenAPI Specification**:
   - Regenerated `docs/openapi.json` and updated `docs/api-docs/SCHEMAS_AND_MODELS.md`.

### B. Dynamic Geographical Map (`apps/main-dashboard/components/charts/geoMap.tsx`)
- Updated `GeographicalMap` to accept `data?: GeoCountryData[]` and `isLoading?: boolean`.
- Added ISO-2 to full country name dictionary (`US` $\to$ `United States of America`, `IN` $\to$ `India`, etc.) for SVG map projection matching.
- Added graceful empty state indicator when no geographical traffic has been recorded yet.

### C. Live Dashboard Page (`apps/main-dashboard/app/page.tsx`)
- Integrated TanStack Query hooks:
  - `useQuery(["subscription"])`: Fetches active plan, allocated/used minutes, and storage cap.
  - `useQuery(["videos"])`: Dynamically computes total videos count and total active storage used (raw size + estimated transcoded size).
  - `useQuery(["analytics-metrics", "30d"])`: Fetches real-time total views, growth trend, country breakdown, and top requested URLs.
- Added skeleton loaders for card metrics during network fetches.
- Restored Getting Started onboarding cards when `videoCount === 0`.
- Handled empty states gracefully in the Top Requested URLs table.

---

## 4. Verification & Testing
1. **NestJS Test Suite**:
   ```bash
   npm --prefix services test
   ```
   *Result*: 17 test suites, 138 tests passed.
2. **Next.js Production Build**:
   ```bash
   npm --prefix apps/main-dashboard run build
   ```
   *Result*: Successfully compiled 16 routes with Next.js Turbopack and zero TypeScript errors.
3. **SDK Test Suite**:
   ```bash
   npm --prefix sdks/vedora-sdk test
   ```
   *Result*: 3 tests passed.

---

## 5. Prevention & Safeguards
- Replaced all prototype mock arrays with authoritative API calls.
- Maintained fallback defaults (e.g. 5 GiB storage cap, 1,000 playback minutes) if subscription or analytics records are newly provisioned.

