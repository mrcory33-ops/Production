export type ProductType = 'FAB' | 'DOORS' | 'HARMONIC';

// Door welding sub-pipeline types
export type WeldingSubStage = 'press' | 'robot' | 'tubeFrame' | 'fullWeld';
export type DoorSubType = 'standard_seamless' | 'standard_lockseam' | 'flood' | 'nycha';

export interface WeldingSubStageInfo {
    stage: WeldingSubStage;
    durationDays: number;
    label: string;   // "P", "R", "T", "W"
    color: string;   // Hex color for Gantt sub-segment
}

export type Department =
    | 'Engineering'
    | 'Laser'
    | 'Press Brake'
    | 'Welding'
    | 'Polishing'
    | 'Assembly';

export type JobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'HOLD';
export type AlertStatus = 'active' | 'resolved';
export type AlertAdjustmentStrategy = 'direct' | 'move_jobs' | 'ot';

export interface SupervisorAlert {
    id: string;

    // Core 4 fields
    jobId: string;
    department: Department;
    reason: string;
    estimatedResolutionDate: string; // ISO date

    // Multi-job support (optional — backward compatible)
    additionalJobIds?: string[];   // Extra affected job IDs beyond primary jobId
    additionalJobNames?: string[]; // Paired display names for additional jobs

    // Auto-populated
    jobName: string;
    salesOrder?: string;
    status: AlertStatus;
    reportedBy: string;
    daysBlocked: number; // Business days until the issue is expected to clear

    // Timestamps
    createdAt: string;
    updatedAt: string;
    resolvedAt?: string;

    // Adjustment tracking (optional)
    adjustmentCount?: number;
    lastAdjustmentAt?: string;
    lastAdjustmentSelectedStartDate?: string;
    lastAdjustmentStrategy?: AlertAdjustmentStrategy;
    lastAdjustmentReason?: string;
    lastAdjustmentMovedJobIds?: string[];
    lastAdjustmentOtSummary?: string;

    // Special Purchase tracking
    isSpecialPurchase?: boolean;     // Alert is due to a special purchase issue
    daysNeededAfterPO?: number;      // Business days needed to complete once parts arrive
    spAdjustedDueDate?: string;      // New due date assigned because of SP hold (ISO)
    poReceivedEarly?: boolean;       // PO was received before the adjusted due date

    // Additional issue flags
    isCsiNotReceived?: boolean;      // CSI has not been received
    isOutOfStock?: boolean;          // Part is out of stock
}

export interface DepartmentLiveStatus {
    department: Department;
    activeAlerts: number;
    blockedJobs: string[];
    totalBlockedPoints: number;
    topIssue?: string;
}

export interface ScheduleAlertImpact {
    activeAlertCount: number;
    blockedJobCount: number;
    blockedJobIds: string[];
    blockedPointsTotal: number;
    blockedPointsByDepartment: Record<string, number>;
    availableCapacityByDepartment: Record<string, number>;
    note: string;
}

export interface Job {
    id: string; // WO_NUM
    name: string; // JOB_NAME
    masterJobId?: string; // Reference to master if this was combined

    // Scheduling Stats
    weldingPoints: number; // DEPT4HRS
    quantity: number; // Sum of QTY_ORDER
    dueDate: Date; // SO_HEAD_DATE_DUE

    // Classification
    productType: ProductType; // DIVISION (F/D/H)
    salesperson: string; // REP_NAME
    salesRepCode?: string; // Code_Sort (column L) — used for SP email lookup
    salesOrder?: string; // Sales Order Number (if available)

    // Priority & Size
    isPriority: boolean; // Manual override
    sizeClass: 'LARGE' | 'SMALL'; // Calculated (300+ pts = LARGE)

    // Current Status
    currentDepartment: Department; // Calculated from DEPTxDONE columns
    status: JobStatus;

    // Special Purchase Tracking
    openPOs: boolean; // Column AP (#9 missing)
    closedPOs: boolean; // Column AQ (#9 received)
    readyToNest: boolean; // USER_6 (X)

    // Details
    partNumber: string; // PART
    customerPartAndName: string[]; // Combined PART_CUSTOMER + Master/Sub distinction
    customerName?: string; // Name_Customer from XLSX (column M) — used for customer-specific scheduling rules
    description: string; // PART_DESCRIPTION
    notes: string; // USER_7

    // Calculated Schedule
    scheduledStartDate?: Date;
    scheduledEndDate?: Date;
    isOverdue?: boolean;
    departmentSchedule?: Record<string, { start: string; end: string }>; // Stored as ISO strings for Firestore compatibility
    forecastStartDate?: Date;
    forecastDueDate?: Date;
    remainingDepartmentSchedule?: Record<string, { start: string; end: string }>; // Remaining schedule from current dept

    // Capacity-Aware Scheduling (NEW)
    schedulingConflict?: boolean; // Can't meet due date within capacity limits
    progressStatus?: 'ON_TRACK' | 'SLIPPING' | 'STALLED' | 'AHEAD'; // Progress tracking (AHEAD = jumped ahead of schedule)
    lastDepartmentChange?: Date; // When currentDepartment last changed (for stall detection)
    scheduledDepartmentByDate?: Record<string, Department>; // Expected dept on each date (for slippage detection)
    priorityByDept?: Partial<Record<Department, { value: number; setAt: string; listId: string }>>;
    noGaps?: boolean; // Override: Remove all department gaps for this job
    requiresOT?: boolean; // Capacity-aware placement needed OT ceiling to meet due date
    skippedDepartments?: Department[]; // Departments this job should skip (removed from schedule)
    requiresPainting?: boolean; // HARMONIC jobs that need off-site painting (adds ~1 week to Assembly)
    weldingSubStages?: WeldingSubStageInfo[]; // Door welding sub-pipeline breakdown (press/robot/tubeFrame/fullWeld)
    doorSubType?: DoorSubType; // Door classification for sub-pipeline routing
    departmentProgress?: Partial<Record<Department, number>>; // Supervisor-reported % complete per department (0-100)
    assignedWorkers?: Partial<Record<Department, string[]>>; // Workers assigned to this job per department

    // Due Date Change Tracking
    dueDateChanged?: boolean; // Flag: due date differs from previous upload
    previousDueDate?: Date; // Original due date before change
    needsReschedule?: boolean; // User should be prompted to reschedule

    // Urgency Scoring
    urgencyScore?: number;
    urgencyFactors?: {
        dueDateProximity: number;
        fastShipBonus: number;
        slippageRisk: number;
        stallPenalty: number;
        bigRockWeight: number;
        refJobBonus: number;
        harmonicBonus: number;
        [key: string]: number;
    };
    fastShip?: boolean; // True if "Fast Ship" column indicates priority (Column K)

    updatedAt: Date;
}

export interface DepartmentSchedule {
    date: string; // YYYY-MM-DD
    department: Department;
    allocatedPoints: number;
    capacity: number; // Default 200
    jobIds: string[];
}

export interface ShopCalendarDay {
    date: string; // YYYY-MM-DD
    isWorkDay: boolean;
    isOvertime: boolean; // Saturday/Extended hours
    note?: string;
}

export interface WeeklyTarget {
    weekNumber: number;
    year: number;
    fabTarget: number;
    doorsTarget: number;
    harmonicTarget: number;
}

// ---- Schedule Insights v2 (Decision-Support Model) ----

export interface LateJob {
    jobId: string;
    jobName: string;
    salesOrder?: string;
    dueDate: string;              // ISO date
    estimatedCompletion: string;  // ISO date — current schedule (no OT)
    daysLate: number;             // Work days past due
    points: number;
    bottleneckDept: string;       // Department causing the delay
}

export interface OverloadedWeek {
    weekKey: string;         // e.g. "2026-W07"
    weekStart: string;       // ISO date
    department: string;
    scheduledPoints: number;
    capacity: number;        // 850
    excess: number;
    jobCount: number;
}

/**
 * OT Tier Breakdown — shows exactly what level of overtime is needed
 * and why, for each overloaded week × department.
 *
 * Normal day:   8 hrs (6am–2:30pm)  → base capacity = 850pts/wk (40hrs)
 * Tier 1:       9 hrs Mon-Fri       → +5hrs/wk   ≈ +106pts
 * Tier 2:      10 hrs Mon-Fri       → +10hrs/wk  ≈ +213pts
 * Tier 3:       9 hrs Mon-Fri + Sat → +11hrs/wk  ≈ +234pts
 * Tier 4:      10 hrs Mon-Fri + Sat → +16hrs/wk  ≈ +341pts
 */
export interface OTRecommendation {
    weekKey: string;
    weekStart: string;
    department: string;
    currentLoad: number;
    baseCapacity: number;        // 850
    excess: number;              // currentLoad - 850
    recommendedTier: 1 | 2 | 3 | 4;
    tierLabel: string;
    bonusPoints: number;         // Points added by this tier
    remainingExcess: number;     // excess - bonusPoints (negative = cleared)
    explanation: string;         // Human-readable WHY
    weekdayHours: string;        // "6:00am – 3:30pm" etc.
    saturdayHours: string;       // "N/A" or "6:00am – 12:00pm"
}

/**
 * A single move option — the system presents BOTH WO-level and SO-level
 * versions with impact analysis. The user decides which to apply.
 */
export interface MoveOption {
    type: 'work_order' | 'sales_order';
    id: string;                   // WO# or SO#
    name: string;
    jobIds: string[];             // Jobs affected (1 for WO, multiple for SO)
    currentDueDate: string;
    pushWeeks: 1 | 2;            // Max 2 weeks — never 3
    suggestedDueDate: string;
    pointsRelieved: number;      // Total points removed from overloaded weeks
    affectedWeeks: string[];     // Which week keys get relief
    affectedDepartments: string[];
    riskLevel: 'safe' | 'moderate';
    // safe = moved job(s) won't be late after push
    // moderate = moved job(s) may cut it close

    // Impact Analysis
    lateJobsBefore: number;      // Total late jobs BEFORE this move
    lateJobsAfter: number;       // Total late jobs AFTER this move (projected)
    lateJobsRecovered: string[]; // Which job IDs come back on-time
    impactSummary: string;       // "Recovers 3 late jobs, relieves 240pts from Engineering Feb 10"
}

export interface ScheduleInsights {
    // ── Current State ──
    lateJobs: LateJob[];
    overloadedWeeks: OverloadedWeek[];

    // ── Decision Options ──
    moveOptions: MoveOption[];       // Both WO and SO options, with impact analysis
    otRecommendations: OTRecommendation[];

    // ── Projected Outcome ──
    projectedWithMoves: {
        lateJobs: LateJob[];         // Late jobs remaining after best moves
        overloadedWeeks: OverloadedWeek[];
    };
    projectedWithMovesAndOT: {
        lateJobs: LateJob[];         // Late jobs remaining after moves + OT
        overloadedWeeks: OverloadedWeek[];
    };

    // ── Summary Stats ──
    summary: {
        totalJobs: number;
        onTimeJobs: number;
        lateJobCount: number;
        weeksRequiringOT: number;
        totalExcessPoints: number;
        // Projected
        projectedLateAfterMoves: number;
        projectedLateAfterOT: number;
    };

    // Alert-aware context (present when active supervisor alerts are provided)
    alertImpact?: ScheduleAlertImpact;
}

