---
description: How to test changes locally before deploying to Firebase Hosting
---

## Dev-First Workflow

Firebase deploys are slow (~5 min) because the Next.js adapter rebuilds a 589 MB Cloud Function every time.
**Always batch changes and test locally before deploying.**

// turbo-all

1. Make ALL code changes first — do not deploy between individual changes
2. Start the dev server if not already running:
```
npm run dev
```
3. Test ALL changes on http://localhost:3000
4. Only deploy once everything is verified:
```
npx firebase-tools deploy --only hosting
```

> **IMPORTANT**: Do NOT deploy after each individual change.
> Accumulate all changes, test them locally, then do a single deploy at the end.
> If the user asks to "deploy", ask if they have more changes planned first.
