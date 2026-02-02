export type ProductType = 'FAB' | 'DOORS' | 'HARMONIC';

export type Department =
    | 'Engineering'
    | 'Laser'
    | 'Press Brake'
    | 'Welding'
    | 'Polishing'
    | 'Assembly'
    | 'Shipping';

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
    description: string; // PART_DESCRIPTION
    notes: string; // USER_7

    // Calculated Schedule
    scheduledStartDate?: Date;
    scheduledStartDate?: Date;
    scheduledEndDate?: Date;
    isOverdue?: boolean;
    departmentSchedule?: Record<string, { start: string; end: string }>; // Stored as ISO strings for Firestore compatibility

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
