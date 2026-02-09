# Architecture Overview

Date: 2026-02-09

## Stack
- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS
- Firebase Web SDK (`firebase`): Firestore + Auth initialized in `lib/firebase.ts`
- Firebase Hosting config present (`firebase.json`)

## Core App Flows
- Home Portal: `app/page.tsx`
  - Route cards navigate to planning, supervisor, quote estimator, upload, and design pages.
- Planning Board: `app/planning/page.tsx` -> `components/MasterSchedule.tsx`
  - Main production scheduling UI, Gantt interactions, bulk schedule edits, alert-driven adjustments.
- Supervisor View: `app/supervisor/page.tsx` -> `components/SupervisorSchedule.tsx`
  - Real-time floor view, roster management, per-department progress/assignments.
- Import/Sync: `app/upload/page.tsx` -> `lib/parser.ts` -> `lib/jobs.ts`
  - Parses CSV/XLSX export, computes job sync actions, writes batched Firestore updates.
- Insights: `app/insights/page.tsx`
  - Reads active jobs and computes 30-day capacity and bottlenecks via `lib/analytics.ts`.
- What-if / Quote Estimation: `app/quote-estimator/page.tsx` + `components/WhatIfScheduler.tsx` + `lib/whatIfScheduler.ts`
  - Simulates projected timelines and feasibility.

## Firestore Touch Points
- Initialization: `lib/firebase.ts`
  - Exports `db`, `auth`.
- Jobs collection read/write:
  - `components/MasterSchedule.tsx`
    - Reads active jobs (`status in PENDING/IN_PROGRESS/HOLD`) with `getDocs`.
    - Writes via `updateDoc` and batched `writeBatch` for priority resets, bulk deletes, auto shifts, and alert adjustment applies.
  - `components/SupervisorSchedule.tsx`
    - Real-time jobs listener via `onSnapshot(query(...limit(500)))`.
    - Updates assignments/progress with `updateDoc`.
  - `lib/jobs.ts`
    - Sync pipeline: fetch active jobs, then chunked batched set/update writes.
- Alerts:
  - `lib/supervisorAlerts.ts`
    - `subscribeToAlerts` uses `onSnapshot`.
    - create/update/resolve/delete/extend via `setDoc`/`updateDoc`/`deleteDoc`.
- Scoring config:
  - `lib/scoringConfig.ts`
    - Reads/writes `settings/scoringWeights`.
- Other read-only consumer:
  - `components/Timeline.tsx`, `components/SupervisorDashboard.tsx`, `app/insights/page.tsx`.

## Cloud Storage
- Storage bucket is configured in `lib/firebase.ts` (`storageBucket` in config).
- No direct Cloud Storage SDK reads/writes are referenced in current source (`firebase/storage` usage not found).

## Build/Test/Lint/Typecheck Commands
- Install deps: `npm install`
- Lint: `npm run lint`
- Typecheck: `npx tsc -p tsconfig.json --noEmit`
- Build: `npm run build`
- Regression harness:
  - Baseline: `npm run regression:harness:baseline`
  - Verify: `npm run regression:harness:verify`

## Emulator Usage
- Firebase emulator wiring was not found in app code (`connectFirestoreEmulator` / `connectStorageEmulator` absent).
- `firebase.json` includes Firestore rules/indexes + Hosting config, but no emulator block.

## Performance-Sensitive Paths
- `components/CustomGanttTable.tsx`
  - Cell-by-cell rendering and per-row segment overlays.
- `components/MasterSchedule.tsx`
  - Filtering/sorting, schedule normalization, bulk Firestore writes.
- `lib/analytics.ts`
  - Daily load/bottleneck aggregation loops over jobs x departments x dates.
- `lib/scheduler.ts` and `lib/whatIfScheduler.ts`
  - Capacity simulation and scheduling heuristics.
- `lib/jobs.ts`
  - Sync path for potentially large active-job sets and batch commits.
