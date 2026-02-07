# EMJAC Production Scheduling System
## Executive Overview Document

**Prepared for:** Company President  
**Date:** February 7, 2026  
**System Version:** 7.3.0  
**Live URL:** https://production-scheduler-em-ops.web.app

---

## 1. What This System Does

The **EMJAC Production Scheduling System** is an intelligent job scheduling platform that:

1. **Imports daily job data** from Global Shop (XLSX exports)
2. **Automatically schedules work** across all 6 production departments
3. **Tracks job progress** against the original schedule
4. **Identifies problems early** (delays, stalls, due date changes)
5. **Captures shop floor feedback** via the Supervisor Dashboard
6. **Estimates quote feasibility** via the built-in Quote Estimator
7. **Exports reports** for analysis and record-keeping

The system replaces manual scheduling with data-driven decisions, ensuring that:
- Big jobs get prioritized appropriately
- Departments don't get overloaded
- Due dates are met whenever possible
- Problems are visible before they become critical
- New quotes can be evaluated against live shop capacity

---

## 2. Daily Workflow

### Morning: Import Today's Data

1. **Export from Global Shop** → Generate the daily XLSX file containing all open work orders
2. **Upload to Scheduler** → Drag & drop the file into the Upload page
3. **Preview & Confirm** → Review the parsed jobs, then click "Sync to Database"

### What Happens During Import

| Job Status | System Action |
|------------|---------------|
| **NEW** (never seen before) | Scheduled automatically using optimization algorithms |
| **EXISTING** (already in system) | Schedule preserved, progress tracked against original plan |
| **MISSING** (was in system, not in today's file) | Marked as COMPLETED |

### HARMONIC Painting Prompt

During import, the system detects all **HARMONIC** product type jobs and shows a **painting prompt modal**. Users select which HARMONIC jobs require off-site painting. Jobs flagged for painting receive:
- An extended Assembly timeline (+8–9 work days)
- A +15 urgency scoring bonus to ensure they are prioritized

### Automatic Alerts After Import

The system notifies you of:

- **📅 Due Date Changes** — Jobs where the due date moved since yesterday (with old → new dates shown)
- **🚀 Ahead of Schedule** — Jobs that jumped past their expected department

---

## 3. The Six Production Departments

Jobs flow through departments in this fixed order:

```
Engineering → Laser → Press Brake → Welding → Polishing → Assembly
```

Each department's work is measured in **Welding Points** (from `DEPT4HRS` in Global Shop), which represent the job's complexity and time requirements.

### Department Duration Calculation

The system calculates how many **days** a job will spend in each department using worker capacity:

**Core Formula:**
```
Duration (days) = Welding Points ÷ Daily Output
Daily Output = Workers per Project × Output per Worker/Day
Final Duration = ceil(Raw Days × 2) / 2    ← rounded up to nearest half-day
```

#### Worker Pool Configuration

| Department | Total Workers | Workers per Project | Output per Worker/Day | Effective Daily Output | Multiplier |
|------------|:---:|:---:|:---:|:---:|:---:|
| **Engineering** | 9 | 1 | 22 pts | 22 pts/day | — |
| **Laser** | 3 | 2 | 67.5 pts | 135 pts/day | — |
| **Press Brake** | 6 | 4 | 33 pts | 132 pts/day | — |
| **Welding** | 13* | 3 | 15 pts | 45 pts/day | — |
| **Polishing** | 11* | 3 | 18 pts | 54 pts/day | — |
| **Assembly** | 12 | 3 | 16 pts | 48 pts/day | **×1.25** |

*\*Welding & Polishing use split pools (DOORS vs FAB/HARMONIC) to maintain flow across product types.*

#### Example: 100-Point FAB Job Duration

| Department | Calculation | Raw Days | Rounded |
|------------|-------------|----------|---------|
| Engineering | 100 ÷ 22 | 4.55 days | **5 days** |
| Laser | 100 ÷ 135 | 0.74 days | **1 day** |
| Press Brake | 100 ÷ 132 | 0.76 days | **1 day** |
| Welding | 100 ÷ 45 | 2.22 days | **2.5 days** |
| Polishing | 100 ÷ 54 | 1.85 days | **2 days** |
| Assembly | 100 ÷ 48 × 1.25 | 2.60 days | **3 days** |

**Total work time: ~14.5 days** (plus gaps between departments)

#### Why "Workers per Project" Matters

- **Engineering** (1 worker max): Only 1 engineer can work on any single job, so a 100pt job takes longer
- **Press Brake** (4 workers max): Up to 4 operators can work on one job, processing faster
- **Welding** (3 workers max): Balanced for quality — too many welders causes coordination issues

---

## 4. Product-Specific Scheduling Rules

The scheduler applies intelligent business rules based on product type and job characteristics.

### 4.1 Assembly Time Multiplier

Assembly has a **1.25× time multiplier** — takes 25% longer than the base formula suggests. This accounts for final packaging, quality control, and shipping preparation overhead.

### 4.2 Door Leaf Minimum (DOORS)

| Field | Value |
|-------|-------|
| **Trigger** | Job description contains "door" but NOT "frame" |
| **Effect** | Minimum **2 days** in Welding department |
| **Rationale** | Door leaf assemblies require multi-stage welding processes regardless of welding point value |

### 4.3 NYCHA Extended Welding Time

| Field | Value |
|-------|-------|
| **Trigger** | Job name contains "NYCHA" |
| **Effect** | Minimum **3 days** in Welding department |
| **Applies To** | All product types (FAB, DOORS, HARMONIC) |
| **Rationale** | NYCHA (New York City Housing Authority) projects have specific quality and inspection requirements that necessitate extended welding time, regardless of job size |

### 4.4 HARMONIC Painting Extension

| Field | Value |
|-------|-------|
| **Trigger** | HARMONIC product type + user selects "requires painting" during import |
| **Painting Time** | **+5 work days** for off-site painting process |
| **Post-Paint (Small Jobs <50 pts)** | **+3 days** re-assembly after paint returns |
| **Post-Paint (Large Jobs ≥50 pts)** | **+4 days** re-assembly after paint returns |
| **Total Extension** | **8–9 work days** added to Assembly department |

**How It Works:** When uploading a Global Shop export, a painting prompt modal appears showing all HARMONIC jobs. Users select which jobs require off-site painting, and the scheduler automatically extends the Assembly timeline.

### 4.5 Customer-Specific Multipliers

The system supports per-customer scheduling adjustments for clients with unique production characteristics:

| Customer | Output Multiplier | Engineering Cap | Effect |
|----------|:---:|:---:|--------|
| **GERMFREE** | 0.80× | 1 day max | Workers produce 20% less per hour (job takes longer) in all departments except Engineering. Engineering is capped at 1 day because GERMFREE provides pre-engineered drawings. |

**How It Works:**
- The system matches customer names (case-insensitive, partial match) against the configured list
- `outputMultiplier < 1` means workers produce less per hour, so jobs take proportionally longer
- `engineeringMaxDays` caps Engineering duration for customers who provide pre-engineered items
- The multiplier applies to **all departments except Engineering**

**Formula with Customer Multiplier:**
```
Daily Output = (Effective Workers × Output per Worker/Day) × Customer Output Multiplier
Duration = Welding Points ÷ Adjusted Daily Output
```

### 4.6 Batch Efficiency Discounts

When similar jobs are batched together (see Section 7 — Batching Logic), the system reduces the effective welding points to account for shared setup time:

| Batch Size | Discount | Effect |
|:---:|:---:|--------|
| **2 items** | 10% | Points × 0.90 (10% time savings) |
| **3+ items** | 15% | Points × 0.85 (15% time savings, max discount) |

**How It Works:**
- When two or more jobs are grouped in the same batch (same category + gauge + material), the scheduler reduces the effective points used in the duration calculation
- This means batched jobs complete faster than individually scheduled jobs
- The discount caps at 15% regardless of batch size to maintain quality

---

## 5. Urgency Scoring (Complete Breakdown)

Every job receives an **Urgency Score** (0–100+) that determines its scheduling priority. The score is calculated from **8 built-in factors** plus any **custom factors** you define.

### 5.1 Built-In Scoring Factors

| # | Factor | Max Points | Trigger Condition | Description |
|---|--------|:---:|-------------------|-------------|
| 1 | **Due Date Proximity** | 30 pts | Always active | Jobs due within 5 days get maximum points. Score scales: `max(0, 30 - daysUntilDue)` |
| 2 | **FastShip** | 25 pts | `fastShip = true` | Jobs flagged as "Fast Ship" in Global Shop get a 25-point bonus. Highest single bonus. |
| 3 | **Slippage Risk** | 20 pts | Current dept behind expected | 5 points per department of lag. Formula: `min(20, DeptLag × 5)` |
| 4 | **Stall Penalty** | 15 pts | No movement for 2+ days | 5 points per day stalled beyond 2-day threshold. Formula: `min(15, DaysBeyondThreshold × 5)` |
| 5 | **Painting Required** | 15 pts | HARMONIC job flagged for painting | Jobs requiring off-site painting get a 15-point priority boost |
| 6 | **Big Rock** | 10 pts | weldingPoints ≥ 50 | Large jobs get a priority boost to ensure they start on time |
| 7 | **REF Job** | 10 pts | Description contains "REF" | Refrigeration/specialty jobs get a 10-point bonus |
| 8 | **Harmonic Product** | 10 pts | productType = "HARMONIC" | Harmonic product type jobs (Work Order starts with "H") get a 10-point bonus |

### 5.2 Priority Inflation Cap

**FastShip + Due Date Proximity are capped at 40 points combined.** This prevents "Priority Inflation" — a scenario where a FastShip job that is also due soon would score disproportionately high, potentially starving other critical jobs of scheduling priority.

```
Combined = FastShip + DueDateProximity
If Combined > 40 → reduce until Combined = 40
```

### 5.3 Score Calculation Example

A job with:
- Due in 3 days → **30 pts** (Due Date Proximity)
- FastShip flag → **10 pts** (capped down from 25 because 30+25=55 > 40 cap)
- 60 welding points → **10 pts** (Big Rock)
- Description: "REF Frame" → **10 pts** (REF Job)
- Requires painting → **15 pts** (Painting Required)

**Total Urgency Score: 75 points**

This job would be scheduled before a job with only 40 points.

### 5.4 Custom Factors

The system supports **user-defined scoring factors** through the Scoring Configuration UI. Each custom factor can:
- Match text in the job description, notes, or name
- Add a bonus point value when matched
- Be enabled/disabled individually

### 5.5 Scoring Configuration UI

Click the **⚙️ sliders icon** next to the "Planning" title on the Planning Board to open the **Urgency Scoring Configuration** panel. From here you can:
- **Enable/disable** individual scoring factors
- **Adjust point values** for each built-in factor
- **Add custom factors** with text-match conditions
- **Reset to defaults** if needed
- Settings are saved to both **localStorage** (fast) and **Firebase** (backup/sync)

---

## 6. Product Types

Jobs are classified into three product types based on the Work Order number prefix:

| Prefix | Product Type | Symbol | Department Pools |
|--------|-------------|--------|------------------|
| D | DOORS | 🚪 | Uses DOORS-specific capacity pools |
| H | HARMONIC | 〰️ | Uses HARMONIC-specific capacity pools |
| All others | FAB | 🏭 | Uses general FAB capacity pools |

This classification affects:
- Which capacity pool a job draws from
- Whether the Harmonic urgency bonus applies
- Whether the painting prompt is shown during import
- Analytics and reporting breakdowns

---

## 7. Batching Logic (Similar Jobs Grouped Together)

The scheduler groups similar jobs together to improve production efficiency. Jobs are batched based on their **description text** matching specific patterns.

### 7.1 Batch Categories

| Category | Description Patterns (Any Match) |
|----------|-----------------------------------|
| **Frame Knock Down** | "frame knock down", "frames knock down", "frame knockdown", "frame kd", "frames kd", "kd frame", "knock down frame" |
| **Frame Case Opening** | "frame case opening", "frames case opening", "case opening frame", "frame co", "frames co" |
| **Door Lock Seam** | "door lock seam", "doors lock seam", "lock seam door", "lock seam doors" |
| **Wall Panel** | "wall panel", "wall panels" |
| **Dish Table** | "dish table", "dish tables", "soiled dish", "soiled dishtable" |
| **3-Compartment Sink** | "3 compartment sink", "3-compartment sink", "3 cpt sink" |
| **Wall Shelf** | "wall shelf", "wall shelves", "lower wall shelf", "upper wall shelf" |
| **Corner Guard** | "corner guard", "corner guards", "cornerguard", "cornerguards" |

### 7.2 Batching Tiers

When jobs match a batch category, they are further grouped by:

**Tier 1 — Strict Match (Highest Priority):**
- Same batch category (e.g., Frame Knock Down)
- Same **gauge** (e.g., "16 ga", "#16")
- Same **material** (e.g., SS304, galvanized, CRS)
- Same **due week** (Monday-Sunday containing due date)

**Tier 2 — Relaxed Match (Medium Priority):**
- Same batch category
- Same due week
- (Any gauge or material)

**Tier 3 — No Batch (Normal Priority):**
- Jobs that don't match any batch category are scheduled individually

### 7.3 Batch Efficiency Discount

When jobs are batched together, they receive an **automatic time reduction** because setup time is shared:

| Batch Size | Time Discount |
|:---:|:---:|
| 2 items in same batch | **10%** faster |
| 3+ items in same batch | **15%** faster (max) |

### 7.4 Material Detection

The system recognizes these materials from job descriptions:

| Keywords | Material Code |
|----------|---------------|
| "ss 316l", "316l" | SS316L |
| "ss 316", "316" | SS316 |
| "ss 304", "304" | SS304 |
| "stainless", "ss" | STAINLESS |
| "galvanized", "galv" | GALV |
| "aluminum", "alum" | ALUM |
| "crs" | CRS (Cold Rolled Steel) |
| "hrs" | HRS (Hot Rolled Steel) |
| "steel" | STEEL |

### 7.5 Gauge Detection

The system looks for gauge patterns like:
- "16 ga", "16ga", "16 gage"
- "#16", "# 16"

### 7.6 Batching Example

Given these jobs:
1. "Frame Knock Down 16ga SS304" due Feb 10
2. "Frame Knock Down 16ga SS304" due Feb 12
3. "Frame Knock Down 18ga Galv" due Feb 11
4. "Frame Case Opening" due Feb 10

**Result:**
- Jobs 1 & 2 → Same batch (FRAME_KD, 16ga, SS304, same week) — **receives 10% efficiency discount**
- Job 3 → Separate batch (different gauge/material)
- Job 4 → Separate batch (different category)

Jobs 1 & 2 will be scheduled consecutively AND each will take 10% less time than if scheduled individually.

---

## 8. Capacity Management

### 8.1 Weekly Capacity Pool

Each department has a **weekly budget of 850 points** (normal) or **1,000 points** (overtime capacity).

| Day | Example Load | Running Total |
|-----|:---:|:---:|
| Monday | 200 pts | 200 / 850 |
| Tuesday | 250 pts | 450 / 850 |
| Wednesday | 180 pts | 630 / 850 |
| Thursday | 150 pts | 780 / 850 |
| Friday | 70 pts | 850 / 850 ✓ |

This allows flexibility — a heavy Monday can be balanced by a lighter Friday.

### 8.2 Big Rock Rules (70/30 Rule)

To prevent big jobs from monopolizing a department:

| Rule | Limit |
|------|-------|
| Maximum concurrent Big Rocks per day (Engineering) | 3 |
| Maximum concurrent Big Rocks per day (Laser) | 2 |
| Maximum concurrent Big Rocks per day (Press Brake) | 2 |
| Maximum concurrent Big Rocks per day (Welding) | 3 |
| Maximum concurrent Big Rocks per day (Polishing) | 3 |
| Maximum concurrent Big Rocks per day (Assembly) | 3 |
| Maximum daily capacity consumed by Big Rocks | 70% |
| Reserved for smaller jobs | 30% |

### 8.3 Department-Specific Capacity Pools

Welding and Polishing have **split capacity pools** for different product types:

**Welding Department:**
| Pool | Workers | Product Types |
|------|:---:|---------------|
| Pool 1 | 6 welders | DOORS only |
| Pool 2 | 7 welders | FAB + HARMONIC |

**Polishing Department:**
| Pool | Workers | Product Types |
|------|:---:|---------------|
| Pool 1 | 6 polishers | FAB + HARMONIC |
| Pool 2 | 5 polishers | DOORS only |

This prevents one product type from completely blocking another.

---

## 9. Department Gaps (Buffer Time)

Jobs don't move instantly between departments. The scheduler inserts realistic gaps based on job size.

### 9.1 Live Scheduler Gaps

| Job Size | Gap Between Departments | Rationale |
|----------|:---:|-----------|
| Big Rock (≥50 pts) | **1 full workday** | Large jobs need material staging and setup time |
| Medium (8-49 pts) | **1 workday** | Moderate setup requirements |
| Small (≤7 pts) | **No gap** | Can be handed off same-day |

### 9.2 Quote Estimator Gaps (Tighter)

The Quote Estimator uses slightly tighter gaps for simulation, since it models an ideal flowing shop floor:

| Job Size | Estimator Gap |
|----------|:---:|
| Big Rock (≥50 pts) | **1 workday** |
| Medium (8-49 pts) | **0.5 workday** |
| Small (≤7 pts) | **No gap** |

### 9.3 "No Gaps" Override

For rush jobs, supervisors can click the **⚡ No Gaps** button on any job. This:
- Removes ALL department gaps for that specific job
- Schedules departments back-to-back
- Can significantly shorten the total job duration
- Appears as a blue "⚡ No Gaps" badge on the job card

---

## 10. Scheduling Algorithms

The system uses two scheduling strategies depending on the situation:

### 10.1 Backward Scheduling (Default for New Jobs)

**Goal:** Finish just before the due date with a buffer.

1. Start from due date minus 2 days (buffer)
2. Work backward, placing Assembly first
3. Then Polishing, Welding, Press Brake, Laser, Engineering
4. Find the earliest start date needed

**Used when:** Job is new and has time before due date.

### 10.2 Forward Scheduling (For Overdue/Tight Deadlines)

**Goal:** Start ASAP and push forward.

1. Start from TODAY (or job's current department)
2. Schedule each department in order: Engineering → Assembly
3. Calculate the earliest possible completion date

**Used when:**
- Job's calculated start date would be in the past
- Job is already overdue
- Job has been rescheduled from current department

### 10.3 Scheduling Strategy: Drum-Buffer-Rope

The system treats **Welding as the Heartbeat** (the Drum) of the production floor. This ensures all other work flows at a pace the primary constraint can handle:

1. **Schedule Welding First** — Jobs are allocated Welding slots based on due date and capacity
2. **Work Backwards** — Upstream departments (Engineering → Laser → Press Brake) are scheduled by subtracting work days from the Welding start date
3. **Work Forwards** — Downstream departments (Polishing → Assembly) are scheduled by adding work days to the Welding end date

### 10.4 Scheduling Priority Order

1. **All Big Rocks first** — Sorted by urgency score (highest first)
2. **All smaller jobs** — Sorted by urgency score, grouped by batch category

---

## 11. Handling Overdue Jobs

If a job's scheduled start date has already passed:

1. The system **reschedules from TODAY** (not the original date)
2. It starts from the job's **current department** (not Engineering)
3. The job is flagged as overdue (red due date)
4. Forward scheduling is used to find the soonest completion

---

## 12. Progress Tracking

Every time a new XLSX is imported, the system compares where each job **should be** vs. where it **actually is**:

| Status | Badge | Color | Meaning |
|--------|-------|-------|---------|
| **ON_TRACK** | (none) | — | Job is in the expected department |
| **AHEAD** | 🚀 | Green | Job has passed its expected department — great news! |
| **SLIPPING** | ⚠️ | Yellow | Job is behind schedule but moved recently |
| **STALLED** | OT? | Orange | Job is behind AND hasn't moved in 2+ days (may need overtime) |
| **Needs Reschedule** | 📅 | Purple (pulsing) | Due date changed — user should review |

### How Progress Status is Determined

1. System looks up the **expected department for today** from the original schedule
2. Compares to the **current department** from today's Global Shop import
3. Calculates the difference:
   - Current ahead of expected → **AHEAD** 🚀
   - Current behind expected + moved in last 2 days → **SLIPPING**
   - Current behind expected + no movement for 2+ days → **STALLED**

---

## 13. Due Date Change Detection

When Global Shop's due date for a job changes between imports:

| What Happens | Visual Indicator |
|--------------|-----------------|
| `dueDateChanged` flag set to `true` | — |
| `previousDueDate` stored for reference | — |
| `needsReschedule` flag set to `true` | — |
| **📅 Purple pulsing badge** appears on job | Visible on Planning Board |
| Alert shown in sync summary | After upload |
| Tooltip shows: "Was: [old date] → Now: [new date]" | On hover |

**Why this matters:** Due date changes from sales should trigger a schedule review. The system makes these changes impossible to miss.

---

## 14. The Planning Board (Interactive Gantt Chart)

The main view is an interactive Gantt chart that serves as the command center for production scheduling.

### 14.1 Unified Control Deck (Tactile Industrial UI)

The Planning Board header uses a **"Tactile Industrial"** design language — a two-tier control deck that organizes all scheduling controls into grouped "Islands" and "Wells" for intuitive access.

**Tier 1 — Navigation & Scope (Top Row):**
- **Identity Island:** "Planning" title with Urgency Scoring configuration button (sliders icon)
- **Department Well:** Toggle buttons for each of the 6 departments (click to show/hide)
- **Product Type Well:** FAB / Doors / Harmonic toggle filters
- **View Mode Toggle:** "All Jobs" vs. "Active" segmented control

**Tier 2 — Filters & Tools (Bottom Row):**
- **Search:** Filter by SO, WO, or Job Name (instant search)
- **Date Filter:** Toggle between "Due Date" and "Scheduled Date" modes with date range picker
- **Points Range:** Filter by min/max welding points
- **Split Prod:** Toggle capacity analytics split by product type
- **Big Rocks Only:** Filter to show only jobs ≥50 pts
- **New List:** Generate a new priority list for a single department (appears when viewing Active + single dept)
- **Tools Island:** Import CSV, Quote Estimator link, Export PDF, Zoom slider, Clear All

### 14.2 Left Panel (Job Cards)
- Job name (customer name from Global Shop)
- Work Order ID
- Job description (first line)
- Due date (red if overdue)
- Welding points badge
- Urgency score (visible on hover)
- Product type indicator
- Status badges (Ahead, Slipping, Stalled, Due Date Changed, No Gaps)

### 14.3 Right Panel (Timeline)
- **Multi-color department bars** showing when work is scheduled in each department
- **Crosshair hover** — hovering over any cell highlights the entire row AND column for easy tracking across the timeline
- **Drag-and-drop segments** — click and drag department bars to manually adjust scheduling dates
- **Resize handles** — drag the edges of department bars to extend or shorten durations
- **Segment edit popover** — click a bar segment to open a date editor for precise date adjustments
- Color coding by department:
  - 🔵 Engineering (blue)
  - 🟣 Laser (purple/orange)
  - 🟠 Press Brake (yellow/orange)
  - 🔴 Welding (red)
  - 🟢 Polishing (teal/green)
  - 🟡 Assembly (violet/purple)

### 14.4 Visual Indicators on Job Cards

| Indicator | Meaning | Action Needed |
|-----------|---------|---------------|
| Red **!** badge | Scheduling conflict — can't meet due date | Consider overtime or scope reduction |
| Orange **OT?** | Stalled 2+ days, behind schedule | May need overtime |
| Yellow **⚠** | Slipping behind schedule | Monitor closely |
| Green **🚀** | Ahead of schedule | Celebrate! |
| Purple **📅** (pulsing) | Due date changed | Review and possibly reschedule |
| Blue **⚡ No Gaps** | Gap override active | Job will move faster than normal |

### 14.5 Gantt Chart Features
- **Sticky headers** — Week and day headers remain visible while scrolling
- **Sticky job column** — Job cards stay visible while scrolling horizontally through dates
- **Today marker** — Current day highlighted with blue border
- **Saturday shading** — Saturday columns have subtle gray background
- **Zebra striping** — Alternating row backgrounds for readability
- **Zoom control** — Slider to adjust column width for different zoom levels
- **Date selection** — Click column headers to select dates for analysis

---

## 15. Supervisor Dashboard — Real-Time Shop Floor Feedback

The **Supervisor Dashboard** (`/supervisor`) is a dedicated interface for shop floor supervisors to report and track production blockers in real time. It feeds directly into the scheduling engine, informing Schedule Insights about real-world issues that data alone can't detect.

### 15.1 Purpose

Supervisors see problems before the data catches up — a machine goes down, material doesn't arrive, a welder calls out sick. The Supervisor Dashboard gives them a fast, structured way to report these issues so the plant manager and scheduling system can react immediately.

**Key Principle:** Supervisors **report** blockers. The plant manager handles all **reschedule decisions**.

### 15.2 How to Access

Navigate to `/supervisor` from the main application, or click the **Supervisor Console** link.

### 15.3 Dashboard Layout

**KPI Header (3 Cards):**

| Metric | What It Shows |
|--------|---------------|
| **Active Alerts** | Total open (unresolved) alerts across all departments |
| **Departments Affected** | How many of the 6 departments currently have at least 1 alert |
| **Blocked Points** | Total welding points tied up in jobs with active alerts |

**Department Status Grid:**

A 6-card grid showing each department's real-time health:
- Department name
- Number of active alerts
- Number of blocked jobs
- Total blocked welding points
- Top issue description (truncated)
- Green badge = healthy, amber badge = has alerts

**Active Alert Feed:**

A scrollable list of all open alerts, each showing:
- Work Order ID (clickable)
- Job name / customer
- Affected department
- Reason for delay (free-text)
- Estimated resolution date
- Business days blocked

### 15.4 Creating an Alert

Click **"Report Issue"** to open the alert creation modal:

| Field | Required | Description |
|-------|:---:|-------------|
| **Job** | ✓ | Search and select from all active jobs (by WO#, name, or description) |
| **Department** | ✓ | Which department is affected |
| **Reason** | ✓ | Free-text description of the issue (e.g., "Welder #3 out sick, can't start until Thursday") |
| **Est. Resolution Date** | ✓ | When the supervisor expects the issue to clear |
| **Reported By** | ✓ | Supervisor's name |

### 15.5 Alert Lifecycle

```
Created → Active → Resolved
              ↓
          Extended (new date)
              ↓
          Resolved
```

Available actions on active alerts:
- **Resolve** — Mark the issue as cleared
- **Extend** — Push the estimated resolution date further out
- **Update** — Edit the reason or reporter
- **Delete** — Remove the alert entirely

### 15.6 Impact on Scheduling

Active alerts are passed into the **Schedule Insights** engine. When alerts exist, the Insights panel shows an additional **Alert Impact** section:

| Data Point | Description |
|------------|-------------|
| **Blocked Job Count** | How many jobs are tied up by active alerts |
| **Blocked Points Total** | Total welding points affected |
| **By Department** | Points breakdown per department |
| **Available Capacity** | Remaining capacity in each department after subtracting blocked points |
| **Note** | Human-readable summary of the alert impact |

This means the system's overtime recommendations and move suggestions account for real-world issues that supervisors have flagged, not just the theoretical schedule.

---

## 16. Schedule Insights — Decision Support Panel

Click the **📊 Insights** button (chart icon) on the Planning Board toolbar to open the Schedule Insights panel.

### What It Shows

The panel analyzes the current schedule and presents **options, not orders** — the manager makes the final call.

#### Summary Pipeline

At the top, a 3-stage pipeline shows the projected outcome:

```
Current State   →   After Suggested Moves   →   After Moves + Overtime
   12 late              6 late                       0 late
```

#### Section 1: Late Jobs

Lists every job that will miss its due date, showing:
- Work Order ID and customer name
- Due date vs. estimated completion
- Days late and bottleneck department

#### Section 2: Overtime Recommendations

For each overloaded week, shows a recommended overtime tier:

| Tier | Schedule | Extra Capacity |
|------|----------|:-:|
| **Tier 1** | 9-Hour Days (Mon-Fri) | +106 pts/week |
| **Tier 2** | 10-Hour Days (Mon-Fri) | +213 pts/week |
| **Tier 3** | 9hr Days + Saturday 6am-12pm | +234 pts/week |
| **Tier 4** | 10hr Days + Saturday 6am-12pm | +341 pts/week |

The system recommends the **lowest tier** that covers each week's overload.

#### Section 3: Move Options

Suggests jobs that could be pushed +1 or +2 weeks to free up bottleneck capacity:

- **Work Order moves** — push a single job
- **Sales Order moves** — push an entire project's jobs together

Each option shows:
- Which late jobs it would recover
- Risk level (Safe = won't cause the moved job to be late)
- Points freed up
- Impact summary

**Hard rules:**
- Never pushes a job more than 2 weeks
- Never pushes a job that's already late
- Manager must decide which moves to apply

#### Section 4: Projected Outcome

Shows what the schedule would look like after moves and OT:
- Which jobs are still late (if any)
- Escalation flags for unfixable situations

---

## 17. Quote Estimator — Capacity-Aware Job Feasibility

The **Quote Estimator** is a simulation tool that answers: *"If a customer requests a new job worth $X, can we finish it — and by when?"* without modifying the live production schedule.

### 16.1 How to Access

Click the **Calculator icon** (🧮) in the Tools Island on the Planning Board, or navigate directly to `/quote-estimator`.

### 16.2 User Inputs

| Input | Description |
|-------|-------------|
| **Total Job Value ($)** | The full dollar value of the sales order |
| **Total Quantity** | How many individual items are in the order |
| **Big Rocks** | Optional. Individual high-value items with their own dollar values (e.g., a single $40,000 panel) |
| **REF Specialty** | Checkbox. Marks the job as a REF (refrigeration) specialty job |
| **Engineering Ready Date** | The date engineering drawings will be available |
| **Scheduling Mode** | `EARLIEST` (find soonest finish) or `TARGET` (check if a specific date is achievable) |
| **Target Date** | Only when mode = TARGET. The customer's requested delivery date |

### 16.3 Dollar-to-Points Conversion

The core conversion formula:

```
Points = round((Dollar Value / 650) × 10) / 10
```

**$650 = 1 Welding Point** — this is the fundamental conversion ratio.

Example: A $13,000 job → `round((13000 / 650) × 10) / 10` = **20.0 points**

#### Big Rock Decomposition

When Big Rocks are present:
```
Big Rock Points   = Σ convertDollarToPoints(each Big Rock $)
Remaining Value   = max(0, Total Job Value − Big Rock Value)
Remaining Points  = convertDollarToPoints(Remaining Value)
Total Points      = Big Rock Points + Remaining Points
```

If Total Points ≥ 50 → Job classified as **"Big Rock Class"**

### 16.4 Production Timeline Simulation (Pipeline Effect)

The Quote Estimator simulates a **flowing pipeline** where departments **overlap** — the next department can begin after ~25% of the current department's work is done:

```
For each department (1 to 6):
  duration = calculateDeptDuration(dept, totalPoints, productType)
  startDate = currentDate
  endDate = addWorkDays(startDate, ceil(duration) - 1)

  overlapDays = max(1, ceil(duration × 0.25))
  currentDate = addWorkDays(startDate, overlapDays)

Estimated Completion = endDate of Assembly (last department)
```

This pipeline effect means total job time is significantly shorter than the sum of individual department durations.

### 16.5 Three-Tier Feasibility Analysis

When a **Target Date** is specified, the system runs a 3-tier feasibility check:

**Tier 1 — "As-Is Schedule":**
Can this job fit into current capacity (850 pts/week) without changing anything?
- Scans existing shop floor load week-by-week
- Finds available capacity slots for each department
- Reports bottlenecks if any department is delayed

**Tier 2 — "Adaptive Re-routing" (With Job Moves):**
Can we make room by pushing back jobs that have ≥7 days of buffer?
- Identifies jobs in Engineering or Laser that have enough slack
- Proposes shifting them 7 workdays later
- Recalculates timeline with freed capacity

**Tier 3 — "Peak Overtime":**
Can we make the date with overtime (1,000 pts/week)?
- Applies a **0.85× duration multiplier** (15% faster across all departments)
- Tracks which calendar weeks would require overtime
- Only activates if Tiers 1 and 2 both failed

**Final Recommendation:**
```
Tier 1 passes → ACCEPT ("Can complete by X without changes")
Tier 2 passes → ACCEPT_WITH_MOVES ("Can complete by X by moving N jobs")
Tier 3 passes → ACCEPT_WITH_OT ("Can complete by X with overtime")
All fail      → DECLINE ("Cannot meet target date")
```

### 16.6 End-to-End Example

**Scenario:** Customer requests a $45,500 job, 8 items, engineering ready Feb 10, target date Mar 14.

**Step 1 — Points:** `round((45500 / 650) × 10) / 10` = **70.0 pts** → Big Rock Class

**Step 2 — Timeline (Pipeline):**

| Dept | Duration | Start | 25% Overlap | Next Dept Starts |
|------|----------|-------|:-:|-----------------|
| Engineering | 2 days | Feb 10 | 1 day | Feb 11 |
| Laser | 0.5 day | Feb 11 | 1 day | Feb 12 |
| Press Brake | 0.5 day | Feb 12 | 1 day | Feb 13 |
| Welding | 1 day | Feb 13 | 1 day | Feb 14 |
| Polishing | 1.5 days | Feb 14 | 1 day | Feb 17 (Mon) |
| Assembly | 1 day | Feb 17 | — | **Finish: Feb 17** |

**Estimated Completion: Feb 17** → Well before Mar 14 target. ✅ ACCEPT

---

## 18. Export Function

### Exporting the Schedule

Click **"Export"** on the Planning Board to download:

- **PDF export** of the current schedule
- Includes all visible jobs with their department timelines
- Can be filtered by date range, department, or job type

### What's Included in Exports

| Field | Description |
|-------|-------------|
| Job ID | Work Order number |
| Job Name | Customer name |
| Description | Product description |
| Due Date | Original due date from Global Shop |
| Welding Points | Complexity measure (DEPT4HRS) |
| Product Type | FAB, DOORS, or HARMONIC |
| Department Schedule | Start/end dates for each department |
| Status Flags | Overdue, conflict, stalled, etc. |

---

## 19. Complete Flow: First Import to Next Day

### Day 1: First Import (Monday Morning)

1. **Export XLSX from Global Shop** 
   - Contains all open work orders
   - System reads: WO#, Customer, Description, Due Date, DEPT4HRS (welding points), Current Dept

2. **Upload to Scheduler**
   - Drag & drop file onto Upload page
   - System parses and groups by Work Order Number

3. **Parsing & Filtering**
   - Jobs must have welding points > 0
   - Jobs must have valid due date
   - Product type determined from WO# prefix (D=DOORS, H=HARMONIC, else FAB)

4. **HARMONIC Painting Prompt**
   - System detects HARMONIC jobs and shows painting selection modal
   - User selects which HARMONIC jobs require off-site painting
   - Flagged jobs receive +8–9 day Assembly extension and +15 urgency points

5. **Customer Multiplier Detection**
   - System checks customer names against configured multipliers (e.g., GERMFREE)
   - Matching jobs receive adjusted durations automatically

6. **Urgency Scoring**
   - Each job scored on 8 factors + custom factors
   - FastShip, REF, Harmonic, Painting bonuses applied if applicable
   - FastShip + Due Date Proximity capped at 40 combined

7. **Batching Analysis**
   - Descriptions scanned for all 8 batch categories
   - Matching jobs grouped by gauge/material/due week
   - Batched jobs receive 10-15% efficiency discount

8. **Big Rocks Scheduled First**
   - All jobs ≥50 pts sorted by urgency score
   - Scheduled using backward scheduling from due date
   - 70/30 rule enforced (max 70% capacity to big rocks)

9. **Smaller Jobs Scheduled**
   - Remaining jobs sorted by urgency, then batched
   - Fill gaps around big rocks
   - Batched jobs scheduled consecutively

10. **Results Saved**
    - All jobs written to Firebase
    - Planning Board updated in real-time

### Day 2: Daily Sync (Tuesday Morning)

1. **Export new XLSX from Global Shop**

2. **Upload to Scheduler**

3. **System Compares to Yesterday:**
   - **New jobs** (new WO#s) → Scheduled with remaining capacity
   - **Existing jobs** → Schedule PRESERVED, progress tracked
   - **Missing jobs** (WO# not in file) → Marked COMPLETED

4. **Progress Tracking:**
   - Current department compared to expected department
   - Status updated: ON_TRACK, AHEAD, SLIPPING, or STALLED

5. **Due Date Change Detection:**
   - Today's due date vs. yesterday's due date
   - If different → Flag job with 📅, store previous date

6. **Sync Summary Displayed:**
   ```
   ✅ Sync Complete!
   
   📊 Job Summary:
     • 5 new jobs scheduled
     • 42 existing jobs updated
     • 3 jobs marked complete
   
   📅 Due Date Changes (2 jobs):
     ⚠️ WO-12345: 2/10 → 2/15
     ⚠️ WO-12346: 2/12 → 2/8
     → Go to Planning Board to reschedule
   
   🚀 Ahead of Schedule (1 job):
     ✨ WO-12347 (now in Welding)
   ```

7. **Review Planning Board**
   - Stalled jobs show OT? badge
   - Due date changes show 📅 badge
   - Click "No Gaps" for any rush jobs
   - Use Schedule Insights for overtime/move recommendations

8. **Export if Needed**
   - Download PDF for distribution or printing

---

## 20. Key Benefits Summary

| Before | After |
|--------|-------|
| Manual scheduling in spreadsheets | Automated, optimized scheduling |
| No visibility into capacity | Weekly capacity pool tracked automatically |
| Due date changes missed | Automatic detection with visual alerts |
| Overdue jobs discovered late | Early warning via progress status badges |
| Big jobs block small ones | 70/30 rule ensures balanced flow |
| Similar jobs scattered | Intelligent batching by material/gauge with efficiency discounts |
| FastShip/REF/Harmonic treated equally | Priority bonuses ensure proper handling |
| No urgency transparency | Urgency scores visible with factor breakdown |
| Quote estimates done manually | Quote Estimator runs capacity simulation in real-time |
| Customer exceptions tracked in heads | Customer multiplier system adjusts automatically |
| No decision support | Schedule Insights panel provides actionable recommendations |
| Shop floor issues communicated verbally | Supervisor Dashboard captures blockers in real-time, feeds into scheduling |

---

## 21. Technical Details (For Reference)

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16 (React 19) |
| Styling | Tailwind CSS v4 |
| Database | Firebase Firestore |
| Hosting | Firebase Hosting |
| Data Import | XLSX parsing (SheetJS — Global Shop format) |
| Authentication | Firebase Auth |
| Real-time Updates | Firestore subscriptions |
| Export | PDF generation |
| Design Language | Monochrome Industrial / Tactile Industrial |

### Key Configuration Values

| Setting | Value | Description |
|---------|-------|-------------|
| Weekly Capacity (Normal) | 850 pts/week | Per department |
| Weekly Capacity (OT) | 1,000 pts/week | Per department with overtime |
| Dollar-to-Point Ratio | $650 = 1 pt | Universal conversion |
| Big Rock Threshold | ≥50 pts | Jobs this size get special handling |
| Small Job Threshold | ≤7 pts | No gaps between departments |
| Buffer Days | 2 days | Finish before due date |
| Stall Detection | 2 days | No movement triggers STALLED status |
| FastShip Bonus | 25 pts | Highest urgency bonus |
| Due Date Proximity Max | 30 pts | For jobs due within 5 days |
| FastShip + Due Date Cap | 40 pts | Combined maximum |
| Painting Required Bonus | 15 pts | For HARMONIC painting jobs |
| Big Rock Bonus | 10 pts | For jobs ≥50 pts |
| REF Job Bonus | 10 pts | For refrigeration speciality |
| Harmonic Bonus | 10 pts | For HARMONIC product type |
| Batch Efficiency (2 items) | 10% | Time reduction for batched pairs |
| Batch Efficiency (3+ items) | 15% | Time reduction for larger batches |
| Assembly Multiplier | 1.25× | Duration increase for Assembly |
| NYCHA Welding Minimum | 3 days | For NYCHA-named jobs |
| Door Leaf Welding Minimum | 2 days | For door (not frame) jobs |
| HARMONIC Paint Extension | +8–9 days | 5 paint + 3–4 post-paint |
| GERMFREE Output Multiplier | 0.80× | 20% longer durations |
| GERMFREE Engineering Cap | 1 day | Max Engineering duration |
| OT Speed Factor | 0.85× | 15% faster under overtime |
| Pipeline Overlap | 25% | Next dept starts after 25% of current |

---

## 22. February 2026 Updates Summary

**Version 7.3.0 — Released February 7, 2026**

| Feature | Description |
|---------|-------------|
| **NYCHA 3-Day Welding Minimum** | Jobs with "NYCHA" in name guaranteed minimum 3 days in Welding, regardless of point value |
| **HARMONIC Painting Extension** | Import-time painting prompt; +5 days painting + 3–4 days post-paint = 8–9 days added to Assembly |
| **Painting Scoring Bonus** | +15 urgency points for jobs flagged as requiring painting |
| **Customer Multiplier System** | Per-customer scheduling adjustments (GERMFREE: 0.80× output, 1-day Engineering cap) |
| **Batch Efficiency Discounts** | 10% time savings for 2 batched items, 15% for 3+ items |
| **Expanded Batch Categories** | Added Wall Panel, Dish Table, 3-Compartment Sink, Wall Shelf, Corner Guard |
| **FastShip + Due Date Cap** | Combined FastShip + Due Date Proximity capped at 40 pts to prevent Priority Inflation |
| **Tactile Industrial UI** | Planning Board redesigned with 2-tier Unified Control Deck layout |
| **Gantt Drag & Drop** | Department bar segments can be dragged to adjust dates, with resize handles on edges |
| **Crosshair Hover** | Full row + column highlight when hovering over any Gantt cell |
| **Scoring Configuration UI** | Live configuration panel for all urgency scoring weights and custom factors |
| **Quote Estimator** | Full capacity-aware simulation tool with $650/pt conversion and 3-tier feasibility |
| **Schedule Insights v2** | Enhanced decision support with overtime tiers, job movement suggestions, and projected outcomes |
| **Supervisor Dashboard** | Real-time shop floor feedback system — supervisors report blockers, system adjusts insights |
| **Gantt Row Optimization** | Rows no longer stretch vertically when fewer jobs are displayed |
| **Analytics Panel Fix** | Vertical scrollbar remains visible when Department Analytics panel is open |

### Previous Version History

| Version | Date | Changes |
|---------|------|---------|
| **v7.2.8** | Feb 5, 2026 | Original executive overview document |
| **v7.2.0** | Feb 3, 2026 | Product-type resource pools, urgency scoring engine |
| **v7.1.0** | Jan 2026 | Interactive Gantt, capacity heatmaps, bottleneck detection |

---

**Questions?** Contact the development team for demonstrations or additional training.

**Document Version:** 4.0 (Complete System Reference)  
**Last Updated:** February 7, 2026
