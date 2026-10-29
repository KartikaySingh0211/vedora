# BUG-014: Dashboard Top Requested URLs Table Vertical Misalignment

## Bug Metadata
- **ID**: `BUG-014`
- **Date**: 2026-10-30
- **Component**: Frontend / Main Dashboard
- **Severity**: Medium
- **Resolution Status**: Resolved

---

## 1. Symptoms & Error Logs
On the home dashboard page (`apps/main-dashboard/app/page.tsx`), the **Top Requested URLs** table exhibited severe vertical misalignment in browser rendering:
- The pathname element (e.g. `[L] localhost`) snapped to the top of the table container.
- The rank indicator (`🥇`) and the requests counter (`1`) were positioned far lower in the vertical center/bottom of the row.
- The single data row stretched vertically across the entire card, leaving large gaps of unbalanced empty space.

---

## 2. Root Cause Analysis (RCA)
1. **Invalid Direct Flex on Table Cell**: The table cell for pathname was styled as `<td className="... flex items-center gap-2">`. Setting `display: flex` directly on a `<td>` overrides the browser's native `display: table-cell`. This removes the element from table row vertical alignment rules, causing the flex container to snap to the top of the `<tr>`.
2. **Artificial Table Height Inflation**: The `<table>` element was assigned `min-h-75` (`min-height: 18.75rem / 300px`). In HTML table layout algorithms, if a table has a forced minimum height and only one row, that single row is stretched to occupy the entire height ($\approx 250\text{px}$). Standard table cells (`#` and `REQUESTS`) vertically centered at $\approx 125\text{px}$, while the `flex` cell stayed at $0\text{px}$.
3. **Parent Flex Alignment**: The parent container used `flex items-center flex-wrap` with hard percentage widths (`md:w-[60%]` and `md:w-[40%]`), which caused uneven vertical alignment against the adjacent **Top Visitor Countries** map card.

---

## 3. Implementation Details
1. **Table Cell Geometry (`apps/main-dashboard/app/page.tsx`)**:
   - Preserved `<td>` as a native table cell with vertical centering (`align-middle`).
   - Nested a dedicated inner `<div className="flex items-center gap-2.5 min-w-0">` for the initial badge and pathname string:
     ```tsx
     <td className="px-4 py-3.5 align-middle">
       <div className="flex items-center gap-2.5 min-w-0">
         <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 ...">
           {row.pathname.charAt(0) === "/" ? row.pathname.charAt(1)?.toUpperCase() || "/" : row.pathname.charAt(0).toUpperCase()}
         </div>
         <span className="truncate max-w-[220px] font-medium ..." title={row.pathname}>
           {row.pathname}
         </span>
       </div>
     </td>
     ```
2. **Removed Stretched Table Height**:
   - Removed `min-h-75` from `<table>`. Table rows now maintain natural compact padding (`py-3.5`).
3. **Responsive Grid & Unified Cards**:
   - Replaced fragile percentage widths with a clean responsive grid: `grid grid-cols-1 lg:grid-cols-12 gap-8 items-start` (`lg:col-span-7` for the map and `lg:col-span-5` for the table).
   - Wrapped both cards in uniform border and dark-mode styling (`rounded-xl border border-gray-200 dark:border-[#1f2023] bg-white dark:bg-[#101217] shadow-sm overflow-hidden`).

---

## 4. Verification & Testing Evidence
- `npm --prefix apps/main-dashboard run build`: Turbopack compiled and prerendered all 15 routes with zero TypeScript errors.
- Verified visual alignment: Rank icon, pathname badge, and request count sit on the identical horizontal centerline.

---

## 5. Prevention & Safeguards
- Never apply `display: flex` or `display: grid` directly to `<td>` or `<th>` elements; always use an internal wrapper `<div>`.
- Avoid setting `min-height` on `<table>` elements. Place dimension constraints on container `<div>` wrappers instead.
