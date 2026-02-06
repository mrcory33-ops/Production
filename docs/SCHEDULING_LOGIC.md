# Production Scheduler - Logic & Configuration Guide

This document provides a comprehensive reference for the scheduling algorithm used in the Emjac Production Scheduler. Use this guide to understand, fine-tune, and modify the scheduling behavior.

---

## Table of Contents

1. [Overview](#overview)
2. [Department Flow](#department-flow)
3. [Configuration Parameters](#configuration-parameters)
4. [Algorithm Deep Dive](#algorithm-deep-dive)
5. [Fine-Tuning Guide](#fine-tuning-guide)
6. [Troubleshooting](#troubleshooting)

---

## Overview

The scheduler uses a **Backward from Due Date** approach combined with **Drum-Buffer-Rope** principles:

- **Welding** is the constraint (bottleneck) department
- Jobs are scheduled to finish just before their due date
- Capacity limits are enforced daily per department
- Larger jobs get scheduling priority

### Key Files

| File | Purpose |
|------|---------|
| `lib/scheduler.ts` | Core scheduling algorithms |
| `lib/departmentConfig.ts` | Department capacity & worker pools |
| `types/index.ts` | TypeScript interfaces for Job, Department |

---

## Department Flow

Jobs flow through departments in this **fixed sequential order**:

```
Engineering → Laser → Press Brake → Welding → Polishing → Assembly
```

Each department must complete before the next can begin.

---

## Configuration Parameters

### Buffer Days

**Location:** `lib/scheduler.ts` Line ~6

```typescript
const BUFFER_DAYS = 2;
```

Days between Assembly completion and Due Date. Increase for more safety margin.

---

### Department Capacity

**Location:** `lib/departmentConfig.ts`

Each department has these tunable parameters:

| Parameter | Description | How to Adjust |
|-----------|-------------|---------------|
| `dailyCapacity` | Max points/day for the department | Increase if department can handle more |
| `pools[].count` | Number of workers in pool | Match actual staffing |
| `pools[].outputPerDay` | Points each worker produces/day | Measure actual output |
| `pools[].maxPerProject` | Max workers on one job | Limits parallelism |
| `timeMultiplier` | Duration scaling (Assembly = 1.25) | Increase if dept is slower |

#### Current Department Settings

| Department | Workers | Output/Worker | Daily Capacity |
|------------|---------|---------------|----------------|
| Engineering | 9 | 22 pts | 198 pts |
| Laser | 3 | 67.5 pts | 202.5 pts |
| Press Brake | 6 | 33 pts | 198 pts |
| **Welding** | 13 (split) | 15 pts | 195 pts |
| Polishing | 11 (split) | 18 pts | 198 pts |
| Assembly | 12 | 16 pts (×1.25) | 192 pts |

---

### Welding Split Pools

Welding has two worker pools by product type:

```typescript
pools: [
  { count: 6, outputPerDay: 15, productTypes: ['DOORS'] },
  { count: 7, outputPerDay: 15, productTypes: ['FAB', 'HARMONIC'] }
]
```

**To adjust:** Modify worker counts based on product type demand.

---

### Duration Calculation

**Location:** `lib/departmentConfig.ts` → `calculateDeptDuration()`

```
Duration = (Job Points / (Effective Workers × Output Per Day)) × Time Multiplier
```

- **Effective Workers** = min(maxPerProject, poolCount)
- Result is rounded up to nearest half-day

---

### Product-Specific Rules

**Location:** `lib/departmentConfig.ts` → `calculateDeptDuration()`

Certain products have minimum duration requirements or extensions:

| Rule | Trigger | Effect |
|------|---------|--------|
| **DOORS Minimum** | Description contains "door" (not "frame") | Min 2 days in Welding |
| **NYCHA Minimum** | Job name contains "NYCHA" | Min 3 days in Welding |
| **HARMONIC Painting** | Product type = HARMONIC + painting flag | +5 days painting + 3-4 days post-paint assembly |

**HARMONIC Painting Details:**
- Painting flag is set during import via user prompt
- Adds 5 work days for off-site painting
- Adds 3-4 additional days for post-paint assembly (4 days if job ≥50 pts)
- Total extension: 8-9 days to Assembly department

---

## Algorithm Deep Dive

### Main Entry: `scheduleAllJobs()`

1. **Initialize capacity buckets** for 120 days
2. **Sort jobs:** Due Date (ASC), then Points (DESC)
3. **For each job:** Call `scheduleBackwardFromDue()`

### Backward Scheduling: `scheduleBackwardFromDue()`

1. Start with Assembly ending on/before due date
2. For each department (backwards):
   - Calculate ideal start/end dates
   - Check if capacity is available
   - If not, shift earlier (up to 60 days)
   - Reserve capacity in buckets
3. Flag conflicts if unable to fit

### Capacity Checking: `canFitDepartment()`

For each work day in the department's range:
- Skip weekends
- Check if `currentLoad + dailyLoad > limit`
- Return false if any day exceeds limit

---

## Fine-Tuning Guide

### Jobs Finishing Too Early

**Symptoms:** Jobs complete well before due date, resources idle

**Solutions:**
1. Reduce `BUFFER_DAYS` (currently 2)
2. Increase `dailyCapacity` limits
3. Check if `outputPerDay` values are too conservative

---

### Jobs Finishing Late / Conflicts

**Symptoms:** `schedulingConflict: true`, jobs marked overdue

**Solutions:**
1. Increase `BUFFER_DAYS` for more cushion
2. Add workers to bottleneck departments (Welding usually)
3. Increase `dailyCapacity` if realistic
4. Enable overtime mode for Saturday capacity

---

### Welding Bottleneck Too Tight

**Symptoms:** Most conflicts occur at Welding

**Solutions:**
1. Increase Welding `dailyCapacity` (currently 195)
2. Add workers: increase `pools[].count`
3. Improve per-worker output: increase `outputPerDay`
4. Allow more workers per project: increase `maxPerProject`

---

### Overtime Mode

**Location:** `lib/scheduler.ts`

```typescript
setOvertimeConfig({
  enabled: true,
  saturdayCapacityMultiplier: 0.5  // Half-day capacity
});
```

When enabled, Saturdays count as work days with reduced capacity.

---

## Troubleshooting

### Q: Why is my job's Engineering starting in the past?

**A:** The job is too large to complete before its due date given current capacity. Either:
- Extend the due date
- Reduce job points (if possible)
- Increase department capacities

---

### Q: How do I see what capacity is being used?

**A:** Enable debug logging by searching for jobs with specific names:
```typescript
// In scheduleBackwardFromDue()
if (job.name.includes('YOUR_JOB')) {
  console.log(`[SCHEDULER] ${job.name}...`);
}
```

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
| Add buffer before due date | `BUFFER_DAYS` | scheduler.ts:6 |
| Change dept output | `outputPerDay` | departmentConfig.ts |
| Add workers | `pools[].count` | departmentConfig.ts |
| Increase daily limit | `dailyCapacity` | departmentConfig.ts |
| Slow down a dept | `timeMultiplier` | departmentConfig.ts |
| Enable Saturday work | `setOvertimeConfig()` | scheduler.ts |

---

*Last Updated: February 2026*
