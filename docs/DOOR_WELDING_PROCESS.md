# Door Welding Process — Scheduling Rules

> **Status:** Pre-Implementation — Gathering requirements  
> **Last Updated:** February 10, 2026  
> **Purpose:** Capture the full door welding sub-pipeline so nothing is missed during implementation.

---

## 1. General Context

- **Doors and Frames** always arrive on **separate work orders** but share the same **Sales Order number**.
- The scheduler already distinguishes door leaves from frames via description parsing.
- The Welding department for doors is **not a single-duration block** — it is a **multi-stage sub-pipeline** with distinct throughput rules at each stage.
- **No batching logic applies to Welding.** Batching is only used in Laser and Press Brake.

---

## 2. Door Categories

The welding sub-pipeline varies based on the door type:

| Category | Identification | Stages |
|----------|---------------|--------|
| **Standard Door** | DOORS product type, NOT NYCHA, `Product_Description` does NOT contain "Flood" | Press → Robot (if Seamless) |
| **Flood Door** | `Product_Description` contains "Flood" | Tube Frame → Press → Full Weld |
| **NYCHA Door** | Job name contains "NYCHA" | Excluded from this new logic (existing 3-day minimum in Welding remains) |

---

## 3. Standard Door Process

### Stage 1: Press

The press is **part of the Welding department** — not a separate department.

| Parameter | Value |
|-----------|-------|
| **Workers** | 3 |
| **Throughput (1–5 pts/door)** | 16–18 doors/day |
| **Throughput (6–11 pts/door)** | ~25% less → ~12–14 doors/day |
| **Capacity model** | **Quantity-driven** (doors/day), not point-driven |

**Key rule:** The point value per door determines the throughput tier. Calculate points per door as:

```
Points Per Door = Total Job Points / Total Number of Doors (Quantity)
```

- **1–5 pts/door** → 16–18 doors/day (use 17 as midpoint)
- **6–11 pts/door** → 25% reduction → ~12–14 doors/day (use 13 as midpoint)

### Stage 2: Robot (Seamless Doors Only)

| Parameter | Value |
|-----------|-------|
| **Workers** | 1 (single robot) |
| **Throughput** | 13–15 doors/day (use 14 as midpoint) |
| **Applies to** | All doors EXCEPT "Lock Seam" |
| **Identification** | `Part_Description` contains "Seamless", OR any door that does NOT contain "Lock Seam" |

**Lock Seam doors skip the robot entirely** and proceed directly to the next department (Polishing).

### Lock Seam Overflow Capacity

When the 3 main press workers are **fully booked** with seamless/standard doors, **2 extra workers** from the Welding department can be reassigned to handle **Lock Seam doors only**.

| Parameter | Value |
|-----------|-------|
| **Overflow Workers** | 2 (pulled from Welding dept) |
| **Applies to** | Lock Seam doors ONLY |
| **Throughput (1–5 pts/door)** | ~11 doors/day |
| **Throughput (6–11 pts/door)** | ~9 doors/day |

> [!IMPORTANT]
> This means Lock Seam and Seamless doors can run **in parallel** — they use separate worker pools. The scheduler uses the overflow rate (≈2/3 of standard) for Lock Seam press duration, and these doors do not consume capacity from the main 3-worker pool.

### Robot Load-Balancing Rule

The robot is a **shared single resource** — multiple jobs can use it, but its daily capacity is fixed at 13–15 doors.

> [!IMPORTANT]
> The scheduler must **load-balance the press output** to avoid flooding the robot. If Day 1 pushes 18 low-point doors through the press, all 18 need the robot on Day 2. But the robot can only do ~14/day, creating a 4-door backlog.
>
> **Strategy:** When scheduling press days, if the current day produces a high door count (low-point doors), the following day should schedule higher-point doors (fewer doors) so the robot queue doesn't pile up.

### Standard Door Duration Calculation

```
Press Duration  = Quantity of Doors / Press Throughput (tier-based)
Robot Duration  = Quantity of Seamless Doors / Robot Throughput
Total Welding   = Press Duration + Robot Duration (sequential, but robot load-balanced)
```

For Lock Seam doors:
```
Total Welding = Press Duration only (no robot)
```

---

## 4. Flood Door Process

**Trigger:** `Product_Description` (same as the `description` field in CSV) contains the word **"Flood"**.

Stages 1 and 2 operate as a **pipeline** (in tandem), while Stage 3 is sequential after the press.

### Stage 1: Tube Frame

| Parameter | Value |
|-----------|-------|
| **Workers** | 1 (from the same Welding pool) |
| **Throughput** | 5 tube frames/day |
| **Pipeline** | As soon as the first frame is complete, the press worker can begin. Workers operate **in tandem**. |

### Stage 2: Press

| Parameter | Value |
|-----------|-------|
| **Workers** | 1 |
| **Throughput** | 4 doors/day |
| **Reason for reduced rate** | Weight of flood doors limits press capacity |

### Stage 3: Full Weld

| Parameter | Value |
|-----------|-------|
| **Workers** | 1 |
| **Throughput** | 4 doors / 4 hours (half a day) |
| **Effective daily rate** | 8 doors/day theoretically, but **capped at 4/day** because only 4 come out of the press per day |
| **Robot** | **Not required** — flood doors do not go through the robot |

### Flood Door Duration Calculation

Since Tube Frame (5/day) is faster than Press (4/day), the **press is the bottleneck** when both run in tandem. The tube frame worker always stays ahead.

```
Pipeline Duration (Tube Frame + Press)  = 0.5 day startup + (Quantity / 4 doors per day)
Full Weld Duration                      = Quantity / 4 doors per day (limited by press output)
Total Welding                           = Pipeline Duration + Full Weld Duration
```

**Example — 20 Flood Doors:**
```
Pipeline  = 0.5 + (20 / 4) = 5.5 days
Full Weld = 20 / 4          = 5 days
Total     =                   10.5 days → rounds to 11 days
```

---

## 5. NYCHA Doors

- **Existing rule remains:** Minimum **3 days** in the Welding department.
- NYCHA doors are **excluded** from the new press/robot sub-pipeline logic described above.
- *(Open question: Does NYCHA follow the standard press → robot flow with the 3-day minimum as a floor, or does it have its own entirely different process? — To be discussed.)*

---

## 6. Summary of Throughput Constants

| Stage | Door Type | Workers | Doors/Day | Notes |
|-------|-----------|---------|-----------|-------|
| Press | Standard (1–5 pts/door) | 3 | 16–18 | Midpoint: 17 |
| Press | Standard (6–11 pts/door) | 3 | 12–14 | 25% reduction, midpoint: 13 |
| Press | Flood | 1 | 4 | Weight-limited |
| Robot | Seamless (not Lock Seam) | 1 | 13–15 | Single resource, shared across jobs |
| Tube Frame | Flood only | 1 | 5 | Sequential prerequisite to press |
| Full Weld | Flood only | 1 | 4 | Capped by press output |

---

## 7. Data Requirements

To implement this logic, the scheduler needs access to:

| Data Point | Source | Current Status |
|------------|--------|----------------|
| **Quantity of doors** | `QTY_ORDER` column | ✅ Already captured |
| **Points per door** | `Total Points / Quantity` | 🆕 Needs calculation |
| **Is Seamless vs Lock Seam** | `Part_Description` column | 🆕 Needs parsing |
| **Is Flood door** | `Product_Description` contains "Flood" | 🆕 Needs parsing |
| **Is NYCHA** | Job name contains "NYCHA" | ✅ Already implemented |

---

## 8. Impact on Current Scheduler

### What Changes
- Welding duration for DOORS product type switches from **point-based** to **quantity-based** with sub-stages.
- The `calculateDeptDuration` function needs a door-specific branch that computes Press + Robot durations.
- Robot capacity becomes a **cross-job shared constraint** that the scheduler must respect daily.

### What Stays the Same
- FAB and HARMONIC products continue using point-based duration in Welding.
- The 2-Pass (Big Rocks / Small Rocks) algorithm is unchanged.
- The backward-scheduling approach is unchanged.
- Department progression (Engineering → Laser → Press Brake → Welding → Polishing → Assembly) is unchanged.
- NYCHA 3-day minimum rule remains as-is (pending further discussion).

---

## 9. Gantt Chart Visualization (Option 3 — Hybrid)

The Welding bar for door jobs is **split into color-coded sub-segments** with a **centered letter label** in each segment.

### Color Scheme

| Sub-Stage | Label | Color | Hex |
|-----------|-------|-------|-----|
| Press | **P** | Standard red | `#ef4444` |
| Robot | **R** | Dark red | `#b91c1c` |
| Tube Frame | **T** | Light red | `#f87171` |
| Full Weld | **W** | Medium-dark red | `#dc2626` |

### Visual Examples

```
Standard Seamless:  [ ████ P ████ | ███ R ███ ]
Lock Seam:          [ ████████ P ████████ ]
Flood:              [ T | ████ P ████ | W ]
NYCHA:              [ ████ Welding (unchanged) ████ ]
FAB/HARMONIC:       [ ████ Welding (unchanged) ████ ]
```

- Tooltips show sub-stage name + date range + door count
- Lock Seam jobs visually differ from Seamless by having no Robot segment

---

## 10. Open Items — To Be Discussed

- [ ] NYCHA door process — does it follow press → robot with a 3-day floor, or something different?
