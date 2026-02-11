# Scheduling Accuracy Fixes — Implementation Plan

## Answers to Your Questions

### Q: Is the frozen zone the same as the bucket system?

No — they're related but separate concepts:

| Concept | What it does | Where |
|:--|:--|:--|
| **Queue Buffer** (`QUEUE_BUFFER_DAYS = 2`) | Measures how many days of work are queued ahead for each department. You want ~2-3 days so departments always have work waiting. | `calculateQueueBuffer` (line 822) — diagnostic only, shown in UI |
| **Frozen Zone** (`FROZEN_WEEKS = 2`) | Prevents the optimizer from *moving* jobs that start within the next 2 weeks. This protects jobs that are already staged/planned on the shop floor. | Declared at line 2063 but **never enforced** |

The frozen zone protects the bucket. If a department has 3 days queued and the optimizer shifts a job out of that queue, the bucket drops to 2 or 1 day — creating the machine-down / bad-output risk you mentioned. Enforcing the frozen zone is what keeps the bucket stable.

### Q: Is Phase 2 missing from the logic?

Phase 2 exists but is **read-only** — it computes and logs overload counts but takes no corrective action:

```
Phase 2: Capacity audit...
  14 overloaded week-dept pairs    ← just logs this, does nothing
Phase 3: Compressing...           ← all the fixing happens here
```

Phase 2 could be enhanced to feed intelligence into Phase 3 (e.g., prioritize the most overloaded weeks), but it's not a gap in the pipeline — it's a diagnostic step. Phase 3 does re-compute the full load itself.

### Q: Department capacity recalculation

You're right — the `outputPerDay` values in config are too high. If the weekly target is 850, then `workers × outputPerDay × 5` should equal or be slightly above 850 (not 990+). Here's what I propose:

| Department | Workers | Current Output/Day | Current Weekly | Proposed Output/Day | Proposed Weekly |
|:--|:--:|:--:|:--:|:--:|:--:|
| Engineering | 9 × 1 | 22 | 990 | **19** | **855** |
| Laser | 3 × 2 | 67.5 | 1,012 | **57** | **855** |
| Press Brake | 6 × 4 | 33 | 990 | **28.5** | **855** |
| Welding (DOORS) | 6 × 3 | 15 | 450 | **14** | **420** |
| Welding (FAB) | 7 × 3 | 15 | 525 | **14** | **490** |
| Polishing (FAB) | 6 × 3 | 18 | 540 | **16** | **480** |
| Polishing (DOORS) | 5 × 3 | 18 | 450 | **16** | **400** |
| Assembly | 12 × 3 | 16 | 960 | **14** | **840** |

> [!IMPORTANT]
> These proposed values are rough estimates to bring weekly totals near 850. **You'll know the real achievable rates better than I do.** I'd like your input on the actual output-per-day numbers before I change them. Should I use the values above, or do you have real-world numbers you'd prefer?

---

## Proposed Changes

### Phase 1 — Quick Wins

---

#### #1: Consolidate Gap Tables

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

Add a single constant near the top of the file (around line 17):
```typescript
const DEPT_GAP_DAYS = {
  small: 0,      // ≤ SMALL_JOB_THRESHOLD pts
  medium: 0.5,   // SMALL_JOB_THRESHOLD < pts < BIG_ROCK threshold
  bigRock: 1     // ≥ BIG_ROCK threshold
} as const;
```

Replace the inline gap logic in **4 locations**:
- `placeIdeal` (lines 2108-2112)
- `scheduleForwardFromToday` (lines 658-665)
- `scheduleBackwardFromDue` (lines 1766-1773 and lines 1841-1846)
- `reserveCapacity` (lines 1044-1052) — currently uses 2/1, will change to 1/0.5

Each location will use the same helper:
```typescript
const getDeptGap = (points: number, noGaps?: boolean): number => {
  if (noGaps) return 0;
  if (points >= BIG_ROCK_CONFIG.threshold) return DEPT_GAP_DAYS.bigRock;
  if (points > SMALL_JOB_THRESHOLD) return DEPT_GAP_DAYS.medium;
  return DEPT_GAP_DAYS.small;
};
```

---

#### #4: Recalculate Department Capacities

#### [MODIFY] [departmentConfig.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/departmentConfig.ts)

Update `outputPerDay` and `dailyCapacity` for all departments. Also update `WEEKLY_CAPACITY` in `scheduler.ts` (line 17) if pool configs change.

> [!WARNING]
> **Blocked on your input.** I need the real output-per-day values before making this change. See the table above for my estimates.

---

#### #6: Prorate Weekly Capacity Across Weeks

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `reserveCapacity` (line 1041), replace the single-week reservation:
```diff
-reserveWeeklyCapacity(deptStartDate, dept, job.weldingPoints || 0, buckets);
+// Prorate points across weeks based on working days in each
+proratWeeklyCapacity(deptStartDate, duration, dept, job.weldingPoints || 0, buckets);
```

New helper function:
```typescript
const prorateWeeklyCapacity = (
  startDate: Date, duration: number, dept: Department, 
  totalPoints: number, buckets: CapacityBuckets
): void => {
  const pointsPerDay = totalPoints / Math.max(duration, 1);
  let cursor = new Date(startDate);
  let remaining = duration;
  
  while (remaining > 0) {
    while (isSaturday(cursor) || isSunday(cursor)) cursor = addDays(cursor, 1);
    reserveWeeklyCapacity(cursor, dept, pointsPerDay, buckets);
    cursor = addDays(cursor, 1);
    remaining--;
  }
};
```

This gives the exact behavior you described: a 200-point job over 8 days = 25 pts/day → 125 pts in week 1, 75 pts in week 2.

---

#### #10: Separate `isOverdue` from `schedulingConflict`

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `scheduleForwardFromToday` (line 688), change:
```diff
-schedulingConflict: true, // Mark as conflict since it was overdue
+schedulingConflict: isBefore(
+  normalizeWorkEnd(new Date(job.dueDate)),
+  scheduledEndDate
+), // Only conflict if we can't finish by due date
```

`isOverdue: true` remains for UI badging.

---

#### #11: Fix Same-Day Overlap False Positive

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `validateSchedule` (line 2388), change:
```diff
-if (isBefore(currStart, prevEnd)) { outOfOrder = true; break; }
+// Allow same-day transition (valid for small jobs), flag only true overlaps
+if (isBefore(currStart, startOfDay(prevEnd))) { outOfOrder = true; break; }
```

---

#### #12: Business Day Stall Detection

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `trackJobProgress` (lines 3735-3738), replace calendar-day math:
```diff
-const daysSinceChange = Math.floor(
-  (new Date().getTime() - new Date(updatedJob.lastDepartmentChange).getTime()) / (1000 * 60 * 60 * 24)
-);
+const daysSinceChange = businessDayDistance(
+  startOfDay(new Date(updatedJob.lastDepartmentChange)),
+  startOfDay(new Date())
+);
```

`businessDayDistance` already exists in the file (line 208) and counts Mon-Fri only. Saturday OT hours already go through a separate overtime tracking path, so this won't affect OT calculations.

---

### Phase 2 — Medium Effort

---

#### #5: Compression Recheck with Due Date Priority

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `compressSchedule` (line 2352-2356), after shifting a job:
```diff
 if (shifted) {
     jobMap.set(candidate.id, shifted);
-    if (weeklyLoad[weekKey]?.[dept]) weeklyLoad[weekKey][dept].total -= pts;
+    // Verify shifted job doesn't miss its due date
+    const shiftedEnds = Object.values(shifted.departmentSchedule || {}).map(s => new Date(s.end));
+    const latestEnd = new Date(Math.max(...shiftedEnds.map(d => d.getTime())));
+    if (isBefore(new Date(shifted.dueDate), latestEnd)) {
+      // Shift would cause missed due date — reject it
+      jobMap.set(candidate.id, candidate); // restore original
+    } else {
+      movedAny = true;
+    }
+    // Note: weeklyLoad is fully recomputed at top of each pass (line 2299)
+    // so we don't need the in-place subtraction
 }
```

Remove the in-place `weeklyLoad` subtraction since it's recomputed each pass anyway — this eliminates the bug where destination weeks aren't updated.

---

#### #9: Lockstep Once Before Compression

#### [MODIFY] [scheduler.ts](file:///c:/Users/mrcor/Desktop/Production%20Schedule/lib/scheduler.ts)

In `schedulePipeline` (lines 3368-3385):
```diff
 // Phase 1 placement
 const lockstepPlaced = applyBatchLockstepAlignment(placed);
 
 // Phase 3: Compression
 const compressed = compressSchedule(lockstepPlaced);
-const lockstepCompressed = applyBatchLockstepAlignment(compressed);
+// Lockstep already applied before compression — don't re-run
+// (re-running would undo Phase 3's capacity balancing)
+const lockstepCompressed = compressed;
 
 // Phase 4: Validation
 const validated = validateSchedule(lockstepCompressed);
```

Batching priority is preserved because lockstep runs first. Compression then works with the already-batched schedule and won't break alignments unless necessary for capacity.

---

## Verification Plan

No automated test suite exists for the scheduler. Verification will be manual via the import flow.

### Manual Verification Steps

1. **Before changes** — Import a set of jobs via the Planning Board and note:
   - Total conflict count (displayed after Phase 4)
   - Any "STALLED" jobs in the Gantt chart
   - Weekly load distribution across departments
   - How overdue jobs display (should currently all show red)

2. **After changes** — Re-import the same jobs and verify:
   - [ ] Gap sizes are consistent (spot-check a Big Rock job's schedule — should have 1-day gaps between all departments)
   - [ ] Multi-week jobs show prorated weekly points (check a large job spanning 2 weeks)
   - [ ] Overdue jobs that will finish on time no longer show as conflicted
   - [ ] Small jobs with same-day transitions are NOT marked STALLED
   - [ ] Monday morning: jobs that last moved Friday are not falsely flagged STALLED
   - [ ] Compression doesn't move jobs into due-date violation
   - [ ] Batch cohorts still align in Engineering/Laser/Press Brake

3. **Console log check** — The pipeline logs Phase 3 pass count and conflict count. After changes:
   - Phase 3 should converge in fewer passes (cleaner proration)
   - Conflict count should decrease (fewer false positives)

> [!TIP]
> If you have a saved set of test jobs (Excel/CSV), importing them before and after would give a direct A/B comparison. Do you have a dataset we can use?
