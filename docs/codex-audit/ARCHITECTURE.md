# Architecture Overview

## Stack
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS
- Firebase (Firestore, Auth initialized; Storage bucket configured but no direct usage found)

## Core App Flows
- Home (`/` -> `app/page.tsx`): renders `components/PlanningBoard.tsx` (main scheduler UI).
- Planning (`/planning` -> `app/planning/page.tsx`): wraps the same `PlanningBoard` with a header.
- Upload (`/upload` -> `app/upload/page.tsx`): client-only CSV/XLSX import, parses to `Job[]`, then syncs to Firestore via `lib/jobs.ts`.
- Insights (`/insights` -> `app/insights/page.tsx`): fetches active jobs and computes 30-day capacity/bottlenecks with `lib/analytics.ts`.

## Firestore Interaction Points
- `lib/firebase.ts`: initializes Firebase app + Firestore handle.
- `lib/jobs.ts`:
  - `syncJobsInput()` reads active jobs via `getDocs(query(collection('jobs'), where('status','in',...)))`.
  - Schedules new jobs (`scheduleAllJobs`) and batch writes (set/update) to `jobs` collection.
- `components/PlanningBoard.tsx`:
  - `getDocs()` for active jobs (status in PENDING/IN_PROGRESS) with `limit(200)`.
  - Multiple `updateDoc()` and `writeBatch()` operations for drag edits, schedule shifts, priority resets, and bulk deletes.
- `app/insights/page.tsx`: `getDocs()` active jobs for analytics.
- `components/Timeline.tsx`: `getDocs()` active jobs for Gantt (legacy view).
- `lib/scoringConfig.ts`: reads/writes `settings/scoringWeights` with `getDoc`/`setDoc` (also caches in localStorage).

## Cloud Storage
- Firebase Storage is configured in `lib/firebase.ts` but no direct storage uploads/downloads were found in code.

## Performance-Sensitive Paths
- `components/PlanningBoard.tsx`:
  - Client-side filtering/sorting (`displayJobs`), scheduling updates, and analytics recalculation.
  - Firestore batch updates for scheduling changes.
- `components/CustomGanttTable.tsx`:
  - Rendering of Gantt table with per-cell layout, drag/resize behavior.
- `lib/scheduler.ts`:
  - Capacity-aware scheduling and batching logic (CPU-heavy for large job sets).
- `lib/analytics.ts`:
  - Daily load aggregation and bottleneck detection.
- `app/upload/page.tsx` + `lib/parser.ts`:
  - Parsing large CSV/XLSX input on the client.

## Build / Lint / Typecheck
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck (no script): `npx tsc -p tsconfig.json --noEmit`
