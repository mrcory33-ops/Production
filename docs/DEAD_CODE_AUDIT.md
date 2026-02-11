# 🔍 Dead Code Audit — Production Scheduler

Full cross-reference analysis of every file in the project. Each item below was confirmed by searching all `.ts`, `.tsx`, and `.css` files for imports/references.

---

## 🔴 Category 1: Completely Unused Components

These components are **never imported or rendered** anywhere in the codebase.

| File | Lines | Description |
|------|-------|-------------|
| [BottleneckAlert.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/BottleneckAlert.tsx) | 28 | Simple alert component for capacity overload. Never imported. |
| [DailyGantt.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/DailyGantt.tsx) | 23 | Placeholder stub — literally says "Gantt Chart Placeholder (Loading...)" with a TODO comment. |
| [CalendarPicker.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/CalendarPicker.tsx) | 19 | Basic date input wrapper. Never imported. |
| [JobCard.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/JobCard.tsx) | 36 | Generic job card. Not imported — `design-concepts/page.tsx` defines its own local `JobCard` function instead. |
| [WeeklyMixChart.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/WeeklyMixChart.tsx) | 62 | Product mix bar chart with hardcoded `style={{ width: '40%' }}` and "Mock data for skeleton" comment. Never imported. |
| [ScoreBreakdown.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/ScoreBreakdown.tsx) | 58 | Urgency score breakdown panel. Never imported. (It does import from `scoringConfig`, but nothing imports *it*.) |
| [Timeline.tsx](file:///c:/Users/CoyD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/Timeline.tsx) | 361 | **Biggest dead component** — A full Frappe Gantt wrapper with Firebase fetching, full-screen mode, zoom slider, and custom popups. Completely replaced by `CustomGanttTable.tsx`. Never imported anywhere. |

> [!TIP]
> **Total dead component lines: ~587.** Removing these 7 files is safe and has no side effects.

---

## 🟠 Category 2: Unused Library File

| File | Lines | Description |
|------|-------|-------------|
| [queueBuffer.ts](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/lib/queueBuffer.ts) | 52 | Defines `QueueBufferStatus` interface and `getQueueBufferStatus()` function. Never imported anywhere. Imports from `scheduler.ts` but nothing uses it. |

---

## 🟡 Category 3: Dead CSS Imports in Layout

[layout.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/app/layout.tsx) imports two CSS files that are only needed by the dead `Timeline.tsx` component:

```tsx
import "./frappe-gantt.css";     // 7,779 bytes — Frappe Gantt library styles
import "./chart-overrides.css";  // 4,284 bytes — Custom overrides for Frappe Gantt
```

Since `Timeline.tsx` (the only Frappe Gantt consumer) is dead code, these CSS files and their imports are also dead. `custom-gantt.css` is still actively used by `CustomGanttTable.tsx`.

---

## 🟡 Category 4: Dead Type Definition

In [types/index.ts](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/types/index.ts), the `WeeklyTarget` interface (line 197) is **only** imported by the dead `WeeklyMixChart.tsx`. If that component is removed, `WeeklyTarget` becomes dead code too.

---

## 🟠 Category 5: Stale Root-Level Files

| File | Description |
|------|-------------|
| [extract-docx.js](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/extract-docx.js) | One-off CommonJS script that extracts text from a hardcoded path (`C:/Users/CoryD/Downloads/sched app.docx`). Not part of the build. |
| [docx-content.txt](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/docx-content.txt) | Output of the above script — **787 lines of empty whitespace** (extracted content appears to be blank). |
| [global_skills_list.txt](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/global_skills_list.txt) | Agent metadata file listing global skills. Not part of the app. |
| [QuoteEstimator.tsx.backup](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/components/QuoteEstimator.tsx.backup) | 24KB backup of an old version of the Quote Estimator component. |
| [EXECUTIVE_OVERVIEW.html.bak](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/docs/EXECUTIVE_OVERVIEW.html.bak) | 30KB backup of the Executive Overview HTML doc. |

---

## 🟡 Category 6: Unused Next.js Boilerplate SVGs

All 5 SVG files in `public/` are default Next.js scaffolding and are **never referenced** anywhere:

- `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`

---

## 🔵 Category 7: Prototype / Sandbox Pages

These are accessible routes but serve as design experiments rather than production features:

| Route | File | Notes |
|-------|------|-------|
| `/design-concepts` | [page.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/app/design-concepts/page.tsx) (28KB) | **Linked from home portal** as "Design Lab → R&D Sandbox". Contains its own local `JobCard` function + extensive mock data. |
| `/design-lab` | [page.tsx](file:///c:/Users/CoryD/OneDrive%20-%20Emjac%20Industries,%20Inc/Desktop/Production/app/design-lab/page.tsx) (18KB) | **Not linked from anywhere** — a completely orphaned prototype page. |

> [!NOTE]
> These aren't strictly "dead" since they are valid routes. Whether to keep them is a judgment call — they may be useful for future design iteration.

---

## ⚠️ Category 8: Extensive Debug Logging (Not Dead, But Worth Noting)

`scheduler.ts` and `jobs.ts` contain **25+ `console.log` statements** with prefixes like `[SCHEDULER]`, `🔥`, `📅`. These are not dead code but are production debug noise:

- **scheduler.ts**: ~18 `console.log` calls with pipeline phase logging
- **jobs.ts**: ~7 `console.log` calls with sync/analysis logging

---

## Summary

| Category | Files | Lines | Impact |
|----------|-------|-------|--------|
| Unused Components | 7 | ~587 | Safe to delete |
| Unused Lib File | 1 | 52 | Safe to delete |
| Dead CSS Files + Imports | 2 files + 2 import lines | ~350 | Safe to delete after Timeline removal |
| Dead Type (`WeeklyTarget`) | 1 interface | ~6 | Safe to delete after WeeklyMixChart removal |
| Stale Root Files | 5 | ~810 | Safe to delete |
| Unused SVGs | 5 | — | Safe to delete |
| Orphaned Prototype Page | 1 (`design-lab`) | ~550 | Judgment call |
| **Total clearly dead** | **~21 files** | **~2,355 lines** | |
