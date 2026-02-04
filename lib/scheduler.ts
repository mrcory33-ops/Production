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

// ============================================================================
// CAPACITY-AWARE SCHEDULING (NEW)
// ============================================================================

/**
 * Tracks daily capacity usage per department
 * Structure: { "2026-02-04": { "Welding": 150, "Laser": 200, ... }, ... }
 */
export type CapacityBuckets = Record<string, Record<Department, number>>;

/**
 * Initialize empty capacity buckets for a date range
 */
export const initBuckets = (startDate: Date, endDate: Date): CapacityBuckets => {
    const buckets: CapacityBuckets = {};
    let current = new Date(startDate);

    while (current <= endDate) {
        const dateKey = current.toISOString().split('T')[0];
        buckets[dateKey] = {
            Engineering: 0,
            Laser: 0,
            'Press Brake': 0,
            Welding: 0,
            Polishing: 0,
            Assembly: 0,
            Shipping: 0
        };
        current = addDays(current, 1);
    }

    return buckets;
};

/**
 * Check if a job can fit within capacity limits
 * @param job - The job to schedule
 * @param startDate - Proposed start date (first department)
 * @param buckets - Current capacity usage
 * @param maxDaily - Maximum points per day per department (default 300)
 * @returns true if job fits without exceeding limits
 */
export const canFitJob = (
    job: Job,
    startDate: Date,
    buckets: CapacityBuckets,
    maxDaily: number = 300
): boolean => {
    const durations = calculateAllDurations(job);
    let deptStartDate = new Date(startDate);

    // Check each department sequentially (they run in order, not parallel)
    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0); // Full days only
        if (duration === 0) continue;

        // Daily load for THIS department (points spread over duration)
        const dailyLoad = (job.weldingPoints || 0) / Math.max(duration, 1);

        // Check each work day for this department
        let dayDate = new Date(deptStartDate);
        for (let i = 0; i < duration; i++) {
            // Skip weekends
            while (isSaturday(dayDate) || isSunday(dayDate)) {
                dayDate = addDays(dayDate, 1);
            }

            const dateKey = dayDate.toISOString().split('T')[0];
            const currentLoad = buckets[dateKey]?.[dept] || 0;

            // Allow override, otherwise use department config limits
            const limit = maxDaily === 300 ? (DEPARTMENT_CONFIG[dept]?.dailyCapacity || 195) : maxDaily;

            if (currentLoad + dailyLoad > limit) {
                return false; // Exceeds capacity
            }

            dayDate = addDays(dayDate, 1);
        }

        // Next department starts after this one ends
        deptStartDate = new Date(dayDate);
    }

    return true;
};

/**
 * Reserve capacity for a job in the buckets
 * @param job - The job to reserve capacity for
 * @param startDate - Start date of the job (first department)
 * @param buckets - Capacity buckets to update (mutated in place)
 */
export const reserveCapacity = (
    job: Job,
    startDate: Date,
    buckets: CapacityBuckets
): void => {
    const durations = calculateAllDurations(job);
    let deptStartDate = new Date(startDate);

    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration === 0) continue;

        const dailyLoad = (job.weldingPoints || 0) / Math.max(duration, 1);

        let dayDate = new Date(deptStartDate);
        for (let i = 0; i < duration; i++) {
            // Skip weekends
            while (isSaturday(dayDate) || isSunday(dayDate)) {
                dayDate = addDays(dayDate, 1);
            }

            const dateKey = dayDate.toISOString().split('T')[0];
            if (!buckets[dateKey]) {
                buckets[dateKey] = {
                    Engineering: 0,
                    Laser: 0,
                    'Press Brake': 0,
                    Welding: 0,
                    Polishing: 0,
                    Assembly: 0,
                    Shipping: 0
                };
            }
            buckets[dateKey][dept] += dailyLoad;
            dayDate = addDays(dayDate, 1);
        }

        // Next department starts after this one ends
        deptStartDate = new Date(dayDate);
    }
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

const normalizeWorkEnd = (date: Date, allowSaturday: boolean = false): Date => {
    let current = startOfDay(date);
    while (isSunday(current) || (!allowSaturday && isSaturday(current))) {
        current = subDays(current, 1);
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
    let lastDeptEnd: Date | null = null;

    for (const dept of deptOrder.slice(currentIndex)) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;
        const start = new Date(cursorDate);
        const end = addWorkDays(start, Math.max(duration - 1, 0));
        deptSchedules[dept] = { start, end };

        // Next department starts the day after this one ends
        cursorDate = addWorkDays(end, 1);
        lastDeptEnd = end;
    }

    const forecastEnd = lastDeptEnd ? new Date(lastDeptEnd) : new Date(cursorDate);
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
// ============================================================================
// TWO-PASS CAPACITY-AWARE SCHEDULER (NEW)
// ============================================================================

/**
 * Check if a specific department can fit in a date range
 */
const canFitDepartment = (
    dept: Department,
    startDate: Date,
    endDate: Date,
    duration: number,
    points: number,
    buckets: CapacityBuckets
): boolean => {
    const dailyLoad = points / Math.max(duration, 1);
    const limit = DEPARTMENT_CONFIG[dept]?.dailyCapacity || 195;

    let dayDate = new Date(startDate);
    for (let i = 0; i < duration; i++) {
        // Skip weekends
        while (isSaturday(dayDate) || isSunday(dayDate)) {
            dayDate = addDays(dayDate, 1);
        }

        const dateKey = dayDate.toISOString().split('T')[0];
        const currentLoad = buckets[dateKey]?.[dept] || 0;

        if (currentLoad + dailyLoad > limit) {
            return false; // Exceeds capacity
        }

        dayDate = addDays(dayDate, 1);
    }

    return true;
};

/**
 * Reserve capacity for a specific department in a date range
 */
const reserveDepartmentCapacity = (
    dept: Department,
    startDate: Date,
    duration: number,
    points: number,
    buckets: CapacityBuckets
): void => {
    const dailyLoad = points / Math.max(duration, 1);

    let dayDate = new Date(startDate);
    for (let i = 0; i < duration; i++) {
        // Skip weekends
        while (isSaturday(dayDate) || isSunday(dayDate)) {
            dayDate = addDays(dayDate, 1);
        }

        const dateKey = dayDate.toISOString().split('T')[0];

        if (!buckets[dateKey]) {
            buckets[dateKey] = {
                Engineering: 0,
                Laser: 0,
                'Press Brake': 0,
                Welding: 0,
                Polishing: 0,
                Assembly: 0,
                Shipping: 0
            };
        }

        buckets[dateKey][dept] += dailyLoad;
        dayDate = addDays(dayDate, 1);
    }
};

/**
 * Schedule a job backward from its due date
 * Assembly finishes on (or just before) due date, then work backwards through departments
 */
const scheduleBackwardFromDue = (
    job: Job,
    buckets: CapacityBuckets
): Job => {
    const dueDate = normalizeWorkEnd(new Date(job.dueDate));
    const today = normalizeWorkStart(new Date());
    const durations = calculateAllDurations(job);

    // Determine which departments to schedule (only remaining if job is in progress)
    const currentDeptIndex = job.currentDepartment
        ? DEPARTMENTS.indexOf(job.currentDepartment as Department)
        : 0;
    const remainingDepts = currentDeptIndex >= 0
        ? DEPARTMENTS.slice(currentDeptIndex)
        : DEPARTMENTS;

    // DEBUG logging for sample jobs
    if (Math.random() < 0.05 || job.name.includes('HECTOR') || job.name.includes('CARNIVAL')) {
        console.log(`[SCHEDULER] ${job.name} (${job.weldingPoints}pts)`);
        console.log(`  Due: ${dueDate.toISOString().split('T')[0]}`);
        console.log(`  Remaining Depts: ${remainingDepts.join(' → ')}`);
    }

    const departmentSchedule: Record<string, { start: string; end: string }> = {};
    const scheduledDepartmentByDate: Record<string, Department> = {};
    let hasConflict = false;

    // Start from the end (Assembly) and work backwards
    let currentEnd = new Date(dueDate);

    // Schedule each department backwards
    for (let i = remainingDepts.length - 1; i >= 0; i--) {
        const dept = remainingDepts[i];
        const duration = Math.ceil(durations[dept] || 0);

        if (duration <= 0) continue;

        // Calculate ideal start for this department (inclusive end date)
        let deptStart = subtractWorkDays(currentEnd, Math.max(duration - 1, 0));
        let deptEnd = new Date(currentEnd);

        // Check if this slot has capacity
        let attempts = 0;
        const maxAttempts = 60; // Try up to 60 days earlier

        // Log initial attempt for HECTOR jobs
        if (job.name.includes('HECTOR')) {
            console.log(`  ${dept}: Trying ${deptStart.toISOString().split('T')[0]} to ${deptEnd.toISOString().split('T')[0]} (${duration} days)`);
        }

        while (!canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets) && attempts < maxAttempts) {
            // Shift this department block earlier by 1 work day
            deptStart = subtractWorkDays(deptStart, 1);
            deptEnd = subtractWorkDays(deptEnd, 1);
            attempts++;

            // Log shifting for HECTOR jobs
            if (job.name.includes('HECTOR') && attempts % 10 === 0) {
                console.log(`    Shifted ${attempts} times, now trying: ${deptStart.toISOString().split('T')[0]}`);
            }
        }

        // Log final placement for HECTOR jobs
        if (job.name.includes('HECTOR')) {
            console.log(`  ${dept}: PLACED at ${deptStart.toISOString().split('T')[0]} to ${deptEnd.toISOString().split('T')[0]} (shifted ${attempts} times)`);
        }

        // Check if we had to push before today
        if (isBefore(deptStart, today)) {
            hasConflict = true;
        }

        // Reserve capacity for this department
        if (canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets)) {
            reserveDepartmentCapacity(dept, deptStart, duration, job.weldingPoints || 0, buckets);
        } else {
            hasConflict = true; // Couldn't find capacity even after shifting
        }

        // Record the schedule
        departmentSchedule[dept] = {
            start: deptStart.toISOString(),
            end: deptEnd.toISOString()
        };

        // Track daily assignments
        let dateCursor = new Date(deptStart);
        while (dateCursor <= deptEnd) {
            const dateKey = dateCursor.toISOString().split('T')[0];
            scheduledDepartmentByDate[dateKey] = dept;
            dateCursor = addDays(dateCursor, 1);
        }

        // Next department (going backwards) ends where this one starts
        currentEnd = subtractWorkDays(deptStart, 1);
    }

    // The overall start date is the first department's start
    const firstDept = remainingDepts[0];
    const scheduledStartDate = departmentSchedule[firstDept]
        ? new Date(departmentSchedule[firstDept].start)
        : today;

    const isOverdue = isBefore(scheduledStartDate, today);

    return {
        ...job,
        scheduledStartDate,
        isOverdue,
        departmentSchedule,
        scheduledDepartmentByDate,
        schedulingConflict: hasConflict,
        progressStatus: hasConflict ? 'STALLED' : 'ON_TRACK'
    };
};

/**
 * Schedule a single job with capacity awareness
 * Goal: Schedule job to finish just before due date, respecting capacity limits
 */
const scheduleJobWithCapacity = (
    job: Job,
    buckets: CapacityBuckets,
    mode: 'backward' | 'forward' = 'backward'
): Job => {
    const durations = calculateAllDurations(job);
    const dueDate = new Date(job.dueDate);
    const today = normalizeWorkStart(new Date());

    // Calculate total duration across all departments
    const totalDuration = Math.ceil(Object.values(durations).reduce((sum, d) => sum + d, 0));

    let startDate: Date;
    let hasConflict = false;

    // Calculate ideal start: finish just before due date
    const idealStart = subtractWorkDays(dueDate, Math.max(totalDuration - 1, 0) + BUFFER_DAYS);

    // DEBUG LOGGING
    if (Math.random() < 0.05 || job.name.includes('CARNIVAL')) {
        console.log(`[SCHEDULER] Job: ${job.name} (${mode})`);
        console.log(`- Due: ${dueDate.toISOString().split('T')[0]}`);
        console.log(`- Duration: ${totalDuration} days`);
        console.log(`- Ideal Start: ${idealStart.toISOString().split('T')[0]}`);
        console.log(`- Today: ${today.toISOString().split('T')[0]}`);
    }

    if (mode === 'backward') {
        // Big Rocks: Target the ideal position, but not before today

        if (isBefore(idealStart, today)) {
            // Job is already "late" - must start today
            startDate = new Date(today);

            // Check if starting today will cause us to miss due date
            const projectedEnd = addWorkDays(startDate, Math.max(totalDuration - 1, 0));
            if (isBefore(dueDate, projectedEnd)) {
                hasConflict = true; // Will miss due date
            }
        } else {
            // Job has time - schedule near due date
            startDate = new Date(idealStart);
        }

        // Try to fit at the ideal/today position first
        if (!canFitJob(job, startDate, buckets)) {
            // Capacity exceeded - try shifting FORWARD a few days first
            // (maybe tomorrow has capacity)
            let forwardAttempts = 0;
            const maxForward = 10; // Try 10 days forward
            let forwardDate = addWorkDays(startDate, 1);

            while (!canFitJob(job, forwardDate, buckets) && forwardAttempts < maxForward) {
                forwardDate = addWorkDays(forwardDate, 1);
                forwardAttempts++;
            }

            if (canFitJob(job, forwardDate, buckets)) {
                // Found a slot slightly later - might miss due date
                startDate = forwardDate;
                const projectedEnd = addWorkDays(startDate, Math.max(totalDuration - 1, 0));
                if (isBefore(dueDate, projectedEnd)) {
                    hasConflict = true;
                }
            } else {
                // Still no capacity - shift backward from ideal as last resort
                let backwardAttempts = 0;
                const maxBackward = 30; // Max 30 days earlier
                let backwardDate = subtractWorkDays(idealStart, 1);

                while (!canFitJob(job, backwardDate, buckets) && backwardAttempts < maxBackward && !isBefore(backwardDate, today)) {
                    backwardDate = subtractWorkDays(backwardDate, 1);
                    backwardAttempts++;
                }

                if (canFitJob(job, backwardDate, buckets) && !isBefore(backwardDate, today)) {
                    startDate = backwardDate;
                } else {
                    // Can't find capacity anywhere - just schedule at ideal and flag
                    hasConflict = true;
                }
            }
        }
    } else {
        // Small Rocks (forward mode): Start from their ideal position, shift forward if needed
        // NOT from today - we want them near their due date too!

        if (isBefore(idealStart, today)) {
            startDate = new Date(today);
        } else {
            startDate = new Date(idealStart);
        }

        let attempts = 0;
        const maxAttempts = 30; // Look ahead up to 30 work days

        while (!canFitJob(job, startDate, buckets) && attempts < maxAttempts) {
            startDate = addWorkDays(startDate, 1);
            attempts++;
        }

        // Check if we pushed past due date
        const projectedEnd = addWorkDays(startDate, Math.max(totalDuration - 1, 0));
        if (isBefore(dueDate, projectedEnd)) {
            hasConflict = true;
        }

        if (!canFitJob(job, startDate, buckets)) {
            hasConflict = true;
        }
    }

    // Reserve capacity if job fits
    if (canFitJob(job, startDate, buckets)) {
        reserveCapacity(job, startDate, buckets);
    }

    // Assign schedule
    const scheduledJob = assignScheduleFromStart(job, startDate, durations);
    scheduledJob.schedulingConflict = hasConflict;

    return scheduledJob;
};

/**
 * Assign department schedules starting from a given date
 */
const assignScheduleFromStart = (
    job: Job,
    startDate: Date,
    durations: Record<Department, number>
): Job => {
    let cursorDate = new Date(startDate);
    const departmentSchedule: Record<string, { start: string; end: string }> = {};
    const scheduledDepartmentByDate: Record<string, Department> = {};

    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;

        const start = new Date(cursorDate);
        const end = addWorkDays(start, Math.max(duration - 1, 0));

        departmentSchedule[dept] = {
            start: start.toISOString(),
            end: end.toISOString()
        };

        // Track which department should be active on each date (for slippage detection)
        let dateCursor = new Date(start);
        while (dateCursor <= end) {
            const dateKey = dateCursor.toISOString().split('T')[0];
            scheduledDepartmentByDate[dateKey] = dept;
            dateCursor = addDays(dateCursor, 1);
        }
        cursorDate = addWorkDays(end, 1);
    }

    const isOverdue = isBefore(startDate, startOfDay(new Date()));

    return {
        ...job,
        scheduledStartDate: startDate,
        isOverdue,
        departmentSchedule,
        scheduledDepartmentByDate,
        progressStatus: 'ON_TRACK' // Initial status
    };
};

/**
 * Unified Backward Scheduler - All jobs scheduled from due date backwards
 * Priority: Due Date (ASC), then Size (DESC)
 */
export const scheduleAllJobs = (jobs: Job[], existingJobs: Job[] = []): Job[] => {
    console.log('🔥 NEW SCHEDULER RUNNING - Backward from Due Date Algorithm');
    console.log(`Scheduling ${jobs.length} jobs...`);

    // Initialize capacity buckets for next 120 days
    const today = startOfDay(new Date());
    const endDate = addDays(today, 120);
    const buckets = initBuckets(today, endDate);

    // Reserve capacity for existing scheduled jobs (if preserving)
    for (const existingJob of existingJobs) {
        if (existingJob.scheduledStartDate && existingJob.departmentSchedule) {
            reserveCapacity(existingJob, existingJob.scheduledStartDate, buckets);
        }
    }

    // Sort ALL jobs: Due Date ASC, then Points DESC (bigger jobs first)
    const sorted = [...jobs].sort((a, b) => {
        const aDue = new Date(a.dueDate).getTime();
        const bDue = new Date(b.dueDate).getTime();
        if (aDue !== bDue) return aDue - bDue;
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    });

    const scheduled: Job[] = [];

    // Schedule each job backward from its due date
    for (const job of sorted) {
        const result = scheduleBackwardFromDue(job, buckets);
        scheduled.push(result);
    }

    return scheduled;
};

/**
 * Track progress for existing jobs (called during daily CSV sync)
 */
export const trackJobProgress = (job: Job, previousJob: Job | null): Job => {
    const updatedJob = { ...job };

    // Check if department changed
    if (previousJob && previousJob.currentDepartment !== job.currentDepartment) {
        updatedJob.lastDepartmentChange = new Date();
    } else if (previousJob?.lastDepartmentChange) {
        updatedJob.lastDepartmentChange = previousJob.lastDepartmentChange;
    }

    // Check if stalled (no movement for 2+ days)
    if (updatedJob.lastDepartmentChange) {
        const daysSinceChange = Math.floor(
            (new Date().getTime() - new Date(updatedJob.lastDepartmentChange).getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceChange >= 2) {
            // Check if behind schedule
            const today = startOfDay(new Date());
            const todayKey = today.toISOString().split('T')[0];
            const expectedDept = previousJob?.scheduledDepartmentByDate?.[todayKey];

            const deptOrder = DEPARTMENTS;
            const currentIndex = deptOrder.indexOf(job.currentDepartment as DepartmentName);
            const expectedIndex = expectedDept ? deptOrder.indexOf(expectedDept) : -1;

            if (expectedIndex !== -1 && currentIndex < expectedIndex) {
                updatedJob.progressStatus = 'STALLED';
            }
        }
    }

    // Check if slipping (behind schedule but moving)
    if (previousJob?.scheduledDepartmentByDate) {
        const today = startOfDay(new Date());
        const todayKey = today.toISOString().split('T')[0];
        const expectedDept = previousJob.scheduledDepartmentByDate[todayKey];

        if (expectedDept) {
            const deptOrder = DEPARTMENTS;
            const currentIndex = deptOrder.indexOf(job.currentDepartment as DepartmentName);
            const expectedIndex = deptOrder.indexOf(expectedDept);

            if (currentIndex < expectedIndex) {
                updatedJob.progressStatus = 'SLIPPING';
            } else if (updatedJob.progressStatus !== 'STALLED') {
                updatedJob.progressStatus = 'ON_TRACK';
            }
        }
    }

    return updatedJob;
};
