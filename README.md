# Production Scheduler

Next.js production scheduling app for EMJAC operations, deployed to Firebase with server API routes enabled.

## Local Development

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Required Firebase Setup

1. Enable **Authentication -> Sign-in method -> Anonymous**.
2. Ensure Firestore exists for project `production-scheduler-em-ops`.
3. Deploy Firestore rules from this repo before opening public access.

## Environment Variables

Create `.env.local` with:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Used by server-side token verification (can be same as NEXT_PUBLIC_FIREBASE_API_KEY)
FIREBASE_WEB_API_KEY=...

# Optional email notifications for special purchase adjustments
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
```

## Validation Before Deploy

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Firebase Deploy (Next.js + API Routes)

This repo is configured for Firebase web framework hosting (`firebase.json` uses `frameworksBackend`).

```bash
npx firebase-tools login
npx firebase-tools use production-scheduler-em-ops
npx firebase-tools deploy --only hosting,firestore
```

## Notes

- Deploying as static export is intentionally disabled because `/api/parse-pdf` and `/api/notify-sp-adjustment` require server runtime.
- The app now requires authenticated Firebase sessions for Firestore and API endpoints.
