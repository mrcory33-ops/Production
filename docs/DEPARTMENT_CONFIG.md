# Department Configuration Reference

This document provides detailed reference for department configuration and tuning.

---

## Worker Pool Configuration

**Location:** `lib/departmentConfig.ts`

### Engineering

```typescript
Engineering: {
  pools: [{ count: 9, outputPerDay: 22, maxPerProject: 1 }],
  dailyCapacity: 198,  // 9 workers × 22 pts
}
```

| Setting | Current | To Increase Output |
|---------|---------|-------------------|
| Worker count | 9 | Add more engineers |
| Output/day | 22 pts | Train for efficiency |
| Max/project | 1 | Allow 2 engineers per job |

---

### Laser

```typescript
Laser: {
  pools: [{ count: 3, outputPerDay: 67.5, maxPerProject: 2 }],
  dailyCapacity: 202.5,
}
```

| Setting | Current | Notes |
|---------|---------|-------|
| Worker count | 3 | Machine-limited |
| Output/day | 67.5 pts | High throughput |
| Max/project | 2 | Can work in pairs |

---

### Press Brake

```typescript
'Press Brake': {
  pools: [{ count: 6, outputPerDay: 33, maxPerProject: 4 }],
  dailyCapacity: 198,
}
```

| Setting | Current | Notes |
|---------|---------|-------|
| Worker count | 6 | |
| Output/day | 33 pts | |
| Max/project | 4 | Can have team working same job |

---

### Welding (CONSTRAINT)

```typescript
Welding: {
  isConstraint: true,  // THE BOTTLENECK
  pools: [
    { count: 6, outputPerDay: 15, productTypes: ['DOORS'] },
    { count: 7, outputPerDay: 15, productTypes: ['FAB', 'HARMONIC'] }
  ],
  dailyCapacity: 195,
}
```

**Critical Department** - Most scheduling conflicts occur here.

| Setting | Current | Impact |
|---------|---------|--------|
| DOORS pool | 6 workers | Dedicated to door products |
| FAB/HARMONIC pool | 7 workers | Shared for fabrication |
| Output/day | 15 pts | Lower than other depts |
| Daily capacity | 195 pts | Lowest in facility |

**To increase Welding capacity:**
1. Add workers to appropriate pool
2. Recalculate: `dailyCapacity = (pool1.count + pool2.count) × outputPerDay`

---

### Polishing

```typescript
Polishing: {
  pools: [
    { count: 6, outputPerDay: 18, productTypes: ['FAB', 'HARMONIC'] },
    { count: 5, outputPerDay: 18, productTypes: ['DOORS'] }
  ],
  dailyCapacity: 198,
}
```

Split by product type similar to Welding.

---

### Assembly

```typescript
Assembly: {
  pools: [{ count: 12, outputPerDay: 16, maxPerProject: 3 }],
  dailyCapacity: 192,
  timeMultiplier: 1.25,  // Takes 25% longer
}
```

| Setting | Current | Notes |
|---------|---------|-------|
| Time multiplier | 1.25 | Jobs take 25% longer here |
| Worker count | 12 | Largest team |
| Output/day | 16 pts | |

---

## Capacity Calculation Formula

For each department:

```
Daily Capacity = Σ (pool.count × pool.outputPerDay)
```

For job duration in a department:

```
Duration = (Points / (min(maxPerProject, count) × outputPerDay)) × timeMultiplier
```

---

## Common Adjustments

### Adding a New Worker

1. Find the department in `DEPARTMENT_CONFIG`
2. Increment `pools[].count`
3. Recalculate `dailyCapacity`

**Example:** Add 1 welder to DOORS pool:
```typescript
// Before
{ count: 6, outputPerDay: 15, productTypes: ['DOORS'] }
// After
{ count: 7, outputPerDay: 15, productTypes: ['DOORS'] }
// Update dailyCapacity: (7 + 7) × 15 = 210
```

---

### Changing Output Rate

If actual measurements show different throughput:

```typescript
// Before
{ count: 6, outputPerDay: 33, maxPerProject: 4 }
// After (workers are actually doing 40 pts/day)
{ count: 6, outputPerDay: 40, maxPerProject: 4 }
// Update dailyCapacity: 6 × 40 = 240
```

---

### Adding Time Multiplier

If a department consistently takes longer:

```typescript
// Before
Laser: {
  dailyCapacity: 202.5,
  // no timeMultiplier
}

// After (Laser actually takes 10% longer)
Laser: {
  dailyCapacity: 202.5,
  timeMultiplier: 1.10,
}
```

---

## Color Configuration

Each department has a color for Gantt chart visualization:

| Department | Hex Color | CSS Class |
|------------|-----------|-----------|
| Engineering | `#3b82f6` | `dept-engineering` |
| Laser | `#f97316` | `dept-laser` |
| Press Brake | `#eab308` | `dept-press-brake` |
| Welding | `#ef4444` | `dept-welding` |
| Polishing | `#14b8a6` | `dept-polishing` |
| Assembly | `#8b5cf6` | `dept-assembly` |

---

*Last Updated: February 2026*
