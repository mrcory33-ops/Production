# Baseline Health

Date: 2026-02-09

## Environment Notes
- Initial local dependency state was incomplete (`nodemailer` missing from `node_modules`).
- Ran `npm install` once to restore dependencies before baseline runs.

## Commands And Results

1. Install
- Command: `npm install`
- Result: success (`added 2 packages`)

2. Lint
- Command: `npm run lint`
- Baseline result: fail (pre-existing lint debt)
- Baseline summary: `148 problems (77 errors, 71 warnings)`
- Current result after safe lint remediation: pass
- Current summary: `122 problems (0 errors, 122 warnings)`
- Timing (latest run): `6800ms`

3. Typecheck
- Command: `npx tsc -p tsconfig.json --noEmit`
- Result: success
- Timing (latest run): `2410ms`

4. Build
- Command: `npm run build`
- Result: success
- Timing (latest run): `12710ms`

5. Regression harness baseline
- Command: `npm run regression:harness:baseline`
- Result: success (`baseline.json` updated to current branch behavior)

6. Regression harness verify
- Command: `npm run regression:harness:verify`
- Result: success (`PASS - outputs match baseline`)

## Firebase/Runtime Observations
- Firestore reads are concentrated in:
  - planning fetch (`MasterSchedule`)
  - supervisor real-time listener (`SupervisorSchedule`)
  - upload sync preload (`lib/jobs.ts`)
- Cloud Storage SDK usage was not found in app code.

## Known Baseline Risks
- Lint still has broad warning debt across app/components/lib, which can hide new issues unless warnings are ratcheted over time.
- Firestore security rules are currently fully open (`allow read, write: if true;`) in `firestore.rules`.
