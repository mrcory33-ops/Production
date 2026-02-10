# Production Schedule — UI Terminology Guide

A shared vocabulary for every clickable, draggable, and visual element in the app.

---

## 1. Page-Level Regions

| Term | What it is | Location |
|------|-----------|----------|
| **Control Deck** | The full toolbar area pinned to the top of the page. Contains two rows (Top Deck + Bottom Deck). | Top of `/planning` |
| **Top Deck** | First row of the Control Deck — holds the Identity Island, Department Pill Toggles, and View Mode Toggles. | Upper row |
| **Bottom Deck** | Second row — holds the Filter Group (left) and the Tools Island (right). | Lower row |
| **Gantt Chart** | The scrollable table showing all jobs as rows with time-based bars across date columns. | Main content area below the Control Deck |

---

## 2. Control Deck — Top Deck

| Term | What it is | Visual |
|------|-----------|--------|
| **Identity Island** | Rounded container holding the "Master Schedule" title, the status dot, the Scoring Config icon button, and the Product Type Pills. | Left side of Top Deck |
| **Status Dot** | Small blue circle next to the title. Purely decorative branding indicator. | Inside Identity Island |
| **Scoring Config Button** | Icon button (sliders ⚙️) that opens the Scoring Config Panel. | Inside Identity Island, after divider |
| **Product Type Pills** | Three toggle buttons — **FAB**, **Doors**, **Harmonic**. Click to filter jobs by product type. Dark = selected. | Inside Identity Island |
| **Department Pill Toggles** | Row of toggle buttons — one per department (Engineering, Laser, Press Brake, Welding, Polishing, Assembly). Click to isolate that department view. Black = active. | Center of Top Deck |
| **View Mode Toggles** | Two buttons: **All Jobs** / **Active**. Switches between showing every job or only jobs currently in the active department. | Right side of Center Control Well, after divider |

---

## 3. Control Deck — Bottom Deck

### Left: Filter Group

| Term | What it is |
|------|-----------|
| **Search Input** | Text field with a filter icon. Searches by Job name, SO, WO, or Sales Rep Code. |
| **Date Filter** | Toggle label (**Due:** / **Sched:**) + two date pickers (start & end). Click the label to switch between filtering by due date vs. scheduled date. |
| **Points Range Filter** | Two small number inputs labeled **PTS**. Filters jobs by welding point range. |
| **Split Prod Toggle** | Button labeled "Split Prod". When active (indigo), groups/sections the Gantt by product type. |
| **Big Rocks Only Toggle** | Button labeled "Big Rocks Only". When active (amber), hides small-point jobs. |
| **New List Button** | Contextual green button that appears only when a single department is isolated + Active view is on. Resets the priority list for that department. |

### Right: Tools Island

| Term | What it is | Icon |
|------|-----------|------|
| **Import Button** | Link to `/upload` page for CSV/XLSX import. | Upload ⬆ |
| **Quote Estimator Button** | Link to `/quote-estimator`. | Calculator 🔢 |
| **Supervisor Button** | Link to `/supervisor` dashboard. | Shield ⚠ |
| **Insights Button** | Opens the Schedule Insights Panel. Turns amber when there are late jobs or overloaded weeks. | Message warning 💬 |
| **Alerts Button** | Opens the Alert Management Panel. Shows a red **Notification Badge** with count when alerts exist. | Bell 🔔 |
| **Export Button** | Opens the Export Modal for PDF/CSV export. | Download ⬇ |
| **Zoom Slider** | Range input that adjusts column width in the Gantt chart. | Label "ZOOM" |
| **Clear All Button** | Deletes all displayed jobs (with confirmation). Red trash icon. | Trash 🗑 |
| **Notification Badge** | Small red pill on the Alerts Button showing the active alert count. | On bell icon |

---

## 4. Gantt Chart Structure

| Term | What it is |
|------|-----------|
| **Date Header Row** | Top row of the Gantt showing week labels (e.g., "Feb 10") and individual day columns with day-of-week letters. |
| **Today Column** | The column highlighted to indicate the current date. |
| **Saturday Column** | Columns with a subtle tint to distinguish weekend days. |
| **Job Row** | A single horizontal row representing one job. Contains a Job Info Cell (left, sticky) and Date Cells (right, scrollable). |
| **Batch Header Row** | A colored accent row that appears above a group of related jobs (e.g., "⚙️ Batch: Knock Down — 4 items"). Groups batch-eligible jobs (same category, within 12 business days). |

---

## 5. Job Info Cell (Sticky Left Column)

This is the left-most, frozen cell for each job row.

| Term | What it is |
|------|-----------|
| **Job Name** | Bold text showing `job.name`. Clickable to select the job. |
| **Job ID** | The work order number displayed below the name in bold monospace. |
| **Description** | Truncated description text under the Job ID. |
| **Due Date Label** | "Due: M/D" text. Turns **red** if the job is past due. |
| **Points Badge** | Small slate pill showing welding points (e.g., "124 pts"). |
| **No Gaps Toggle** | Small button labeled "⚡ No Gaps" (active, blue) or "+ No Gaps" (inactive). Forces departments to run back-to-back with no gaps. |
| **Priority Input** | Number input labeled "Priority #". Only visible in Active + single department isolated mode. Sets manual priority ordering. |
| **Set Start/End Button** | Small text button that expands into two date inputs + Save/Cancel for manually setting the overall job range. |
| **Alert Badge** | Red pill button showing "! {count}" when supervisor alerts exist for this job. Clicking opens the **Alert Info Popover**. |
| **Alert Info Popover** | Dark popover listing each active alert for the job — department, resolution deadline, reason, and last adjustment timestamp. |
| **Status Symbols row** | Row of small colored **Status Symbol Badges** after the job name. Each is clickable to show its **Symbol Explanation Popover**. |

---

## 6. Status Symbol Badges

Small colored pill buttons displayed on the Job Info Cell. Each has a clickable **Symbol Explanation Popover** that explains its meaning.

| Badge Key | Icon | Label | Color | Trigger |
|-----------|------|-------|-------|---------|
| `conflict` | **!** | Scheduling Conflict | Red | Job can't meet due date within capacity |
| `stalled` | **OT?** | Overtime Candidate | Orange | No progress + behind schedule |
| `slipping` | **⚠** | Slipping Behind | Yellow | Behind schedule but still progressing |
| `ahead` | **🚀** | Ahead of Schedule | Emerald | Progressed past expected department |
| `reschedule` | **📅** | Due Date Changed | Purple | Due date changed since last import |
| `ot-needed` | **⏱** | OT Likely Needed | Amber | Capacity overload, overtime required |
| `open-po` | **Open PO** | Open PO | Orange | Purchase orders placed, nothing received |
| `partial-po` | **Partial** | Partially Received | Yellow | Some POs fulfilled, some still open |
| `received-po` | **Received** | Received | Emerald | All POs received |
| `csi-missing` | **CSI** | CSI Not Received | Amber | Missing customer-supplied information (alert-driven) |
| `out-of-stock` | **OOS** | Out of Stock Part | Rose | Part unavailable (alert-driven) |

### Special: Reschedule Symbol (📅)

Clicking any symbol opens a **Symbol Explanation Popover**. The 📅 reschedule symbol's popover additionally contains a **"View Suggested Placement →" Action Button** (purple). Clicking that opens the **Reschedule Suggestion Modal**.

---

## 7. Gantt Bars (Date Cell Area)

| Term | What it is |
|------|-----------|
| **Department Segment** | A colored horizontal bar representing one department's scheduled time span. Color matches the department (via `DEPARTMENT_CONFIG`). Multiple segments appear side-by-side for multi-department jobs. |
| **Bar Tooltip** | Hover tooltip above a segment showing department name, date range, and progress %. |
| **Progress Overlay** | White semi-transparent fill inside the active department's segment showing supervisor-reported completion %. |
| **Progress Label** | Bold percentage text (e.g., "45%") centered inside the active segment. |
| **Start Resize Handle** | Invisible drag handle on the left edge of a segment. Cursor changes to `col-resize`. Drag to adjust the department's start date. |
| **End Resize Handle** | Same, on the right edge. Drag to adjust the end date. |
| **Bar Label** | Job name text rendered below the first segment for identification on the timeline itself. |
| **Overlap Indicator** | When two departments overlap on the same day, the cell shows a split-color overlay (stacked department colors). |

### Drag Interactions

| Action | Behavior |
|--------|----------|
| **Drag a segment** (grab cursor) | Shifts the entire job schedule by N days (all departments move together). |
| **Drag a resize handle** | Adjusts just that one department's start or end date. |
| **Click a segment** | Opens the **Segment Edit Popover** (when in edit mode). |

---

## 8. Popovers, Modals, and Panels

| Term | Type | Opened By | Description |
|------|------|-----------|-------------|
| **Symbol Explanation Popover** | Popover (portal) | Clicking any Status Symbol Badge | Dark card explaining what the symbol means and what action to take. |
| **Alert Info Popover** | Popover (fixed) | Clicking the red Alert Badge on a job | Lists active supervisor alerts for that job. |
| **Segment Edit Popover** | Popover (overlay) | Clicking a Department Segment bar | Form with two date inputs (start/end) + Save/Cancel to edit one department's schedule. |
| **Reschedule Suggestion Modal** | Modal (portal) | Clicking "View Suggested Placement →" on 📅 symbol | Full-screen dark modal showing 3-tier analysis (strategy badge, schedule comparison table, job shifts, OT requirements) + **Accept Placement** / **Dismiss** buttons. |
| **Schedule Insights Panel** | Slide-in Panel | Clicking the Insights Button in Tools Island | Shows late jobs, overloaded weeks, move options, and OT recommendations with expandable/collapsible sections. |
| **Alert Management Panel** | Slide-in Panel | Clicking the Alerts Button in Tools Island | Full alert CRUD: list, resolve, extend, edit, adjust (with 3-tier preview), and delete supervisor alerts. |
| **Scoring Config Panel** | Modal/Panel | Clicking the Scoring Config Button (sliders icon) | Configure urgency scoring weights and factors. |
| **Export Modal** | Modal | Clicking the Export Button in Tools Island | Select export format (PDF/CSV) and generate schedule documents. |
| **Calendar Picker** | Popover/Widget | Various date inputs | Standard HTML date inputs throughout the app. |

---

## 9. Reschedule Suggestion Modal — Internal Elements

| Term | What it is |
|------|-----------|
| **Strategy Badge** | Colored pill at the top of the modal: "Clean Fit" (emerald), "Requires Job Moves" (amber), "Requires Overtime" (rose), or "No Fit Found" (red). |
| **Due Date Comparison** | Side-by-side display of Previous Due Date → New Due Date with direction arrow. |
| **Summary Text** | Natural-language explanation of the suggested change (shift direction, magnitude). |
| **Schedule Comparison Table** | Table per-department showing Current dates vs. Suggested dates. |
| **Job Shifts List** | (Tier 2) List of other jobs that would need to move, with shift magnitude and reason. |
| **OT Requirements** | (Tier 3) List of departments/weeks/tiers where overtime is needed. |
| **Accept Placement Button** | Green action button — applies the suggested schedule changes to Firestore. |
| **Dismiss Button** | Ghost button — clears the reschedule flags without changing the schedule. |

---

## 10. Quick Reference Cheat Sheet

```
┌─────────────────────────────────────────────────────────────┐
│  CONTROL DECK                                               │
│ ┌─Top Deck──────────────────────────────────────────────┐   │
│ │ [Identity Island] │ [Dept Pill Toggles] [View Modes]  │   │
│ └───────────────────────────────────────────────────────┘   │
│ ┌─Bottom Deck───────────────────────────────────────────┐   │
│ │ [Search] [Date Filter] [Pts] [Split] [Big] │ [Tools]  │   │
│ └───────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  GANTT CHART                                                │
│ ┌─Date Header Row─────────────────────┐                     │
│ │  Feb 10  │  Feb 17  │  Feb 24  │... │                     │
│ │  M T W T F S  M T W T F S  ...     │                     │
│ ├───────────────────────────────────  ┤                     │
│ │ [Job Info Cell]  │ [═══Segment═══]  │  ← Job Row          │
│ │  Job Name        │  [Progress %]    │                     │
│ │  [📅][!][OT?]   │  [Tooltip]       │  ← Status Symbols   │
│ │  Job ID          │  [Resize Handle] │                     │
│ │  Due: 3/15  42pt │                  │                     │
│ └──────────────────┴─────────────────-┘                     │
└─────────────────────────────────────────────────────────────┘
```
