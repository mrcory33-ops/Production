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
5. **Exports reports** for analysis and record-keeping

The system replaces manual scheduling with data-driven decisions, ensuring that:
- Big jobs get prioritized appropriately
- Departments don't get overloaded
- Due dates are met whenever possible
- Problems are visible before they become critical

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

**Formula:**
```
Duration (days) = Welding Points ÷ Daily Output
Daily Output = Workers per Project × Output per Worker/Day
```

#### Worker Pool Configuration

| Department | Workers per Project | Output per Worker/Day | Effective Daily Output | Multiplier |
|------------|--------------------|-----------------------|------------------------|------------|
| **Engineering** | 1 | 22 pts | 22 pts/day | — |
| **Laser** | 2 | 67.5 pts | 135 pts/day | — |
| **Press Brake** | 4 | 33 pts | 132 pts/day | — |
| **Welding** | 3 | 15 pts | 45 pts/day | — |
| **Polishing** | 3 | 18 pts | 54 pts/day | — |
| **Assembly** | 3 | 16 pts | 48 pts/day | **×1.25** |

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

#### Special Rules

1. **Assembly has a 1.25× time multiplier** — takes 25% longer than formula suggests
2. **Door Leaf jobs** (description contains "door" but not "frame") — minimum 2 days in Welding
3. **Results round up to nearest half-day** — 2.22 becomes 2.5, not 2

#### Why "Workers per Project" Matters

- **Engineering** (1 worker max): Only 1 engineer can work on any single job, so a 100pt job takes longer
- **Press Brake** (4 workers max): Up to 4 operators can work on one job, processing faster
- **Welding** (3 workers max): Balanced for quality — too many welders causes coordination issues


---

## 4. Urgency Scoring (Complete Breakdown)

Every job receives an **Urgency Score** (0–100+) that determines its scheduling priority. The score is calculated from **7 built-in factors** plus any **custom factors** you define.

### 4.1 Built-In Scoring Factors

| # | Factor | Max Points | Trigger Condition | Description |
|---|--------|------------|-------------------|-------------|
| 1 | **Due Date Proximity** | 30 pts | Always active | Jobs due within 5 days get maximum points. Score scales down for jobs with more time. |
| 2 | **FastShip** | 25 pts | `fastShip = true` | Jobs flagged as "Fast Ship" in Global Shop get a 25-point bonus. This is the highest single bonus. |
| 3 | **Slippage Risk** | 20 pts | Current dept behind expected | If a job is in Laser but should be in Welding, it gets 5 points per department of lag. |
| 4 | **Stall Penalty** | 15 pts | No movement for 2+ days | If a job hasn't moved departments in 2+ days AND is behind schedule, it gets 5 points per day stalled. |
| 5 | **Big Rock** | 10 pts | weldingPoints ≥ 50 | Large jobs get a priority boost to ensure they start on time. |
| 6 | **REF Job** | 10 pts | Description contains "REF" | Refrigeration/specialty jobs get a 10-point bonus. |
| 7 | **Harmonic** | 10 pts | productType = "HARMONIC" | Harmonic product type jobs (Work Order starts with "H") get a 10-point bonus. |

### 4.2 Score Calculation Example

A job with:
- Due in 3 days → **30 pts** (Due Date Proximity)
- FastShip flag → **25 pts**
- 60 welding points → **10 pts** (Big Rock)
- Description: "REF Frame" → **10 pts** (REF Job)

**Total Urgency Score: 75 points**

This job would be scheduled before a job with only 40 points.

### 4.3 Custom Factors

The system supports user-defined scoring factors. Each custom factor can:
- Match text in the job description, notes, or name
- Add a bonus point value when matched
- Be enabled/disabled individually

---

## 5. Product Types

Jobs are classified into three product types based on the Work Order number prefix:

| Prefix | Product Type | Symbol | Department Pools |
|--------|-------------|--------|------------------|
| D | DOORS | 🚪 | Uses DOORS-specific capacity pools |
| H | HARMONIC | 〰️ | Uses HARMONIC-specific capacity pools |
| All others | FAB | 🏭 | Uses general FAB capacity pools |

This classification affects:
- Which capacity pool a job draws from
- Whether the Harmonic urgency bonus applies
- Analytics and reporting breakdowns

---

## 6. Job Size Classification

| Size Class | Welding Points | Scheduling Priority | Gap Between Departments |
|------------|----------------|---------------------|------------------------|
| **Big Rock** | ≥ 50 pts | Scheduled FIRST — these anchor the week | 1 full day |
| **Medium** | 8–49 pts | Scheduled after big rocks | 0.5 days (half day) |
| **Small** | ≤ 7 pts | Batched together to fill gaps | No gap (same-day handoff OK) |

### Why Big Rocks Come First

Big Rock jobs take multiple days per department and consume significant capacity. By scheduling them first, the system:
1. Ensures they meet their due dates
2. Places them optimally to avoid conflicts with each other
3. Allows smaller jobs to fill the gaps around them

---

## 7. Batching Logic (Similar Jobs Grouped Together)

The scheduler groups similar jobs together to improve production efficiency. Jobs are batched based on their **description text** matching specific patterns.

### 7.1 Batch Categories

| Category | Description Patterns (Any Match) |
|----------|-----------------------------------|
| **Frame Knock Down** | "frame knock down", "frames knock down", "frame knockdown", "frame kd", "frames kd", "kd frame", "knock down frame" |
| **Frame Case Opening** | "frame case opening", "frames case opening", "case opening frame", "frame co", "frames co" |
| **Door Lock Seam** | "door lock seam", "doors lock seam", "lock seam door", "lock seam doors" |

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

### 7.3 Material Detection

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

### 7.4 Gauge Detection

The system looks for gauge patterns like:
- "16 ga", "16ga", "16 gage"
- "#16", "# 16"

### 7.5 Batching Example

Given these jobs:
1. "Frame Knock Down 16ga SS304" due Feb 10
2. "Frame Knock Down 16ga SS304" due Feb 12
3. "Frame Knock Down 18ga Galv" due Feb 11
4. "Frame Case Opening" due Feb 10

**Result:**
- Jobs 1 & 2 → Same batch (FRAME_KD, 16ga, SS304, same week)
- Job 3 → Separate batch (different gauge/material)
- Job 4 → Separate batch (different category)

Jobs 1 & 2 will be scheduled consecutively to maximize efficiency.

---

## 8. Capacity Management

### 8.1 Weekly Capacity Pool

Each department has a **weekly budget of 850 points** (adjustable).

| Day | Example Load | Running Total |
|-----|--------------|---------------|
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

Each department has multiple capacity pools for different product types:

**Example: Welding Department**
- Pool 1: FAB + HARMONIC products
- Pool 2: DOORS products

This prevents one product type from completely blocking another.

---

## 9. Department Gaps (Buffer Time)

Jobs don't move instantly between departments. The scheduler inserts realistic gaps:

| Job Size | Gap Between Departments | Rationale |
|----------|------------------------|-----------|
| Big Rock (≥50 pts) | 1 day | Large jobs need material staging and setup time |
| Medium (8-49 pts) | 0.5 days (half day) | Moderate setup requirements |
| Small (≤7 pts) | No gap | Can be handed off same-day |

### "No Gaps" Override

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

### 10.3 Scheduling Priority Order

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

## 14. The Planning Board (Gantt Chart)

The main view is an interactive Gantt chart showing:

### Left Panel (Job Cards)
- Job name (customer name from Global Shop)
- Work Order ID
- Job description (first line)
- Due date (red if overdue)
- Welding points
- Urgency score (visible on hover)

### Right Panel (Timeline)
- Department bars showing when work is scheduled
- Color coding by department:
  - 🔵 Engineering (blue)
  - 🟣 Laser (purple)
  - 🟠 Press Brake (orange)
  - 🔴 Welding (red)
  - 🟢 Polishing (green)
  - 🟡 Assembly (yellow)

### Visual Indicators on Job Cards

| Indicator | Meaning | Action Needed |
|-----------|---------|---------------|
| Red **!** badge | Scheduling conflict — can't meet due date | Consider overtime or scope reduction |
| Orange **OT?** | Stalled 2+ days, behind schedule | May need overtime |
| Yellow **⚠** | Slipping behind schedule | Monitor closely |
| Green **🚀** | Ahead of schedule | Celebrate! |
| Purple **📅** (pulsing) | Due date changed | Review and possibly reschedule |
| Blue **⚡ No Gaps** | Gap override active | Job will move faster than normal |

---

## 14.5. Schedule Insights — Decision Support Panel

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
|------|----------|----------------|
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

## 15. Export Function

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

## 16. Complete Flow: First Import to Next Day

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

4. **Urgency Scoring**
   - Each job scored on 7 factors + custom factors
   - FastShip, REF, Harmonic bonuses applied if applicable

5. **Batching Analysis**
   - Descriptions scanned for Frame KD, Frame CO, Door Lock Seam patterns
   - Matching jobs grouped by gauge/material/due week

6. **Big Rocks Scheduled First**
   - All jobs ≥50 pts sorted by urgency score
   - Scheduled using backward scheduling from due date
   - 70/30 rule enforced (max 70% capacity to big rocks)

7. **Smaller Jobs Scheduled**
   - Remaining jobs sorted by urgency, then batched
   - Fill gaps around big rocks
   - Batched jobs scheduled consecutively

8. **Results Saved**
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

8. **Export if Needed**
   - Download PDF for distribution or printing

---

## 17. Key Benefits Summary

| Before | After |
|--------|-------|
| Manual scheduling in spreadsheets | Automated, optimized scheduling |
| No visibility into capacity | Weekly capacity pool tracked automatically |
| Due date changes missed | Automatic detection with visual alerts |
| Overdue jobs discovered late | Early warning via progress status badges |
| Big jobs block small ones | 70/30 rule ensures balanced flow |
| Similar jobs scattered | Intelligent batching by material/gauge |
| FastShip/REF/Harmonic treated equally | Priority bonuses ensure proper handling |
| No urgency transparency | Urgency scores visible with factor breakdown |

---

## 18. Technical Details (For Reference)

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 16 (React) |
| Database | Firebase Firestore |
| Hosting | Firebase Hosting |
| Data Import | XLSX parsing (Global Shop format) |
| Authentication | Firebase Auth |
| Real-time Updates | Firestore subscriptions |
| Export | PDF generation |

### Key Configuration Values

| Setting | Value | Description |
|---------|-------|-------------|
| Weekly Capacity | 850 pts/week | Per department |
| Big Rock Threshold | ≥50 pts | Jobs this size get special handling |
| Small Job Threshold | ≤7 pts | No gaps between departments |
| Buffer Days | 2 days | Finish before due date |
| Stall Detection | 2 days | No movement triggers STALLED status |
| FastShip Bonus | 25 pts | Highest urgency bonus |
| Due Date Proximity Max | 30 pts | For jobs due within 5 days |

---

**Questions?** Contact the development team for demonstrations or additional training.

**Document Version:** 3.0 (Schedule Insights v2 added)  
**Last Updated:** February 7, 2026
