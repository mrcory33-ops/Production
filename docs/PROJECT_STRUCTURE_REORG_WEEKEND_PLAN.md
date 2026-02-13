# Project Structure Reorganization (Weekend Plan)

## Why This Matters
- Current importance: `78/100` (high strategic value, not an emergency today).
- If left alone too long, change velocity and bug risk will likely worsen as large files and flat folders keep growing.

## Risk Estimate
- All-at-once reorg + scheduler split: `68/100` chance of breakage.
- Phased execution: `27/100` chance of breakage.
- Phased + strict validation gates: ~`8/100` chance of production-impact issues.

## Time Estimate (Safe Pace)
- Phase 1 (cleanup/archive): `2-4 hours`
- Phase 2 (folder reorg + import updates): `1-2 days`
- Phase 3 (split `lib/scheduler.ts`): `2-5 days`
- Total for full plan: `4-8 working days`

## Recommended Weekend Scope
- Do **Phase 1 + Phase 2 only** this weekend.
- Defer Phase 3 (`lib/scheduler.ts` split) to a dedicated follow-up window.

## Pre-Flight (30-45 minutes)
1. Create a branch:
   - `git checkout -b chore/project-structure-reorg`
2. Capture current baseline:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npm run regression:harness:verify`
3. Confirm key routes work before edits:
   - `/`
   - `/planning`
   - `/supervisor`
   - `/insights`
   - `/quote-estimator`
   - `/upload`

## Phase 1 (Low Risk): Cleanup + Archiving
Target: remove clutter without changing runtime behavior.

1. Archive/delete known stale files:
   - `components/QuoteEstimator.tsx.backup`
   - `docs/EXECUTIVE_OVERVIEW.html.bak`
2. Move loose root docs/scripts artifacts into proper locations if still needed:
   - `docx-content.txt`
   - `extract-docx.js`
   - `global_skills_list.txt`
3. Decide route status:
   - Keep/remove `app/design-concepts`
   - Keep/remove `app/design-lab`

Validation gates:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run dev` + route spot-check

Commit checkpoint:
- `git add -A && git commit -m "chore: clean stale files and archive docs artifacts"`

## Phase 2 (Medium Risk): Reorganize by Feature
Target: move files into clear feature folders with no behavior changes.

1. Reorganize `components/` using `git mv`:
   - `components/scheduling/*`
   - `components/gantt/*`
   - `components/alerts/*`
   - `components/analytics/*`
   - Keep `components/supervisor/*` as feature-local
2. Reorganize `lib/` gradually:
   - Add subfolders like `lib/parsing`, `lib/config`, `lib/scheduling` (for non-engine chunks first)
3. Keep global CSS strategy explicit:
   - Current global imports are in `app/layout.tsx`
   - Do not move global styles blindly into component folders unless converting to CSS Modules or maintaining global import rules
4. Update imports incrementally and compile often.

Execution pattern:
1. Move a small batch (`3-8` files).
2. Fix imports.
3. Run `npx tsc --noEmit`.
4. Repeat.

Validation gates (full):
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run regression:harness:verify`
- `npm run dev` and verify core flows:
  - Gantt renders
  - Supervisor dashboard renders
  - What-If scheduler renders

Commit checkpoint:
- `git add -A && git commit -m "refactor: reorganize components and lib by feature"`

## Phase 3 (Higher Risk): Split `lib/scheduler.ts` (Defer)
Target: improve maintainability of the 149KB scheduling engine safely.

1. Introduce a stable facade (`lib/scheduler.ts`) that re-exports from internal modules.
2. Extract one concern at a time:
   - `engine.ts`
   - `capacity.ts`
   - `batching.ts`
   - `overtime.ts`
3. After each extraction:
   - `npx tsc --noEmit`
   - `npm run regression:harness:verify`
4. Only merge when behavior is unchanged in regression harness and manual checks.

## Rollback Strategy
1. Keep commits small and phase-scoped.
2. If a batch fails validation, revert only that commit:
   - `git revert <commit_sha>`
3. Do not continue stacking changes on top of a red build.

## Decisions To Lock Before Starting
1. Should `QueueHealthPanel` live under `alerts` or `analytics`?
2. Are `app/design-concepts` and `app/design-lab` permanent or experimental?
3. Keep, archive, or remove old HTML exports:
   - `docs/EXECUTIVE_OVERVIEW.html`
   - `docs/SCHEDULING_LOGIC_OVERVIEW.html`

## Done Criteria
- App builds and type-checks cleanly.
- Regression harness passes.
- Core routes and scheduling UIs function normally.
- File layout is feature-based and predictable.
- No unresolved import-path TODOs remain.
