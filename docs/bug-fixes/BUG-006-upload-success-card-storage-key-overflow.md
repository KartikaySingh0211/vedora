# BUG-006: Video Upload Completion Card Storage Key Overflow

- **ID**: BUG-006
- **Date**: 2026-10-25
- **Component**: Frontend / Dashboard (`apps/main-dashboard/app/uploads/page.tsx`)
- **Severity**: Low (Visual UI overflow)
- **Status**: Resolved

---

## 1. Symptoms & Visual Bug

Upon successful video upload completion, the green success notification card displayed the storage key (`raw/<bucketId>/<timestamp>-<slug>.mp4`). The key string extended beyond the right boundary of the notification banner and overflowed into the dashboard background.

---

## 2. Root Cause Analysis

1. **CSS Grid Item Min-Width**:
   - The card used `grid grid-cols-1 sm:grid-cols-3`. In CSS Grid specifications, grid items default to `min-width: auto`. An unbroken text string (such as a UUID path) forces the grid column to expand to the natural width of the text, ignoring `truncate` unless `min-w-0` is explicitly applied to the grid item container.
2. **Viewport Crowding**:
   - Compressing `Video ID`, `Status`, and a long `Storage Key` across 3 equal columns allocated insufficient horizontal space for long cloud paths.

---

## 3. Implementation Details

- **File**: `apps/main-dashboard/app/uploads/page.tsx`
- **Replaced 3-Column Grid with Responsive Flex Layout**:
  - Left group: `Video ID` and `Status` badge.
  - Right group: Dedicated storage key badge container with `min-w-0`, `max-w-full md:max-w-md`, and `truncate`.
  - Added native `title={completedVideo.storageKey}` tooltip for hover inspection.
  - Added click-to-copy button with `toast` notification and interactive `Copy` / `Check` icon feedback.

---

## 4. Verification & Testing

- **Command**: `npx tsc --noEmit` in `apps/main-dashboard` -> Passed (0 errors).
- **Responsive Behavior**: Confirmed `min-w-0` and `truncate` strictly constrain text within the card boundary on all viewport sizes.
