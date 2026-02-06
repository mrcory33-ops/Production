# Codex Audit Report

Date: 2026-02-06

## P0 (Crashers / Data Loss / Security)
- None found during this pass.

## P1 (Correctness Issues)
1) **State mutation during render in PlanningBoard**
   - **File:** `components/PlanningBoard.tsx`
   - **Issue:** `displayJobs` used `filtered.sort(...)` where `filtered` referenced the `jobs` state array when `showSmallRocks` was true, mutating React state during render. This can cause unstable ordering and hard-to-debug side effects.
   - **Fix:** Create a copy of `jobs` before sorting (`filtered = [...jobs]`).
   - **Risk:** Low; preserves identical UI output while avoiding state mutation.
   - **Verification:** `npx tsc -p tsconfig.json --noEmit`, `npm run build`.

2) **Scoring weights persistence not loaded on startup (open)**
   - **Files:** `lib/scoringConfig.ts`, `components/ScoringConfigPanel.tsx`
   - **Issue:** `loadScoringWeights()` is never called; on reload, weights revert to defaults even if saved in Firebase/localStorage.
   - **Risk:** Medium correctness risk (user-configured weights not persisted across sessions).
   - **Status:** Not changed (would alter behavior timing; requires explicit approval to wire into app startup).
   - **Suggested fix:** Call `loadScoringWeights()` in a client bootstrap path (e.g., `PlanningBoard` mount) and update state with loaded weights.

## P2 (Performance Issues)
1) **Per-cell segment scanning in CustomGanttTable**
   - **File:** `components/CustomGanttTable.tsx`
   - **Issue:** Each cell scanned all segments (`segments.some` + `segments.map`) leading to O(cols * segments) work per row.
   - **Fix:** Precompute `segmentsByStartCol` per row and reuse precomputed `dateKeys`.
   - **Evidence:** `docs/codex-audit/PERF.md` (~2.2x faster loop, same checksum).
   - **Risk:** Low; output identical.

## Maintainability / Future-Risk Hotspots
- **Lint currently fails** with multiple pre-existing `no-explicit-any` and `no-unused-vars` errors across several files (see last `npm run lint` output). Not addressed in this pass due to scope; consider resolving to keep CI green.
- **Firestore scaling risk:** `syncJobsInput` reads all active jobs without a limit and uses `where in` queries. As job counts grow, reads could become expensive. Keep an eye on read costs and consider pagination or date-bounded queries if future requirements allow.

## Verification Steps
- Lint: `npm run lint` **fails** (pre-existing errors unrelated to changes).
- Typecheck: `npx tsc -p tsconfig.json --noEmit` (pass)
- Build: `npm run build` (pass)
- Perf bench: `node docs/codex-audit/perf/custom-gantt-cell-bench.js`
