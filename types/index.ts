export type ProductType = 'FAB' | 'DOORS' | 'HARMONIC';

export type Department =
    | 'Engineering'
    | 'Laser'
    | 'Press Brake'
    | 'Welding'
    | 'Polishing'
    | 'Assembly';

export type JobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'HOLD';

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
    requiresPainting?: boolean; // HARMONIC jobs that need off-site painting (adds ~1 week to Assembly)

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

// ---- Schedule Insights (returned from pipeline alongside jobs) ----

export interface LateJob {
    jobId: string;
    jobName: string;
    salesOrder?: string;
    dueDate: string;           // ISO date
    estimatedCompletion: string; // ISO date — without OT
    estimatedWithOT: string;    // ISO date — with Saturday OT
    daysLate: number;
    daysLateWithOT: number;
    points: number;
    bottleneckDept: string;     // Department causing the delay
}

export interface OverloadedWeek {
    weekKey: string;         // e.g. "2026-W07"
    weekStart: string;       // ISO date
    department: string;
    scheduledPoints: number;
    capacity: number;        // 850
    excess: number;
    estimatedOTHours: number;
    jobCount: number;
}

export interface MoveSuggestion {
    type: 'work_order' | 'sales_order';
    id: string;              // WO number or SO number
    name: string;            // Job/project name
    currentDueDate: string;  // ISO date
    suggestedDueDate: string;// Moving to this date relieves pressure
    pointsRelieved: number;
    benefitDescription: string; // "Frees 120pts from Welding W07"
    jobsAffected: string[];  // Job IDs in this sales order (for SO moves)
}

export interface ScheduleInsights {
    lateJobs: LateJob[];
    overloadedWeeks: OverloadedWeek[];
    moveSuggestions: MoveSuggestion[];
    summary: {
        totalJobs: number;
        onTimeJobs: number;
        lateJobCount: number;
        weeksRequiringOT: number;
        totalExcessPoints: number;
    };
}
