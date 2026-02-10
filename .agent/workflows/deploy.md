---
description: How to test changes locally before deploying to Firebase Hosting
---

## Dev-First Workflow

// turbo-all

1. Make code changes
2. Run the dev server if not already running:
```
npm run dev
```
3. Test changes on the dev server at http://localhost:3000
4. Once verified, build for production:
```
npm run build
```
5. Deploy to Firebase Hosting:
```
npx firebase-tools deploy --only hosting
```
