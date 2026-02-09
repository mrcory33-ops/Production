# Performance Evidence

Date: 2026-02-09

## 1) Gantt Cell Loop Optimization

Code path:
- `components/CustomGanttTable.tsx`
  - Replaced per-cell `segments.some(...)` + full `segments.map(...)` scans with per-row `segmentsByStartCol` lookup.
  - Precomputed `dateColumnKeys` to avoid repeated `toISOString().split('T')[0]` in every cell.

Benchmark:
- Script: `docs/codex-audit/perf/custom-gantt-cell-bench.js`
- Command: `node docs/codex-audit/perf/custom-gantt-cell-bench.js`
- Results:
  - `old-loop: 38.30ms (checksum 495000)`
  - `new-loop: 18.63ms (checksum 495000)`

Measured gain:
- ~2.05x faster for the cell-segment lookup loop with identical checksum.

## 2) Daily Load Aggregation Lookup Optimization

Code path:
- `lib/analytics.ts` -> `calculateDailyLoads`
  - Removed per-iteration `Array.from(loadMap.keys()).find(...)` scan.
  - Switched to direct O(1) `Map.get(startOfDay(day).toISOString())`.

Benchmark:
- Script: `docs/codex-audit/perf/analytics-daily-load-bench.js`
- Command: `node docs/codex-audit/perf/analytics-daily-load-bench.js`
- Results:
  - `old-daily-loads: 647.73ms (checksum 8422060020)`
  - `new-daily-loads: 424.48ms (checksum 8422060020)`

Measured gain:
- ~1.53x faster on the benchmarked dataset with identical checksum.

## 3) Removed Dead/Unused Planning Render Work

Code path:
- `components/MasterSchedule.tsx`
  - Removed an unrendered JSX block that created elements during render but was never returned.
  - Removed an unused capacity-alert calculation effect that performed analytics work without any UI consumer.

Behavior impact:
- None intended; the removed values were not rendered or consumed.
- This trims main-thread work during planning re-renders and filter changes.
