# Scheduling Engine — Design Document

> **Version:** 2.1 — Weekly-Capacity Model + Schedule Insights v2  
> **Last Updated:** February 7, 2026  
> **Status:** Production

---

## Overview

The scheduling engine assigns production work across 6 sequential departments to maximize utilization while meeting due dates. The engine operates on a **weekly capacity model** — the primary unit of scheduling is the **week**, not individual days.

### Core Principles (in priority order)
1. **Maximize utilization** — Every department should run at or near capacity every week (850 pts/week target). Idle weeks are waste.
2. **Never miss due dates** — No scheduling decision should push a job past its due date (exception: jobs already past due on import).

### Department Pipeline
All jobs flow through departments in this fixed order:
```
Engineering → Laser → Press Brake → Welding → Polishing → Assembly
```
Each department must complete before the next can begin.

---

## Unit of Measure: The Week

| Metric | Value | Notes |
|--------|-------|-------|
| **Weekly Target** | 850 pts/dept | The primary scheduling constraint |
| **Daily Capacity** | ~170-200 pts/dept | Soft guideline, varies by department |
| **Work Week** | Monday–Friday | Weekends excluded (Saturday available with overtime) |

**Important:** The Gantt chart shows day-level start/end dates for visual clarity, but these represent "this work happens during this week." The shop floor determines exact daily sequencing.

---

## The 4-Phase Pipeline

### Phase 1: Ideal Placement (No Capacity Awareness)

**Goal:** Place every job at its mathematically ideal position.

**Process:**
1. Calculate durations for each department using `calculateDeptDuration()`
2. **On-time jobs:** Schedule backward from due date
   - Assembly ends 2 business days before due date (buffer)
   - Each preceding department ends where the next one starts
   - Departments are packed sequentially with no gaps
3. **Overdue jobs** (due date < today): Schedule forward from today
   - Start from the job's current department
   - Pack departments forward sequentially

**Result:** Every job has ideal start/end dates. No capacity checking — days/weeks may be wildly overloaded. That's fine, Phase 3 fixes it.

---

### Phase 2: Capacity Audit (Read-Only Analysis)

**Goal:** Identify which weeks are over-capacity and which are under-capacity.

**Process:**
1. For each department, sum all scheduled points per week (Mon–Fri)
2. Compare each week's total to the 850-pt target
3. Track pool-specific loads (FAB vs DOORS) for routing visibility

**Output:** A capacity map showing:
- 🔴 Over-capacity weeks (>850 pts) — work needs to move OUT
- 🟡 Near-capacity weeks (750–850 pts) — healthy
- 🟢 Under-capacity weeks (<750 pts) — room to absorb more work

---

### Phase 3: Compression (The Optimizer)

**Goal:** Redistribute work so every week is as close to 850 pts as possible, without missing due dates.

#### 3a. Identify Moveable Jobs

Each job has a **scheduling window**:
- **Earliest start:** Today (can't schedule in the past)
- **Latest finish:** Due date (hard constraint)
- **Slack:** The difference between the earliest possible start and where the job is currently placed. More slack = more flexibility to move.

Jobs are classified by flexibility:
- **High slack** (2+ weeks of room): Very flexible, can float to wherever they're needed
- **Low slack** (<1 week of room): Should stay near their ideal position
- **Zero slack** (tight deadline): Locked in place, don't move

#### 3b. Resolve Over-Capacity Weeks

For each over-capacity week (processing the most overloaded first):
1. Identify jobs in that week with the **most slack**
2. Move those jobs to the nearest **under-capacity week** (prefer earlier weeks)
3. When moving a job, shift **all its departments** by the same amount to keep them packed
4. Re-check: did the move fix the overload without creating a new one?

#### 3c. Fill Under-Capacity Weeks

For remaining under-capacity weeks:
1. Look for flexible jobs in adjacent weeks that could be pulled in
2. Pull them earlier to fill the gap
3. Respect the 70/30 split:
   - **Big rocks** (≥70 pts): Get priority, fill up to 70% of weekly capacity (~595 pts)
   - **Small/medium jobs** (<70 pts): Fill the remaining 30% (~255 pts)

#### 3d. Batching Optimization

Within each week, group compatible jobs together:
- Same **product type** (FAB, DOORS, HARMONIC)
- Same **gauge** and **material** when possible
- Jobs in the same batch get efficiency discounts:
  - 2-item batch: 10% point reduction
  - 3+ item batch: 15% point reduction

#### 3e. Pool Routing (Soft Constraint)

Departments with split pools (Welding, Polishing):
- **Preferred:** Route jobs to their product-specific pool (FAB → Pool 2, DOORS → Pool 1)
- **Fallback:** If one pool is underutilized and the other is overloaded, allow cross-pool scheduling
- **Hard limit:** Department total must not exceed 850/week regardless of pool split

---

### Phase 4: Validation Sweep

**Goal:** Confirm the schedule is valid after compression.

**Checks:**
1. ✅ All departments for each job are in sequential order
2. ✅ No job's last department ends after its due date (except already-overdue jobs)
3. ✅ No week exceeds 850 pts in any department
4. ⚠️ Flag any jobs that couldn't be scheduled without conflict

**If a violation is found:** Roll back that specific job's compression move and flag it for manual review.

---

## Subsequent Daily Imports

### The Frozen Zone Model

| Zone | Timeframe | Rule |
|------|-----------|------|
| **Frozen** | Current week + next week (2 weeks) | Existing jobs don't move. Shop floor is committed. |
| **Flexible** | Week 3 onward | Full re-optimization with Phase 3 compression. |

### Daily Import Process

1. **Parse new XLSX** — identify new, updated, progressed, and completed jobs
2. **Update job statuses** — mark departments as DONE per the ERP data
3. **Lock frozen zone** — existing jobs in the next 2 weeks keep their current schedule. Their capacity is pre-reserved in the buckets.
4. **Handle completed jobs** — remove from schedule, free their capacity
5. **Place new jobs** (Phase 1):
   - New jobs with due dates in the frozen zone: place at ideal position (don't move existing jobs)
   - New jobs with due dates in the flexible zone: place at ideal position
6. **Re-run Phase 2-4** for the flexible zone only:
   - Capacity audit from week 3 onward
   - Compress/optimize the flexible zone
   - Validate no due dates missed
7. **Flag frozen zone conflicts** — if new jobs create overloads in the frozen zone, flag as ⚠️ "Capacity Risk" for the manager

### What the Frozen Zone Protects
- Existing job schedules within the next 2 weeks are **never moved** by the optimizer
- This gives the shop floor stability and predictability
- Manual overrides made by managers in the frozen zone are preserved

### What the Frozen Zone Does NOT Block
- New jobs can still be **placed** in the frozen zone (they just don't shuffle existing work)
- Jobs that **progress** (departments complete) are updated with the new ERP status
- Jobs that are **completed** are removed

---

## Special Business Rules

### Customer-Specific: Germfree Laboratories
- **Output multiplier:** 0.80× (jobs take 25% longer) in all departments except Engineering
- **Engineering cap:** Maximum 1 day regardless of points
- **Detection:** `Name_Customer` column contains "GERMFREE" (case-insensitive)

### Product-Specific: Door Leaf Minimum
- **Rule:** Minimum 2 days in Welding for door leaf assemblies
- **Detection:** `productType === 'DOORS'` and description implies leaf (not frame)

### Product-Specific: NYCHA Projects
- **Rule:** Minimum 3 days in Welding
- **Detection:** Job name contains "NYCHA"

### Product-Specific: Harmonic Painting
- **Rule:** Assembly extended by 8-9 days (5 days painting + 3-4 days post-paint)
- **Detection:** `productType === 'HARMONIC'` and `requiresPainting === true`

### Batch Efficiency
- **2-item batch:** 10% effective point reduction
- **3+ item batch:** 15% effective point reduction
- **Grouping key:** Same product type + gauge + material + due week

---

## Data Flow

```
XLSX File
    ↓
Parser (lib/parser.ts)
    ↓ Job[] with durations, customer, product type
Scheduler Pipeline (lib/scheduler.ts)
    ├── Phase 1: idealPlacement()
    ├── Phase 2: capacityAudit()
    ├── Phase 3: compress()
    ├── Phase 4: validate()
    └── Phase 5: analyzeSchedule()   ← NEW
    ↓ Job[] with final schedules + ScheduleInsights
Database Sync (lib/jobs.ts)
    ↓
Firestore → Gantt Chart UI + Schedule Insights Panel
```

---

## Configuration Reference

### Weekly Targets (per department)
| Department | Weekly Target | Daily Capacity | Workers | Output/Worker/Day |
|------------|--------------|----------------|---------|-------------------|
| Engineering | 850 | 198 | 9 | 22 |
| Laser | 850 | 202.5 | 3 | 67.5 |
| Press Brake | 850 | 198 | 6 | 33 |
| Welding | 850 | 195 | 13 (split) | 15 |
| Polishing | 850 | 198 | 11 (split) | 18 |
| Assembly | 850 | 192 | 12 | 16 |

### Scheduler Constants
| Constant | Value | Description |
|----------|-------|-------------|
| `BUFFER_DAYS` | 2 | Days before due date to finish Assembly |
| `BIG_ROCK_THRESHOLD` | 70 pts | Jobs above this are "big rocks" |
| `BIG_ROCK_RATIO` | 0.70 | 70% of weekly capacity reserved for big rocks |
| `SMALL_ROCK_RATIO` | 0.30 | 30% of weekly capacity for smaller jobs |
| `FROZEN_WEEKS` | 2 | Number of weeks locked from re-optimization |
| `WEEKLY_TARGET` | 850 | Points per department per week |
| `BATCH_DISCOUNT_2` | 0.90 | 10% discount for 2-item batches |
| `BATCH_DISCOUNT_3PLUS` | 0.85 | 15% discount for 3+ item batches |

---

## Fine-Tuning Guide

### Jobs Finishing Too Early

**Symptoms:** Jobs complete well before due date, resources idle in later weeks

**Solutions:**
1. Reduce `BUFFER_DAYS` (currently 2)
2. Increase `WEEKLY_TARGET` if realistic for the department
3. Check if `outputPerDay` values are too conservative — Phase 3 may not have enough room to compress

---

### Jobs Finishing Late / Conflicts

**Symptoms:** `schedulingConflict: true`, jobs flagged after Phase 4 validation

**Solutions:**
1. Increase `BUFFER_DAYS` for more cushion
2. Add workers to bottleneck departments (Welding usually)
3. Increase `WEEKLY_TARGET` if capacity genuinely exists
4. Enable overtime mode for Saturday capacity

---

### Welding Bottleneck Too Tight

**Symptoms:** Most Phase 2 overloads occur in Welding weeks

**Solutions:**
1. Add workers: increase `pools[].count` in `departmentConfig.ts`
2. Improve per-worker output: increase `outputPerDay`
3. Allow more workers per project: increase `maxPerProject`
4. Review product split — are too many FAB jobs competing for Pool 2?

---

### Overtime Mode — 4-Tier Recommendation System

**Location:** `lib/scheduler.ts` → `analyzeSchedule()` → OT Recommendations

The Schedule Insights engine uses a detailed 4-tier overtime model based on real shop-floor hours:

| Tier | Label | Schedule | Bonus Pts/Week | Description |
|------|-------|----------|----------------|-------------|
| **Tier 1** | 9-Hour Days | Mon-Fri 6am-3pm | +106 pts | 1 extra hour/day × 5 days |
| **Tier 2** | 10-Hour Days | Mon-Fri 6am-4pm | +213 pts | 2 extra hours/day × 5 days |
| **Tier 3** | 9hr + Saturday | Mon-Fri 6am-3pm, Sat 6am-12pm | +234 pts | 1hr extra weekdays + 6hr Saturday |
| **Tier 4** | 10hr + Saturday | Mon-Fri 6am-4pm, Sat 6am-12pm | +341 pts | 2hr extra weekdays + 6hr Saturday |

**Capacity math:**
- Base: 8hr days × 5 days = 40hr/week → 850 pts
- Points per hour: 850 ÷ 40 = **21.25 pts/hr**
- Saturday (6am-12pm): 6 hrs × 21.25 = **127.5 pts**

The system recommends the lowest tier that covers each overloaded week's excess points.

**Important:** These are *recommendations*, not automatic changes. The manager reviews the OT needs per week and decides whether to authorize.

---

## Troubleshooting

### Q: Why is my job showing a scheduling conflict?

**A:** Phase 3 couldn't find a week to place it without either exceeding 850 pts or missing the due date. Options:
- Check if the due date is realistic given current load
- Increase department capacities
- Authorize overtime for overloaded weeks

---

### Q: Why is there a gap between two departments?

**A:** In the new scheduler, gaps mean the next department's week didn't have room, so the job was split across non-adjacent weeks. Phase 3 compression should minimize this, but with heavy loads it can happen. The Gantt shows the assigned weeks — the shop floor fills in the actual days.

---

### Q: How do I see what capacity is being used per week?

**A:** The Dept. Analytics sidebar on the Gantt chart shows weekly averages. For detailed per-week breakdowns, check the Phase 2 capacity audit output in the console (when debug logging is enabled).

---

### Q: Can I schedule departments in parallel?

**A:** Not currently. The flow is strictly sequential. Parallel scheduling would require significant algorithm changes.

---

### Q: How are weekends handled?

**A:**
- **Default:** Saturdays and Sundays skipped
- **Overtime:** Sundays skipped, Saturdays at half capacity

---

## Quick Reference Cheat Sheet

| Want to... | Adjust... | Location |
|------------|-----------|----------|
| Add buffer before due date | `BUFFER_DAYS` | scheduler.ts |
| Change dept output | `outputPerDay` | departmentConfig.ts |
| Add workers | `pools[].count` | departmentConfig.ts |
| Change weekly target | `WEEKLY_TARGET` | scheduler.ts |
| Change frozen zone length | `FROZEN_WEEKS` | scheduler.ts |
| Slow down a dept | `timeMultiplier` | departmentConfig.ts |
| Enable Saturday work | `setOvertimeConfig()` | scheduler.ts |
| Adjust batch discounts | `BATCH_DISCOUNT_2` / `BATCH_DISCOUNT_3PLUS` | departmentConfig.ts |
| Adjust big/small rock split | `BIG_ROCK_RATIO` / `SMALL_ROCK_RATIO` | scheduler.ts |

---

## Schedule Insights v2 — Decision-Support Engine

> **Added:** February 7, 2026  
> **Location:** `lib/scheduler.ts` → `analyzeSchedule()` + `components/ScheduleInsightsPanel.tsx`

The Schedule Insights system runs as **Phase 5** of the pipeline. It analyzes the finalized schedule and produces actionable recommendations. It does NOT auto-apply changes — it presents options and projected outcomes so the manager can decide.

### What It Analyzes

1. **Late Jobs** — Jobs whose estimated completion dates exceed their due dates
2. **Overloaded Weeks** — Weeks where any department exceeds 850 pts capacity
3. **Move Options** — Jobs that could be pushed +1 or +2 weeks to relieve bottleneck weeks
4. **OT Recommendations** — 4-tier overtime suggestions per overloaded week
5. **Projected Outcomes** — "What if" results: after applying moves, and after moves + OT

### Move Options Logic

The system generates two types of moves:

| Type | What Moves | When Used |
|------|-----------|----------|
| **Work Order (WO)** | Single job pushed +1wk or +2wk | Surgical fix for specific bottlenecks |
| **Sales Order (SO)** | All jobs sharing the same SO pushed together | Project-level relief for multi-job orders |

**Selection criteria:**
- Only **non-late** jobs are considered for moves (we don't push already-late work further)
- Moves must not cause the moved job to become late (`riskLevel: 'safe'` or `'moderate'`)
- **Max push: 2 weeks** — the system will NEVER suggest moving a job more than 2 weeks
- Moves are scored by how many **currently late jobs they recover** globally

### Projected Outcomes

The panel shows a 3-stage pipeline:

```
Current State → After Suggested Moves → After Moves + OT
   12 late         6 late                 0 late
```

Each stage shows:
- Number of late jobs
- Which specific jobs are still late
- Bottleneck departments for remaining late jobs

If jobs remain late even after Tier 4 OT, the panel flags them as **escalation needed**.

### OT Recommendation Details

Each overloaded week gets a recommendation card showing:
- **Recommended tier** and schedule (weekday hours, Saturday hours)
- **Capacity bar** showing current load vs. base capacity
- **Bonus points** added by the recommended tier
- **Coverage status** — fully covered or remaining excess
- **Human-readable explanation** of why this tier was chosen

### Hard Constraints

| Constraint | Rule |
|-----------|------|
| Max push | Never suggest >2 week moves |
| Late job protection | Never push a late job further out |
| 3-week lateness | System flags if any job would be 3+ weeks late as critical |
| No auto-apply | All suggestions are recommendations, not automatic changes |

### Panel Sections (UI)

| Section | Content | Default State |
|---------|---------|---------------|
| Summary Bar | Current → Moves → OT pipeline | Always visible |
| Late Jobs | Detailed cards with due date, est. completion, bottleneck | Expanded |
| OT Recommendations | Per-week tier cards with schedule details | Collapsed |
| Move Options | WO and SO suggestions with impact analysis | Expanded |
| Projected Outcome | Before/after comparison | Collapsed |

---

## Future Enhancements

- [x] ~~Overtime scheduling: Include Saturdays at 50% capacity~~ → **Done:** 4-tier OT model
- [x] ~~What-if simulator~~ → **Done:** Projected outcomes in Schedule Insights
- [ ] Inter-department overlap: Allow small jobs to share days across 2 departments
- [ ] Predictive capacity: Use historical data to forecast weekly loads
- [ ] Manager approval queue: Route frozen-zone conflicts to a review screen
- [ ] Apply move suggestions: One-click to execute the recommended moves
- [ ] Export Schedule Insights as PDF for management review
