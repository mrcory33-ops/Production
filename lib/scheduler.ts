import { Job, Department, ProductType } from '@/types';
import { addDays, isSaturday, isSunday, subDays, startOfDay, isBefore } from 'date-fns';
import { DEPARTMENT_CONFIG, calculateDeptDuration } from './departmentConfig';

// Configuration Constants
const BUFFER_DAYS = 2; // Days before due date to finish Assembly

const DEPARTMENTS: Department[] = [
    'Engineering',
    'Laser',
    'Press Brake',
    'Welding',
    'Polishing',
    'Assembly'
];

export type DepartmentName = Department;

export interface OvertimeConfig {
    enabled: boolean;
    saturdayCapacityMultiplier: number; // e.g., 0.5 for half day
}

// Default overtime config
let overtimeConfig: OvertimeConfig = {
    enabled: false,
    saturdayCapacityMultiplier: 0.5
};

export const setOvertimeConfig = (config: Partial<OvertimeConfig>) => {
    overtimeConfig = { ...overtimeConfig, ...config };
};

/**
 * Calculates the number of work days needed for a job in a specific department.
 * Uses department-specific capacity from departmentConfig.
 */
export const calculateDuration = (points: number, dept: DepartmentName, productType: ProductType = 'FAB'): number => {
    return calculateDeptDuration(dept, points, productType);
};

const normalizeWorkStart = (date: Date, allowSaturday: boolean = false): Date => {
    let current = startOfDay(date);
    while (isSunday(current) || (!allowSaturday && isSaturday(current))) {
        current = addDays(current, 1);
    }
    return current;
};

/**
 * Subtracts work days from a date, skipping weekends (or just Sunday if overtime enabled).
 */
export const subtractWorkDays = (date: Date, days: number, allowSaturday: boolean = false): Date => {
    let remaining = days;
    let current = new Date(date);

    while (remaining > 0) {
        current = subDays(current, 1);
        const isWorkDay = !isSunday(current) && (allowSaturday || !isSaturday(current));
        if (isWorkDay) {
            remaining -= 1;
        }
    }
    return current;
};

/**
 * Adds work days to a date, skipping weekends (or just Sunday if overtime enabled).
 */
export const addWorkDays = (date: Date, days: number, allowSaturday: boolean = false): Date => {
    let remaining = days;
    let current = new Date(date);

    while (remaining > 0) {
        current = addDays(current, 1);
        const isWorkDay = !isSunday(current) && (allowSaturday || !isSaturday(current));
        if (isWorkDay) {
            remaining -= 1;
        }
    }
    return current;
};

/**
 * Calculate durations for all departments for a given job
 */
const calculateAllDurations = (job: Job): Record<Department, number> => {
    const points = job.weldingPoints || 0;
    const productType = job.productType || 'FAB';

    return {
        Engineering: calculateDuration(points, 'Engineering', productType),
        Laser: calculateDuration(points, 'Laser', productType),
        'Press Brake': calculateDuration(points, 'Press Brake', productType),
        Welding: calculateDuration(points, 'Welding', productType),
        Polishing: calculateDuration(points, 'Polishing', productType),
        Assembly: calculateDuration(points, 'Assembly', productType),
        Shipping: 0
    };
};

/**
 * Main Scheduling Function - Welding-Centric (Drum-Buffer-Rope)
 * 
 * 1. Sort jobs by due date (primary), size descending (secondary)
 * 2. Schedule Welding first, then work backwards and forwards
 */
export const scheduleJobs = (jobs: Job[]): Job[] => {
    // Sort by due date (primary), then by size descending (secondary)
    // Larger jobs due later may need to start before smaller jobs due earlier
    const sorted = [...jobs].sort((a, b) => {
        const aDue = new Date(a.dueDate).getTime();
        const bDue = new Date(b.dueDate).getTime();
        if (aDue !== bDue) return aDue - bDue;
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    });

    const scheduledJobs: Job[] = [];

    for (const job of sorted) {
        const scheduled = scheduleJobFromWelding(job);
        scheduledJobs.push(scheduled);
    }

    return scheduledJobs;
};

/**
 * Schedule a single job, starting from Welding and working outward
 * (Drum-Buffer-Rope: Welding is the constraint/heartbeat)
 */
const scheduleJobFromWelding = (job: Job, allowSaturday: boolean = false): Job => {
    const dueDate = new Date(job.dueDate);

    // Calculate durations for each department
    const durations = calculateAllDurations(job);

    // Work backwards from due date to find Welding slot
    const cursorDate = subtractWorkDays(dueDate, BUFFER_DAYS, allowSaturday);

    // Assembly (works backwards from buffer)
    const assemblyEnd = cursorDate;
    const assemblyStart = subtractWorkDays(assemblyEnd, durations.Assembly, allowSaturday);

    // Polishing
    // End date is day before Assembly starts
    const polishingEnd = subtractWorkDays(assemblyStart, 1, allowSaturday);
    const polishingStart = subtractWorkDays(polishingEnd, durations.Polishing, allowSaturday);

    // WELDING (THE HEARTBEAT)
    const weldingEnd = subtractWorkDays(polishingStart, 1, allowSaturday);
    const weldingStart = subtractWorkDays(weldingEnd, durations.Welding, allowSaturday);

    // Press Brake
    const pressBrakeEnd = subtractWorkDays(weldingStart, 1, allowSaturday);
    const pressBrakeStart = subtractWorkDays(pressBrakeEnd, durations['Press Brake'], allowSaturday);

    // Laser
    const laserEnd = subtractWorkDays(pressBrakeStart, 1, allowSaturday);
    const laserStart = subtractWorkDays(laserEnd, durations.Laser, allowSaturday);

    // Engineering
    const engineeringEnd = subtractWorkDays(laserStart, 1, allowSaturday);
    const engineeringStart = subtractWorkDays(engineeringEnd, durations.Engineering, allowSaturday);

    // Build schedule object
    const departmentSchedule: Record<string, { start: string; end: string }> = {
        Engineering: { start: engineeringStart.toISOString(), end: engineeringEnd.toISOString() },
        Laser: { start: laserStart.toISOString(), end: laserEnd.toISOString() },
        'Press Brake': { start: pressBrakeStart.toISOString(), end: pressBrakeEnd.toISOString() },
        Welding: { start: weldingStart.toISOString(), end: weldingEnd.toISOString() },
        Polishing: { start: polishingStart.toISOString(), end: polishingEnd.toISOString() },
        Assembly: { start: assemblyStart.toISOString(), end: assemblyEnd.toISOString() }
    };

    // Check if overdue
    const isOverdue = isBefore(engineeringStart, startOfDay(new Date()));

    // If overdue and overtime not yet tried, try with Saturday
    if (isOverdue && overtimeConfig.enabled && !allowSaturday) {
        return scheduleJobFromWelding(job, true);
    }

    return {
        ...job,
        scheduledStartDate: engineeringStart,
        isOverdue,
        departmentSchedule
    };
};

/**
 * Builds a forward schedule from the job's current department to the end.
 * This is used for "remaining work" bars and forecast due dates.
 */
export const applyRemainingSchedule = (job: Job, startDate: Date = new Date()): Job => {
    const deptOrder = [...DEPARTMENTS];
    const currentIndex = deptOrder.indexOf(job.currentDepartment as DepartmentName);

    if (currentIndex === -1) {
        return {
            ...job,
            forecastStartDate: job.scheduledStartDate,
            forecastDueDate: job.dueDate,
            remainingDepartmentSchedule: job.departmentSchedule
        };
    }

    const durations = calculateAllDurations(job);
    let cursorDate = normalizeWorkStart(startDate);
    const deptSchedules: Record<string, { start: Date; end: Date }> = {};

    for (const dept of deptOrder.slice(currentIndex)) {
        const duration = durations[dept] || 0;
        const start = new Date(cursorDate);
        const end = addWorkDays(start, duration);
        deptSchedules[dept] = { start, end };

        // Next department starts the day after this one ends
        cursorDate = addWorkDays(end, 1);
    }

    const forecastEnd = new Date(cursorDate);
    const forecastDueDate = addDays(forecastEnd, BUFFER_DAYS);

    const formattedSchedule: Record<string, { start: string; end: string }> = {};
    Object.entries(deptSchedules).forEach(([dept, dates]) => {
        formattedSchedule[dept] = {
            start: dates.start.toISOString(),
            end: dates.end.toISOString()
        };
    });

    const firstDept = deptOrder[currentIndex];

    return {
        ...job,
        forecastStartDate: deptSchedules[firstDept]?.start || cursorDate,
        forecastDueDate,
        remainingDepartmentSchedule: formattedSchedule
    };
};
