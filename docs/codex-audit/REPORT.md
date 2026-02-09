# Codex Audit Report

Date: 2026-02-09

## P0 — Crashers / Data Loss / Security Risks

1. Firestore security rules are fully open
- File: `firestore.rules:4`
- Risk: any client with project access can read/write all documents.
- Evidence: `allow read, write: if true;`
- Fix summary: not changed (explicitly avoided changing security behavior per constraints).
- Risk level: High
- Verification steps:
  - Inspect current rules file.
  - Validate intended auth/rule model before tightening in a dedicated change.

## P1 — Correctness Issues

1. Firestore batch-limit failure risk (>500 ops) in planning actions
- Files:
  - `components/MasterSchedule.tsx:240`
  - `components/MasterSchedule.tsx:518`
  - `components/MasterSchedule.tsx:565`
  - `components/MasterSchedule.tsx:660`
  - `components/MasterSchedule.tsx:852`
  - `components/MasterSchedule.tsx:1395`
- Root cause: several write paths created a single `writeBatch` over variable-size job sets; Firestore caps batch writes at 500 ops.
- Evidence:
  - bulk operations were driven by unbounded arrays (`jobs`, `staleUpdates`, `actionableShifts`).
- Fix summary:
  - Added chunked commit helper (`FIRESTORE_BATCH_CHUNK_SIZE = 450`) and routed all large planning batch writes through it.
- Behavior preservation:
  - Same writes, same order semantics per chunk, only split into valid commit sizes.
- Risk level: Low
- Verification steps:
  - `npx tsc -p tsconfig.json --noEmit`
  - `npm run build`
  - spot-check each call site now uses `commitBatchedWrites(...)`.

2. Regression harness hard-failed after quote module rename
- File: `scripts/regression/harness.js:15`
- Root cause: harness imported only `lib/quoteEstimator.ts`, but current branch uses `lib/whatIfScheduler.ts`.
- Evidence: previous `MODULE_NOT_FOUND` failure in `npm run regression:harness:verify`.
- Fix summary:
  - Added `resolveQuoteModulePath()` fallback (`quoteEstimator.ts` -> `whatIfScheduler.ts`).
- Behavior preservation:
  - Uses existing module API (`simulateQuoteSchedule`, `checkAdvancedFeasibility`) without changing runtime app behavior.
- Risk level: Low
- Verification steps:
  - `npm run regression:harness:baseline`
  - `npm run regression:harness:verify` (PASS).

## P2 — Performance Issues

1. Gantt cell rendering did repeated segment scans per cell
- File: `components/CustomGanttTable.tsx:674`
- Root cause: each cell ran `segments.some(...)` then iterated `segments.map(...)`.
- Fix summary:
  - Precomputed `segmentsByStartCol` per row and rendered only start segments for each column.
  - Precomputed `dateColumnKeys` for per-cell date map keys.
- Evidence:
  - `docs/codex-audit/perf/custom-gantt-cell-bench.js`
  - old: `38.30ms`, new: `18.63ms`, same checksum.
- Risk level: Low
- Verification steps:
  - `node docs/codex-audit/perf/custom-gantt-cell-bench.js`
  - `npm run build`.

2. Daily load aggregation used O(n) key scans in inner loop
- File: `lib/analytics.ts:55`
- Root cause: for every job-day, code searched `loadMap` keys with `Array.from(...).find(...)`.
- Fix summary:
  - Switched to direct `Map.get(startOfDay(day).toISOString())`.
- Evidence:
  - `docs/codex-audit/perf/analytics-daily-load-bench.js`
  - old: `647.73ms`, new: `424.48ms`, same checksum.
- Risk level: Low
- Verification steps:
  - `node docs/codex-audit/perf/analytics-daily-load-bench.js`
  - `npx tsc -p tsconfig.json --noEmit`.

3. Planning page executed dead/unused work on hot render paths
- File: `components/MasterSchedule.tsx:784`
- Root cause:
  - Unreturned JSX block was being constructed but never rendered.
  - Unused capacity-alert effect performed analytics computations with no consumer state.
- Fix summary:
  - Removed dead JSX expression block and removed unused capacity-alert state/effect.
- Evidence:
  - `rg` showed no remaining consumer of removed state.
  - Main-thread work reduced on planning rerenders.
- Risk level: Low
- Verification steps:
  - `npx tsc -p tsconfig.json --noEmit`
  - `npm run build`
  - manual planning page smoke check.

## Maintainability / Future-Risk Hotspots

1. Lint warning debt remains high and can hide new regressions
- Evidence: `npm run lint` -> `122 problems (0 errors, 122 warnings)`.
- Impact: lint is unblocked, but warning volume still makes signal/noise weak in CI and code review.
- Recommendation: ratchet warning budgets by critical paths first (`app/planning`, `components/*Schedule*`, `lib/jobs.ts`, `lib/analytics.ts`) and fail builds only on newly introduced warnings.

2. Regression baseline drift is branch-sensitive
- Files:
  - `docs/codex-audit/regression/baseline.json`
  - `docs/codex-audit/regression/latest.json`
- Impact: verify can fail for unrelated branch behavior changes unless baseline is intentionally refreshed.
- Recommendation: update baseline only with explicit change-note in PR description.

## Verification Summary

- Passed:
  - `npm run lint`
  - `npx tsc -p tsconfig.json --noEmit`
  - `npm run build`
  - `npm run regression:harness:verify`
  - `node docs/codex-audit/perf/custom-gantt-cell-bench.js`
  - `node docs/codex-audit/perf/analytics-daily-load-bench.js`
