# Scheduling Accuracy Analysis — Failure Modes & Improvements

**Date:** February 10, 2026  
**Scope:** All 6 docs + `scheduler.ts` (3,756 lines), `departmentConfig.ts`, `scoringConfig.ts`

---

## How to Read This Document

Each item below has **two halves**:
- 🔴 **How it fails** — the concrete scenario where the schedule is wrong
- 🟢 **How to fix it** — the improvement that would correct or mitigate the failure

Items are ranked by impact on scheduling accuracy.

---

## 1. Three Different Gap Tables in the Same File

### 🔴 How It Fails

There are **3 incompatible department-gap implementations** in `scheduler.ts`. They all use the same thresholds but produce different gaps:

| Code Path | Small (≤7 pts) | Medium (8-49 pts) | Big Rock (≥50 pts) | Where Used |
|:--|:--:|:--:|:--:|:--|
| [placeIdeal](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2108-L2112) (Phase 1) | 0 | **0.5 day** | **1 day** | All on-time jobs |
| [scheduleForwardFromToday](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L658-L665) | 0 | **0.5 day** | **1 day** | Overdue jobs |
| [reserveCapacity](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L1044-L1052) | 0 | **1 day** | **2 days** | OPTIMIZE mode only |

**Failure scenario:** A 60-point job (Big Rock) goes through the IMPORT pipeline. `placeIdeal` schedules it with **1-day gaps** between departments. But if the same job were in OPTIMIZE mode, `reserveCapacity` would insert **2-day gaps**. The job's total span differs by **5 days** (5 transitions × 1-day difference) depending on which mode was used.

Even within IMPORT mode, `scheduleBackwardFromDue` (line 1768) uses the same table as `placeIdeal` (1-day for Big Rock), but the docs say `reserveCapacity`'s table (2-day for Big Rock) is the authoritative one. The result: **the schedule the user sees (Phase 1 placement) doesn't match the capacity reservation math** in OPTIMIZE mode.

### 🟢 How to Fix It

Extract gaps into a single constant:
```typescript
const DEPT_GAP_DAYS = {
  small: 0,    // ≤7 pts
  medium: 0.5, // 8-49 pts  
  bigRock: 1   // ≥50 pts
};
```
Use this constant **everywhere** — `placeIdeal`, `scheduleForwardFromToday`, `scheduleBackwardFromDue`, and `reserveCapacity`. Pick one table and commit to it.

---

## 2. `FROZEN_WEEKS = 2` Is Declared but Never Enforced

### 🔴 How It Fails

At [line 2063](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2063): `const FROZEN_WEEKS = 2;`

This constant is **defined but never referenced** in any function. The `compressSchedule` function (Phase 3, [line 2291](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2291)) will happily shift a job that starts **next Monday** by 5 work days later — even though that job's materials may already be staged, workers already assigned, and shop-floor supervisors already planning around it.

**Failure scenario:** It's Wednesday. A job starting Monday in Welding has 4 days of forward slack. Phase 3 compression sees an overloaded week and shifts it 3 days later to balance capacity. The supervisor who staged materials for Monday's start now has an empty Welding cell, and the delayed job creates a downstream cascade.

### 🟢 How to Fix It

In `compressSchedule`, add a guard at [line 2329](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2329):
```typescript
.filter(c => c.job && c.fwdSlack >= 3 && !c.job.isOverdue
  && !isWithinFrozenZone(c.job, today, FROZEN_WEEKS)) // ADD THIS
```
Where `isWithinFrozenZone` checks if the job's first department starts within the next `FROZEN_WEEKS` weeks.

---

## 3. Phase 1 Ignores Capacity — Phase 3 Can't Always Fix It

### 🔴 How It Fails

Phase 1 (`placeIdeal`, [line 2067](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2067)) does **zero capacity checking**. It backward-schedules every on-time job to its ideal position, which can easily stack 2000+ points into a single week for Welding.

Phase 3 compression then tries to fix this by shifting jobs **later** (toward their due date). But it only considers jobs with **≥3 days of forward slack** ([line 2329](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2329)). Jobs due within 2 weeks rarely have 3+ days of slack, so **near-term overloads cannot be resolved.**

**Failure scenario:** 12 jobs all due in the same week. Each is 50-80 pts. Phase 1 stacks them all into the same Welding week (2000+ pts vs 850 target). Phase 3 tries to compress but most have \<3 days of slack because they're due soon. Result: the week stays at 2.4× capacity, and the schedule tells the shop floor to do the impossible — weld 2000 points in a week when they can only do 850.

Meanwhile, `scheduleBackwardFromDue` in OPTIMIZE mode **does** have capacity awareness with a 30-day bidirectional search ([line 1684](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L1684)). But it's not used in the IMPORT pipeline.

### 🟢 How to Fix It

Two options:
1. **Use `scheduleBackwardFromDue` in the IMPORT pipeline** instead of `placeIdeal`. This already does capacity-aware placement.
2. **Lower the slack threshold** in Phase 3 from 3 days to 1 day. This lets the compressor move tighter jobs, at the cost of more aggressive shifting.

---

## 4. Uniform 850 pts/week Across All Departments

### 🔴 How It Fails

Every department uses the same `WEEKLY_TARGET = 850` ([line 2062](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2062)), even though their actual daily capacities differ:

| Department | Daily Capacity | True Weekly (5-day) | System Uses | Error |
|:--|:--:|:--:|:--:|:--:|
| Laser | 202.5 | **1,012** | 850 | -16% (wasted) |
| Engineering | 198 | **990** | 850 | -14% |
| Press Brake | 198 | **990** | 850 | -14% |
| Polishing | 198 | **990** | 850 | -14% |
| Welding | 195 | **975** | 850 | -13% |
| Assembly | 192 | **960** | 850 | -11% |

**Failure scenario:** Laser can do 1,012 pts/week. The system caps it at 850. Two 50-point jobs that could both fit in the same week get split across two weeks, needlessly extending lead times. Meanwhile, jobs pile up waiting for Laser capacity that theoretically exists.

Conversely, if 850 is ever raised to be closer to true capacity and Welding has a rough week (absenteeism, machine downtime), it will overshoot immediately because there's no margin.

### 🟢 How to Fix It

Replace the uniform constant with per-department targets:
```typescript
const WEEKLY_TARGETS: Record<Department, number> = {
  Engineering: 900,  // 91% of 990, allows 9% buffer
  Laser: 900,        // 89% of 1012
  'Press Brake': 900,
  Welding: 800,      // 82% of 975 — tighter buffer for the constraint
  Polishing: 900,
  Assembly: 850
};
```
Calibrate these from actual shop-floor throughput data.

---

## 5. Compression Shifts Jobs But Doesn't Recalculate Downstream Departments

### 🔴 How It Fails

`compressSchedule` ([line 2291](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2291)) uses `shiftJobSchedule` to move a job N days later. But `shiftJobSchedule` ([line 2258](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2258)) shifts **all** departments uniformly — it doesn't check if the shifted position now violates capacity in a different week.

**Failure scenario:** A job overloads Week 5 Welding. Phase 3 shifts it 5 days later, which fixes Week 5 but now dumps its Polishing phase into Week 6, which was already at 820 pts. Week 6 Polishing is now overloaded at 900+, but Phase 3 doesn't recheck Polishing capacity for the shifted job. The overload just moved to a different department-week pair.

The 10-pass iteration helps — the *next* pass might catch the new Polishing overload. But it only catches it if the Polishing overload is the worst one. With `overloaded.sort((a, b) => b.excess - a.excess)` ([line 2316](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2316)), smaller overloads in non-constraint departments get deferred.

### 🟢 How to Fix It

After shifting a job, immediately recompute its contribution to all week-dept pairs, not just the one that triggered the shift. The simplest approach: after each shift, fully rebuild `weeklyLoad` (which the code already does every pass at [line 2299](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2299)). The issue is the in-place subtraction at [line 2354](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2354) that only updates the source week-dept, not the destination.

---

## 6. Weekly Capacity Reserves Full Job Points on Dept Start Week

### 🔴 How It Fails

`reserveWeeklyCapacity` at [line 1041](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L1041) reserves the **entire job's welding points** against the week of `deptStartDate`:
```typescript
reserveWeeklyCapacity(deptStartDate, dept, job.weldingPoints || 0, buckets);
```

A 100-point job that takes 8 days in Welding spans **2 weeks**. But the full 100 points are charged to the start week. This means:
- Week 1 is over-charged by ~50 pts (it only does half the work)
- Week 2 gets free capacity that doesn't actually exist (the workers are still welding this job)

**Failure scenario:** Week 1 Welding shows 900 pts used (over 850 target). The system flags it as overloaded and tries to move jobs. But 50 of those points are actually Week 2 work. Meanwhile, Week 2 shows 750 pts — looks like it has room for more. The system schedules another job there. Now Week 2 is actually at 800 + the 50 uncounted = 850, and there's no buffer for uncertainty.

### 🟢 How to Fix It

Prorate weekly capacity by how many days of the job fall in each week:
```typescript
// Instead of full points on start week:
const startWeekDays = daysInWeekFromDate(startDate);
const totalDays = duration;
const weekFraction = Math.min(startWeekDays, totalDays) / totalDays;
reserveWeeklyCapacity(startDate, dept, points * weekFraction, buckets);
// Reserve remainder in subsequent weeks...
```

---

## 7. `scheduleJobFromWelding` (Legacy) Has Zero Department Gaps

### 🔴 How It Fails

The legacy function `scheduleJobFromWelding` ([line 1304](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L1304)) schedules backward from due date through the `placeDept` helper, which uses `exceedsDailyDeptLimit` to avoid stacking more than 2 departments per day — but **never inserts inter-department gaps**.

If this function is called anywhere (e.g., for overtime retry at [line 1362](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L1362)), the resulting schedule will have departments packed back-to-back with zero transition time. A 100-point Big Rock that should have 1-day gaps between all 5 transitions (5 extra days) will be scheduled **5 days shorter** than it should be.

**Failure scenario:** An on-time job triggers overtime recalculation. The code calls `scheduleJobFromWelding(job, true)`. The job gets a compressed schedule with no gaps. When it hits the shop floor, materials aren't ready for the next department because there's been no buffer for transition/staging.

### 🟢 How to Fix It

Determine if `scheduleJobFromWelding` is still actively called. If it is, add the same gap logic used in `placeIdeal`. If it's truly legacy (superseded by the 4-phase pipeline), remove it and its callers to prevent accidental use.

---

## 8. Door Welding Robot Is Not a Shared Resource

### 🔴 How It Fails

The robot welder processes 14 seamless doors/day. `calculateDoorWeldingSubStages` ([line 199 in departmentConfig.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/departmentConfig.ts#L199)) calculates each job's robot time as `Math.ceil(qty / 14)`. But if three 20-door seamless jobs are scheduled in the same week, each expects the robot for ~1.5 days. Total need: 4.3 days of a 5-day week.

The scheduler doesn't track robot utilization. It will happily schedule all three to start their robot phase on Monday. But the robot is a single machine — only one job can use it at a time.

**Failure scenario:** Three door jobs are in Welding the same week. Each hits the robot sub-stage. The actual robot throughput is 14 doors/day regardless of how many jobs are queued. So 60 doors across 3 jobs takes 4.3 days, not the 1.5 days each job's schedule shows. Two of the three jobs will be late leaving Welding, cascading through Polishing and Assembly.

### 🟢 How to Fix It

Track the robot as a secondary capacity constraint. In `reserveDepartmentCapacity`, when the department is Welding and the job has a `robot` sub-stage, accumulate robot-days against a pool with max capacity of 14 doors/day. If the robot is full, push the job's robot sub-stage (and everything after it) to the next available day.

> [!NOTE]
> This only matters if DOORS volume is significant and multiple seamless door jobs often overlap in Welding. If DOORS jobs rarely coincide, this is lower priority.

---

## 9. Batch Lockstep Alignment Can Create Capacity Violations

### 🔴 How It Fails

`applyBatchLockstepAlignment` ([line 373](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L373)) aligns batched jobs to start and end in the same department windows. It takes the **maximum duration** across all jobs in the batch for each department ([line 425](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L425)).

But it does this **after** capacity-aware scheduling. The alignment stretches some jobs' department windows (to match the longest), potentially pushing them into weeks that are already at capacity. The function doesn't check capacity at all — it only calls `enforceSequentialDepartmentOrder`.

**Failure scenario:** A batch of 3 jobs. Job A takes 2 days in Welding, Job B takes 5 days. After alignment, all 3 are stretched to 5 days. Jobs A and C now occupy Welding for 3 extra days each, consuming capacity that wasn't reserved. The weekly load for that week jumps, but since this happens *after* Phase 3 compression, nobody fixes it.

Worse — lockstep runs **twice**: after Phase 1 ([line 3368](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L3368)) and again after Phase 3 ([line 3385](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L3385)). The second run can undo Phase 3's careful capacity balancing.

### 🟢 How to Fix It

Either:
1. Run lockstep alignment only once, **before** Phase 3 compression, so compression can account for the expanded windows.
2. Add a lightweight capacity check inside `applyBatchLockstepAlignment` that rejects alignments that would exceed weekly targets.

---

## 10. Overdue Jobs Always Get `schedulingConflict: true`

### 🔴 How It Fails

`scheduleForwardFromToday` ([line 688](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L688)):
```typescript
schedulingConflict: true, // Mark as conflict since it was overdue
```

A job that was 1 day overdue but will finish 3 weeks from now does not have a *scheduling* conflict — it has a *historical* one. The UI will show it as conflicted (red styling, alert icons) even though the forward schedule is clean and on track.

**Failure scenario:** 20 jobs come in 1 day late. All 20 get permanently red-flagged in the Gantt chart. The supervisor can't distinguish between "late but recovering" and "late and getting worse." The signal value of the conflict indicator is destroyed.

### 🟢 How to Fix It

Separate `isOverdue` (historical fact) from `schedulingConflict` (forward-looking prediction). Only set `schedulingConflict: true` if the forward-scheduled end date exceeds the original due date:
```typescript
const projectedEnd = new Date(departmentSchedule[lastScheduledDept].end);
schedulingConflict: isBefore(new Date(job.dueDate), projectedEnd)
```

---

## 11. Validation Marks Overlapping Departments as "STALLED"

### 🔴 How It Fails

`validateSchedule` ([line 2371](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2371)):
```typescript
if (isBefore(currStart, prevEnd)) { outOfOrder = true; break; }
// ...
progressStatus: missedDueDate ? 'SLIPPING' : outOfOrder ? 'STALLED' : 'ON_TRACK'
```

If departments overlap (e.g., Polishing starts on the same day Welding ends — which is valid for small jobs with `SMALL_JOB_THRESHOLD`), the validation marks the job as `STALLED`. But it's not stalled — it's just a small job with intentionally overlapping department transitions.

**Failure scenario:** A 5-point corner guard has Welding end Monday and Polishing start Monday (no gap, as expected for small jobs). Phase 4 sees this as `outOfOrder` and marks it `STALLED`. The supervisor sees a stalled badge and investigates a non-issue.

### 🟢 How to Fix It

Change the overlap check from `isBefore(currStart, prevEnd)` to `isBefore(currStart, addDays(prevEnd, -1))` — allow same-day transitions but flag true overlaps where department B starts *before* department A ends. Or better: check that the *end* of department A is not *after* the *end* of department B.

---

## 12. Progress Tracking Uses Calendar Days for Stall Detection

### 🔴 How It Fails

`trackJobProgress` ([line 3736](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L3736)):
```typescript
const daysSinceChange = Math.floor(
  (new Date().getTime() - new Date(updatedJob.lastDepartmentChange).getTime()) / (1000 * 60 * 60 * 24)
);
if (daysSinceChange >= 2) {
  updatedJob.progressStatus = 'STALLED';
}
```

This uses **calendar days**, not business days. If a job moves departments on Friday, it will be flagged as `STALLED` by Sunday (2 calendar days) — before the shop even opens on Monday.

**Failure scenario:** Every Monday morning, all jobs that last moved on Friday show as `STALLED` until their first movement that Monday. The supervisor dashboard is flooded with false stall alerts every week.

### 🟢 How to Fix It

Use `businessDayDistance` (which already exists in the file) instead of raw calendar day math.

---

## 13. Compression Only Shifts Jobs Later — Never Earlier

### 🔴 How It Fails

Phase 3 `compressSchedule` ([line 2289](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L2289)):
> Strategy: Push flexible jobs LATER (toward their due date) to free up overloaded near-term weeks.

It uses `shiftJobSchedule(candidate, -tryDays)` — negative = later. It **never** considers shifting jobs **earlier** to fill underloaded weeks.

**Failure scenario:** Week 3 Welding is at 1100 pts (overloaded by 250). Week 2 Welding is at 500 pts (350 pts of spare room). A job due in Week 5 currently starts in Week 3 with 4 days of backward slack (it could start earlier). The obvious fix is to pull it into Week 2. But Phase 3 can only push things *later*, so it tries to move something from Week 3 to Week 4+, which may already be full.

### 🟢 How to Fix It

Add a bidirectional compression strategy: after trying to push jobs later, look for underloaded weeks that could absorb work *from* overloaded weeks by pulling jobs earlier. This is more complex but significantly improves load balancing.

---

## 14. Batch Efficiency Discount Doesn't Scale with Match Quality

### 🔴 How It Fails

From [departmentConfig.ts line 122](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/departmentConfig.ts#L122):
```typescript
twoItems: 0.10,   // 10% discount for 2 batched items
threeOrMore: 0.15  // 15% discount for 3+ batched items
```

The batch key is `category|gauge|material`. But [scheduler.ts line 128](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L128) has a fallback for the `DOOR_LOCK_SEAM` category that matches on just `hasToken(text, 'ls')` — any description containing "ls" as a word boundary. A door lock seam job in 16ga SS304 and a completely different door lock seam job in 18ga Galv could batch together (same category, different gauge/material) and get the full 15% discount — even though they require completely different tooling setups.

The [batch key](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts#L166-L171) includes gauge and material, so strict matches are accounted for. But the relaxed match in `getBatchCategory` via the `ls` token could group things that shouldn't be grouped at the cohort level.

### 🟢 How to Fix It

Tier the discount by match quality: strict match (category + gauge + material) = full discount. Category-only match = 50% discount. This more accurately reflects the real setup-time savings.

---

## 15. No Capacity Awareness in DOORS Polishing Duration

### 🔴 How It Fails

Polishing uses the same generic formula for all product types: `points / (effectiveWorkers × outputPerDay)`. But DOORS has a dedicated 5-worker pool for Polishing ([departmentConfig.ts line 70](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/departmentConfig.ts#L70)) while FAB/HARMONIC use a 6-worker pool ([line 69](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/departmentConfig.ts#L69)).

The pool routing is correct — `getPoolForJob` will find the right pool. But there's no `timeMultiplier` for DOORS in Polishing, even though door polishing (grain-direction work, edge finishing) is typically more labor-intensive per point than FAB table polishing.

**Failure scenario:** A 50-point door job and a 50-point FAB job are both scheduled for 2 days in Polishing. In reality, the doors take 2.5 days due to the extra hand-finishing. The door job leaves Polishing half a day late, pushing Assembly back.

### 🟢 How to Fix It

Add a product-type-aware multiplier for Polishing. Even a small one (1.15× for DOORS) would tighten accuracy based on shop-floor experience.

---

## Summary Table

| # | Issue | Failure Type | Impact | Fix Effort |
|:--|:--|:--|:--:|:--:|
| 1 | Three different gap tables | 📐 Inconsistency | 🔴 High | Low |
| 2 | `FROZEN_WEEKS` never enforced | 🐛 Dead code | 🔴 High | Low |
| 3 | Phase 1 ignores capacity | 📐 Architecture | 🔴 High | Medium |
| 4 | Uniform 850 for all depts | 📐 Oversimplification | 🔴 High | Low |
| 5 | Compression doesn't recheck downstream | 🐛 Logic gap | 🟡 Medium | Medium |
| 6 | Weekly capacity not prorated across weeks | 🐛 Math error | 🟡 Medium | Medium |
| 7 | Legacy fn has zero gaps | 🐛 Regression risk | 🟡 Medium | Low |
| 8 | Robot not tracked as shared resource | 📐 Missing model | 🟡 Medium | High |
| 9 | Lockstep ignores capacity | 🐛 Logic gap | 🟡 Medium | Medium |
| 10 | Overdue always = conflict | 📐 UX/signal | 🟢 Lower | Low |
| 11 | Same-day overlap = STALLED | 🐛 False positive | 🟢 Lower | Low |
| 12 | Stall detection uses calendar days | 🐛 Weekend bug | 🟢 Lower | Low |
| 13 | Compression is one-directional | 📐 Limitation | 🟢 Lower | Medium |
| 14 | Batch discount ignores match quality | 📐 Oversimplification | 🟢 Lower | Low |
| 15 | Polishing has no DOORS multiplier | 📐 Missing config | 🟢 Lower | Low |

> [!NOTE]
> Items marked 🐛 are bugs/inconsistencies that are **producing wrong results today**. Items marked 📐 are architectural limitations or oversimplifications that degrade accuracy but are working as designed.

---

## Recommended Priority

**Immediate quick wins** (< 1 hour each, big accuracy gains):
- **#1** — Consolidate gap tables into one constant
- **#2** — Enforce `FROZEN_WEEKS` in `compressSchedule`
- **#4** — Per-department weekly targets
- **#10** — Fix overdue conflict flag
- **#11** — Fix same-day overlap false positive
- **#12** — Use business days for stall detection

**Next sprint** (medium effort, high payoff):
- **#3** — Use capacity-aware placement in IMPORT pipeline
- **#5** — Full recompute of weekly load after each compression shift
- **#6** — Prorate weekly capacity for multi-week jobs
- **#9** — Run lockstep once (before compression) or add capacity guard

**Backlog** (bigger architectural work):
- **#8** — Robot as secondary shared constraint
- **#13** — Bidirectional compression
