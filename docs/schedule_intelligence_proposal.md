# Schedule Intelligence System — Architecture Proposal

> **Created:** February 11, 2025  
> **Status:** DRAFT — Pending review & decisions  
> **Purpose:** Capture the full lifecycle of every scheduling cycle (30-60 days) so we can analyze planned vs. actual performance, identify patterns, and continuously improve scheduling accuracy.

---

## The Problem

Right now we can see what the schedule *looks like today*, but we have no memory of:
- What was the plan 3 weeks ago?
- Which departments consistently fall behind or run ahead?
- How often do supervisors override the schedule, and why?
- Are certain product types (FAB, DOORS, HARMONIC) more predictable than others?
- How much does reality deviate from the plan over a 30-60 day cycle?

**Without this data, the scheduler is flying blind.** Every cycle starts from scratch with no feedback loop.

---

## The Three Pillars of Schedule Intelligence

### 📸 Pillar 1: Baseline Snapshots — "What was the plan?"

Every time you upload new job data or run the scheduler, we capture a **frozen photo** of the entire schedule state:
- Every job's planned department timeline (start/end per department)
- Due dates, welding points, product types
- Expected department entry/exit dates
- Current department at time of snapshot
- Job status (PENDING, IN_PROGRESS, HOLD)

This becomes the **baseline** that everything else is measured against. Think of it as taking a photograph of the whiteboard before the month starts.

**When captured:**
- On every XLSX upload / schedule run
- Optionally: weekly auto-snapshot (for drift tracking)

**Example snapshot document:**
```json
{
  "snapshotId": "snap_2025-02-11_abc123",
  "cycleId": "cycle_2025-02",
  "createdAt": "2025-02-11T08:00:00Z",
  "type": "baseline",
  "totalJobs": 187,
  "totalWeldingPoints": 14200,
  "jobs": [
    {
      "jobId": "89022",
      "name": "ACME Panel Assembly",
      "currentDepartment": "Laser",
      "productType": "FAB",
      "weldingPoints": 120,
      "dueDate": "2025-03-15",
      "status": "IN_PROGRESS",
      "departmentSchedule": {
        "Laser": { "start": "2025-02-12", "end": "2025-02-14" },
        "Press Brake": { "start": "2025-02-17", "end": "2025-02-19" },
        "Welding": { "start": "2025-02-20", "end": "2025-02-26" },
        "Assembly": { "start": "2025-02-27", "end": "2025-03-01" }
      }
    }
    // ... all jobs
  ]
}
```

---

### 📝 Pillar 2: Event Stream — "What actually happened?"

As reality unfolds over 30-60 days, we log **discrete events** — small, timestamped records of what changed:

| Event Type | What It Captures | Example |
|---|---|---|
| `dept_transition` | Job moved to a new department | "89022 entered Press Brake on Feb 18 (planned: Feb 17 → 1 day late)" |
| `supervisor_pull` | Supervisor pulled a future job into their queue | "89045 pulled from Laser → Welding: 'Material available early'" |
| `schedule_shift` | Plant manager moved a job on the Gantt chart | "89022 shifted +3 days by plant manager" |
| `due_date_change` | Customer or internal due date change | "89022 due date changed from Mar 15 → Mar 22" |
| `completion` | Job finished a department or completed entirely | "89022 completed Welding on Feb 24 (planned: Feb 26 → 2 days early)" |
| `status_change` | Job put on HOLD or taken off HOLD | "89022 put on HOLD: waiting for material" |
| `alert_created` | Supervisor flagged an issue | "89022 flagged: Special Purchase needed" |

Each event is a tiny document (~500 bytes). Even with 200 jobs going through 6 departments over 2 months, that's roughly **2,400 events** — trivial for Firestore.

**Example event document:**
```json
{
  "eventId": "evt_20250218_001",
  "cycleId": "cycle_2025-02",
  "timestamp": "2025-02-18T14:30:00Z",
  "type": "dept_transition",
  "jobId": "89022",
  "jobName": "ACME Panel Assembly",
  "productType": "FAB",
  "weldingPoints": 120,
  "details": {
    "fromDepartment": "Laser",
    "toDepartment": "Press Brake",
    "plannedTransitionDate": "2025-02-17",
    "actualTransitionDate": "2025-02-18",
    "deltaDays": 1,
    "direction": "late"
  }
}
```

---

### 📊 Pillar 3: Cycle Summaries — "What did we learn?"

At the end of a cycle (or on demand), we **compute** a summary analysis:

#### Department Performance Scorecard
| Department | Planned Points | Actual Points | Variance | Avg Days Early/Late | On-Time % | Supervisor Pulls |
|---|---|---|---|---|---|---|
| Laser | 2,400 | 2,350 | -2.1% | +0.3 late | 85% | 2 |
| Press Brake | 1,800 | 1,900 | +5.6% | -0.5 early | 91% | 0 |
| Welding | 4,200 | 3,800 | -9.5% | +1.2 late | 72% | 5 |
| Assembly | 2,100 | 2,100 | 0% | -0.1 early | 94% | 1 |

#### Job Performance Summary
- **Total jobs in cycle:** 187
- **Completed on time:** 142 (76%)
- **Completed early:** 28 (15%)
- **Completed late:** 17 (9%)
- **Average deviation:** +0.4 days late
- **Most problematic product type:** DOORS (+1.8 days avg late)
- **Most reliable product type:** FAB (+0.1 days avg late)

#### Supervisor Pull Analysis
- **Total pulls:** 8
- **Top reason:** "Material available ahead of schedule" (4 pulls)
- **Most pulled-to department:** Welding (5 pulls)
- **Pattern:** 75% of pulls happen in weeks 2-3 of the cycle

#### Insights
- Welding is consistently the bottleneck (on-time rate 72%)
- DOORS jobs take ~1.8 days longer than planned in Welding
- Supervisor pulls from Laser → Welding suggest the scheduler under-estimates Laser throughput
- Press Brake over-performs by ~5% — consider tightening schedule allocations

---

## Firestore Collection Design

```
📁 scheduleCycles              — One doc per cycle (metadata)
    └── Fields: cycleId, startDate, endDate, status, jobCount, totalPoints, notes

📁 scheduleSnapshots           — One doc per snapshot (baseline + periodic)
    └── Fields: snapshotId, cycleId, createdAt, type, jobs[]

📁 scheduleEvents              — One doc per event (lightweight)
    └── Fields: eventId, cycleId, timestamp, type, jobId, details{}

📁 supervisorAlerts            — Already exists (pulls and issue flags)

📁 jobs                        — Already exists (pull metadata stamped on each job)
```

### Storage / Cost Estimate
- **Snapshots:** ~1-2 per month, each ~50-100KB (depending on job count) = negligible
- **Events:** ~2,000-5,000 per cycle at ~500 bytes each = ~1-2.5 MB per cycle = negligible
- **Summaries:** ~1 per cycle, ~5-10KB = negligible
- **Firestore reads:** Summaries are read once when you want to analyze. Events are query-able by cycle, department, job, etc.

**Total cost impact: Essentially zero on top of what you already use.**

---

## Collection Triggers — When Data Gets Captured

| Trigger | What We Capture | How |
|---|---|---|
| **XLSX Upload / Schedule Run** | Baseline snapshot of all job schedules | Automatic — fires after scheduler finishes |
| **Job enters new department** | `dept_transition` event with planned vs actual date | Automatic — detects `currentDepartment` change on upload |
| **Supervisor pulls a job** | `supervisor_pull` event *(already built)* + job doc stamp | Automatic — already wired |
| **Plant manager shifts a schedule** | `schedule_shift` event with before/after | Automatic — hook into Gantt drag handlers |
| **Job completes** | `completion` event with planned vs actual end date | Automatic — fires on status change to COMPLETED |
| **Due date changes** | `due_date_change` event | Automatic — detects due date delta on upload |
| **Weekly (optional)** | Progress snapshot for drift tracking | Manual or first-visit-of-the-week trigger |
| **End of cycle** | Computed cycle summary document | Manual trigger — "Close Cycle & Generate Report" button |

---

## Open Decisions (Need Your Input)

### 1. How do we define a "cycle"?

| Option | Description | Pros | Cons |
|---|---|---|---|
| **Manual** | You click "Start New Cycle" / "Close Cycle" | Full control, flexible | Requires discipline to remember |
| **Upload-driven** | New cycle starts each time you upload fresh XLSX data | Most natural, automatic | What if you upload corrections mid-cycle? |
| **Calendar-based** | Rolling 30-day window, auto-generates summaries | Most automated | Least flexible, may not align with your actual workflow |

### 2. How granular do we track department transitions?

| Option | Description |
|---|---|
| **Upload-diff** | Compare `currentDepartment` between XLSX uploads — catches transitions between uploads |
| **Real-time** | Log the exact moment a supervisor or system changes `currentDepartment` |
| **Both** | Real-time when possible, upload-diff as a safety net |

### 3. When do we compute summaries?

| Option | Description |
|---|---|
| **On demand** | "Generate Report" button — you click it when you want analysis |
| **Auto at cycle close** | Summary auto-generates when a cycle is closed |
| **Both** | Auto-generate at cycle close, but also allow on-demand mid-cycle reports |

### 4. Where do we surface this data?

| Option | Description |
|---|---|
| **New "Analytics" page** | Dedicated page with cycle history, department scorecards, trend charts |
| **Existing panels** | Integrate into Department Analytics Panel and Schedule Insights |
| **Export only** | Dump to XLSX for analysis in Excel / Google Sheets |
| **All of the above** | Build export first (quick win), then add in-app analytics over time |

---

## Implementation Priority (Suggested)

### Phase 1 — Start Capturing Now (Low effort, High value)
- [ ] Create `scheduleEvents` collection
- [ ] Log `dept_transition` events on XLSX upload (diff current vs previous)
- [ ] Log `schedule_shift` events from Gantt drag (already have the handlers)
- [ ] Log `completion` events when jobs move to COMPLETED
- [ ] Supervisor pulls already captured ✅

### Phase 2 — Baselines (Medium effort)
- [ ] Create `scheduleCycles` collection
- [ ] Create `scheduleSnapshots` collection  
- [ ] Auto-capture baseline snapshot on XLSX upload
- [ ] Store cycle metadata

### Phase 3 — Analysis (Medium-High effort)
- [ ] Build cycle summary computation logic
- [ ] Create "Close Cycle & Generate Report" action
- [ ] Add cycle history browser / export
- [ ] Department performance scorecards

### Phase 4 — Feedback Loop (High value, Builds on Phase 3)
- [ ] Feed cycle summary data back into scheduler tuning
- [ ] Auto-adjust department duration estimates based on historical actuals
- [ ] Predictive alerts ("Welding is trending 2 days behind this cycle")

---

## Notes

- The supervisor pull tracking system (built Feb 11, 2025) is the first piece of this — it already captures pull events in `supervisorAlerts` and stamps pull metadata on job documents.
- The existing `supervisorAlerts` infrastructure (real-time Firestore subscription, Master Schedule banner) can be extended to surface other event types if needed.
- All data remains in Firestore and can be exported to XLSX at any time using the existing export infrastructure.
