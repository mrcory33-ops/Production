# Advanced Quote Estimator — v2.0
# What If Scheduler (fka Quote Estimator)

> **Last Updated:** February 7, 2026  
> **Status:** Production

## Overview

The What If Scheduler (fka Quote Estimator) is a capacity-aware scheduling simulator that answers: *"If we accept this quote, when can we realistically deliver it?"*

It reads the live Firestore schedule, builds a per-department weekly capacity map, and simulates inserting the prospective job through the full 6-department pipeline. For Target Date mode, it runs a 3-tier feasibility analysis and returns a clear recommendation.

---

## Features

### 1. Capacity-Aware Simulation

- **Reads existing schedule** from Firestore jobs (departmentSchedule data)
- **Builds capacity maps** showing weekly usage per department (pts/week)
- **Sequential department scheduling** — each dept finishes before the next starts (matches real scheduler)
- **Capacity reservation** — as each dept is placed, its load is reserved so subsequent depts see accurate availability
- **Calculates job buffers** (scheduled completion vs. real due date) for move candidates
- **Finds available slots** based on 850 pts/week baseline capacity

### 2. Three-Tier Feasibility Check

#### Tier 1: As-Is Schedule
- Checks if the new job can fit into the current schedule without any changes
- Reports bottleneck departments and delay severity if not achievable
- Shows projected completion date if achievable

#### Tier 2: With Job Movements
- Identifies existing jobs with buffer (scheduled earlier than due date)
- Only considers **Engineering** and **Laser** departments (most impactful for freeing capacity)
- **Actually re-simulates** the capacity map with moved jobs removed from their original slots
- Lists specific jobs that could be moved: department, original → new date, buffer days, points relieved
- Shows total capacity freed and projected completion date
- **Guard:** Moves only proposed if the moved job still finishes before its due date

#### Tier 3: With Overtime (4-Tier Model)
- Uses the shop's real 4-tier OT system (aligned with `SCHEDULING_ENGINE.md`):

| Tier | Label | Schedule | Weekly Capacity |
|------|-------|----------|-----------------|
| 1 | 9-Hour Days | Mon–Fri 6am–3pm | 956 pts/wk |
| 2 | 10-Hour Days | Mon–Fri 6am–4pm | 1,063 pts/wk |
| 3 | 9hr + Saturday | Mon–Fri 6am–3pm, Sat 6am–12pm | 1,084 pts/wk |
| 4 | 10hr + Saturday | Mon–Fri 6am–4pm, Sat 6am–12pm | 1,191 pts/wk |

- Tries each tier **lowest-to-highest** and picks the **minimum tier** that achieves the target
- Applies any Tier 2 moves first, then layers OT on top
- Reports per-week OT detail: department, excess, recommended tier, coverage status
- If no tier works, still shows the best-possible completion date at Tier 4

### 3. Smart Recommendations

| Recommendation | Meaning |
|---------------|---------|
| **ACCEPT** | Can complete as-is, no changes needed |
| **ACCEPT WITH MOVES** | Achievable by moving buffered jobs — no OT needed |
| **ACCEPT WITH OT** | Requires overtime at the specified tier |
| **DECLINE** | Cannot meet target even with moves + max OT (shows best-possible date) |

---

## Technical Implementation

### Backend (`lib/quoteEstimator.ts`)

**Key Functions:**
```typescript
buildCapacityMap(existingJobs: Job[]): CapacityMap
// Reads departmentSchedule, distributes welding points across weeks per dept

calculateJobBuffers(existingJobs: Job[]): Map<string, { bufferDays: number; points: number }>
// Calculates buffer and point load for each existing job

findAvailableSlot(dept, startDate, points, duration, capacityMap, weeklyCapacity): Date
// Slides day-by-day until the job's dept-load fits under the weekly cap

simulateQuoteSchedule(input: QuoteInput, existingJobs: Job[]): QuoteEstimate
// Full sequential simulation through 6 depts with capacity reservation

checkAdvancedFeasibility(input: QuoteInput, existingJobs: Job[]): FeasibilityCheck
// Runs all 3 tiers and returns recommendation + projected dates
```

**Constants:**
- `BASE_WEEKLY_CAPACITY = 850` pts/week (8hr × 5 days)
- `BIG_ROCK_THRESHOLD = 70` pts (aligned with scheduler's `BIG_ROCK_CONFIG`)
- `DOLLAR_TO_POINT_RATIO = 650` ($650 = 1 welding point)
- `OT_TIERS` — 4-tier array with exact bonus points and weekly capacities

**Key Types:**
```typescript
interface QuoteInput {
    totalValue: number;
    totalQuantity: number;
    bigRocks: BigRockInput[];
    isREF: boolean;
    engineeringReadyDate: Date;
    targetDate?: Date;
    productType?: ProductType;  // FAB | DOORS | HARMONIC — defaults to FAB
}

interface FeasibilityCheck {
    asIs:      { achievable, completionDate, bottlenecks[] }
    withMoves: { achievable, completionDate, jobsToMove[], capacityFreed }
    withOT:    { achievable, completionDate, otWeeks: OTWeekDetail[], recommendedTier }
    recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE'
    explanation: string
}
```

### Frontend (`components/QuoteEstimator.tsx`)

**UI Sections:**
1. **Job Fundamentals** — Total value, quantity inputs
2. **Item Complexity** — Big Rock definitions, REF toggle
3. **Delivery Timing** — Engineering ready date, mode selector (Earliest / Target Date)
4. **Estimation Results** — Points, urgency, projected finish
5. **Feasibility Analysis** (Target Date mode only):
   - Recommendation banner (color-coded gradient)
   - Tier 1/2/3 cards in a 3-column grid
   - Tier 2 shows capacity freed + completion date
   - Tier 3 shows recommended OT tier, label, week count, and completion date
6. **Execution Roadmap** — Department-by-department timeline bars

---

## Usage Example

### Input:
- Total Value: $150,000
- Big Rock: $50,000
- REF: Yes
- Engineering Ready: Feb 10, 2026
- Target Date: Feb 27, 2026

### Output:
```
Recommendation: ACCEPT WITH MOVES

Tier 1: As-Is
❌ Cannot fit into current schedule
Bottlenecks:
  - Welding delayed by 3 days (capacity full)
  - Assembly delayed by 2 days (capacity full)

Tier 2: With Moves
✅ Can complete by February 27, 2026
5 jobs • 142 pts freed
Jobs to move:
  - Job #12345 - Laser: Feb 15 → Feb 22 (Due: Mar 1, Buffer: 7 days, 28 pts)
  - Job #12346 - Laser: Feb 12 → Feb 19 (Due: Feb 28, Buffer: 9 days, 15 pts)
  ...

Tier 3: With OT
No OT needed (Tier 2 sufficient)
```

---

## Files

| File | Role |
|------|------|
| `lib/quoteEstimator.ts` | Core simulation engine — capacity maps, slot finding, 3-tier feasibility |
| `components/QuoteEstimator.tsx` | UI component — input form + results display |
| `app/quote-estimator/page.tsx` | Page wrapper — fetches Firestore jobs and passes to component |

---

## v2.0 Changelog (Feb 7, 2026)

| Change | Before (v1) | After (v2) |
|--------|-------------|-------------|
| Dept scheduling | 25% overlap (unrealistic) | Sequential (matches scheduler) |
| OT capacity | Flat 1000 pts/wk | 4-tier system (956–1191 pts/wk) |
| OT tier selection | N/A | Tries lowest-to-highest, picks minimum sufficient tier |
| Tier 2 simulation | Ignored freed capacity | Re-simulates with moved jobs removed |
| Big Rock threshold | 50 pts | 70 pts (matches `BIG_ROCK_CONFIG`) |
| Product type support | FAB only | FAB / DOORS / HARMONIC via `QuoteInput.productType` |
| Capacity reservation | None | Each dept placement reserves load for subsequent depts |
| Move detail | Job name + dates | + `pointsRelieved` per move, total `capacityFreed` |
| OT detail | Week key strings | `OTWeekDetail` with dept, load, excess, tier, coverage |
| DECLINE output | Just "can't meet target" | Shows best-possible date at max OT (Tier 4) |

---

## Testing Checklist

- [ ] Test "Earliest Completion" mode — should show sequential timeline
- [ ] Test "Target Date" mode with achievable date (expect ACCEPT)
- [ ] Test "Target Date" mode with tight date (expect ACCEPT_WITH_MOVES)
- [ ] Test "Target Date" mode with impossible date (expect DECLINE with best date)
- [ ] Verify job movement list displays correctly with points relieved
- [ ] Verify OT tier recommendation matches expected tier for given excess
- [ ] Test with Big Rock items (≥70 pts)
- [ ] Test with REF jobs
- [ ] Verify capacity calculations against existing schedule
- [ ] Test with different product types if available

---

## Known Limitations

1. **Points distributed evenly** across a department's duration (no front/back-loading)
2. **Move candidates limited to Engineering + Laser** — other depts not considered
3. **Simulation only** — does not modify the real schedule
4. **Single-job simulation** — does not simulate the effect of accepting multiple quotes simultaneously

---

## Future Enhancements

- [ ] Cost analysis: Show financial impact of OT vs. job movements
- [ ] Save quote history: Track estimates for future reference
- [ ] PDF export: Generate quote reports for sales team
- [ ] Integration with scheduler: Option to commit accepted quotes into the live schedule
- [ ] Batch quote simulation: Model the effect of accepting multiple quotes at once

---

## Access

Navigate to: `http://localhost:3000/quote-estimator`

Or click the **"Quote Estimator"** button (calculator icon) in the Planning Board action bar.
