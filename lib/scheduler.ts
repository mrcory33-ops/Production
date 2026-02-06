import { Job, Department, ProductType } from '@/types';
import { addDays, isSaturday, isSunday, subDays, startOfDay, isBefore, startOfWeek } from 'date-fns';
import { DEPARTMENT_CONFIG, calculateDeptDuration } from './departmentConfig';
import { calculateUrgencyScore } from './scoring';
import { BIG_ROCK_CONFIG } from './scoringConfig';

// Scheduling Modes
export type SchedulingMode = 'IMPORT' | 'OPTIMIZE';

// Configuration Constants
const BUFFER_DAYS = 2; // Days before due date to finish Assembly
const MAX_DEPTS_PER_DAY_PER_JOB = 2;
const SMALL_JOB_THRESHOLD = 7; // Jobs < 7 points can have same-day dept transitions
const BATCH_WEEK_STARTS_ON = 1; // Monday
export const QUEUE_BUFFER_DAYS = 2; // Each department should maintain a 2-day work buffer
const WEEKLY_CAPACITY = 850; // Weekly capacity pool per department (pts/week)

const FRAME_KD_PATTERNS = [
    'frame knock down',
    'frames knock down',
    'frame knockdown',
    'frames knockdown',
    'frame kd',
    'frames kd',
    'kd frame',
    'knock down frame',
    'knockdown frame'
];

const FRAME_CO_PATTERNS = [
    'frame case opening',
    'frames case opening',
    'case opening frame',
    'case opening frames',
    'frame co',
    'frames co'
];

const DOOR_LOCK_SEAM_PATTERNS = [
    'door lock seam',
    'doors lock seam',
    'lock seam door',
    'lock seam doors'
];

export const DEPARTMENTS: Department[] = [
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

const normalizeBatchText = (value?: string): string =>
    (value || '')
        .toLowerCase()
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const matchesAny = (text: string, patterns: string[]): boolean =>
    patterns.some(pattern => text.includes(pattern));

const getBatchCategory = (text: string): 'FRAME_KD' | 'FRAME_CO' | 'DOOR_LOCK_SEAM' | null => {
    if (matchesAny(text, FRAME_KD_PATTERNS)) return 'FRAME_KD';
    if (matchesAny(text, FRAME_CO_PATTERNS)) return 'FRAME_CO';
    if (matchesAny(text, DOOR_LOCK_SEAM_PATTERNS)) return 'DOOR_LOCK_SEAM';
    return null;
};

const extractGauge = (text: string): string | null => {
    const gaMatch = text.match(/\b(\d{1,2})\s*(ga|gage)\b/);
    if (gaMatch) return gaMatch[1];

    const hashMatch = text.match(/#\s*(\d{2})\b/);
    if (hashMatch) return hashMatch[1];

    return null;
};

const extractMaterial = (text: string): string | null => {
    if (/\bss\s*316l\b/.test(text) || /\b316l\b/.test(text)) return 'SS316L';
    if (/\bss\s*316\b/.test(text) || /\b316\b/.test(text)) return 'SS316';
    if (/\bss\s*304\b/.test(text) || /\b304\b/.test(text)) return 'SS304';
    if (/\bstainless\b/.test(text) || /\bss\b/.test(text)) return 'STAINLESS';
    if (/\bgalvanized\b/.test(text) || /\bgalv\b/.test(text)) return 'GALV';
    if (/\baluminum\b/.test(text) || /\balum\b/.test(text)) return 'ALUM';
    if (/\bcrs\b/.test(text)) return 'CRS';
    if (/\bhrs\b/.test(text)) return 'HRS';
    if (/\bsteel\b/.test(text)) return 'STEEL';
    return null;
};

const getDueWeekStart = (dueDate: Date): Date =>
    startOfWeek(startOfDay(dueDate), { weekStartsOn: BATCH_WEEK_STARTS_ON });

const compareByDueDateAndSize = (a: Job, b: Job): number => {
    const aDue = new Date(a.dueDate).getTime();
    const bDue = new Date(b.dueDate).getTime();
    if (aDue !== bDue) return aDue - bDue;
    return (b.weldingPoints || 0) - (a.weldingPoints || 0);
};

const compareByUrgencyDueSize = (a: Job, b: Job): number => {
    const scoreDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
    if (Math.abs(scoreDiff) > 1) return scoreDiff;
    return compareByDueDateAndSize(a, b);
};

const orderJobsForBatching = (jobs: Job[], compareBase: (a: Job, b: Job) => number): Job[] => {
    type Group = {
        jobs: Job[];
        priority: number;
        weekTime: number;
        minDue: number;
        maxScore: number;
        maxPoints: number;
    };

    const grouped = new Map<string, { jobs: Job[]; priority: number; weekTime: number }>();
    const singles: Group[] = [];

    for (const job of jobs) {
        const text = normalizeBatchText(job.description || '');
        const category = getBatchCategory(text);
        const weekStart = getDueWeekStart(new Date(job.dueDate));
        const weekTime = weekStart.getTime();

        if (!category) {
            singles.push({
                jobs: [job],
                priority: 2,
                weekTime,
                minDue: new Date(job.dueDate).getTime(),
                maxScore: job.urgencyScore || 0,
                maxPoints: job.weldingPoints || 0
            });
            continue;
        }

        const gauge = extractGauge(text);
        const material = extractMaterial(text);
        const isStrict = Boolean(gauge && material);
        const key = isStrict
            ? `strict:${category}|${gauge}|${material}|${weekTime}`
            : `relaxed:${category}|${weekTime}`;

        if (!grouped.has(key)) {
            grouped.set(key, { jobs: [], priority: isStrict ? 0 : 1, weekTime });
        }
        grouped.get(key)!.jobs.push(job);
    }

    const groups: Group[] = [];
    grouped.forEach(group => {
        group.jobs.sort(compareBase);
        groups.push({
            jobs: group.jobs,
            priority: group.priority,
            weekTime: group.weekTime,
            minDue: Math.min(...group.jobs.map(j => new Date(j.dueDate).getTime())),
            maxScore: Math.max(...group.jobs.map(j => j.urgencyScore || 0)),
            maxPoints: Math.max(...group.jobs.map(j => j.weldingPoints || 0))
        });
    });

    singles.sort((a, b) => compareBase(a.jobs[0], b.jobs[0]));

    const ordered = [...groups, ...singles].sort((a, b) => {
        if (a.weekTime !== b.weekTime) return a.weekTime - b.weekTime;
        if (a.minDue !== b.minDue) return a.minDue - b.minDue;
        if (a.priority !== b.priority) return a.priority - b.priority;
        const scoreDiff = b.maxScore - a.maxScore;
        if (Math.abs(scoreDiff) > 1) return scoreDiff;
        return b.maxPoints - a.maxPoints;
    });

    return ordered.flatMap(group => group.jobs);
};

// ============================================================================
// OVERDUE JOB HANDLING
// ============================================================================

/**
 * Check if a job is overdue (due date is in the past)
 */
const isJobOverdue = (job: Job): boolean => {
    const today = startOfDay(new Date());
    const dueDate = startOfDay(new Date(job.dueDate));
    return isBefore(dueDate, today);
};

/**
 * Calculate how many days overdue a job is
 */
const getDaysOverdue = (job: Job): number => {
    const today = startOfDay(new Date());
    const dueDate = startOfDay(new Date(job.dueDate));
    if (!isBefore(dueDate, today)) return 0;

    let days = 0;
    let cursor = new Date(dueDate);
    while (isBefore(cursor, today)) {
        cursor = addDays(cursor, 1);
        if (!isSaturday(cursor) && !isSunday(cursor)) {
            days++;
        }
    }
    return days;
};

/**
 * Schedule a job forward from today (for overdue jobs)
 * Starts from the job's CURRENT department and works forward through remaining departments
 * These jobs get highest priority and reserved capacity first
 */
const scheduleForwardFromToday = (
    job: Job,
    buckets: CapacityBuckets
): Job => {
    const today = normalizeWorkStart(new Date());
    const durations = calculateAllDurations(job);
    const productType = job.productType || 'FAB';
    const points = job.weldingPoints || 0;

    const departmentSchedule: Record<string, { start: string; end: string }> = {};
    const scheduledDepartmentByDate: Record<string, Department> = {};

    // Find the index of the current department
    const currentDeptIndex = DEPARTMENTS.indexOf(job.currentDepartment);
    const remainingDepartments = currentDeptIndex >= 0
        ? DEPARTMENTS.slice(currentDeptIndex)
        : DEPARTMENTS; // Fallback to all departments if current dept not found

    let currentStart = new Date(today);

    // Schedule remaining departments forward from today
    for (const dept of remainingDepartments) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;

        // Skip weekends for start date
        while (isSaturday(currentStart) || isSunday(currentStart)) {
            currentStart = addDays(currentStart, 1);
        }

        const deptStart = new Date(currentStart);
        const deptEnd = addWorkDays(deptStart, Math.max(duration - 1, 0));

        // Reserve capacity
        reserveDepartmentCapacity(dept, deptStart, duration, points, buckets, productType, job.id);

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

        // Next department starts after this one ends (with gap based on size)
        let gapDays = 0;
        if (!job.noGaps) { // Respect no-gaps override
            if (points >= BIG_ROCK_CONFIG.threshold) {
                gapDays = 1; // Big rock: 1 day gap
            } else if (points > SMALL_JOB_THRESHOLD) {
                gapDays = 0.5; // Medium: 1/2 day gap
            }
        }

        currentStart = addWorkDays(deptEnd, gapDays + 1);
    }

    // Get the final end date from the last scheduled department
    const lastScheduledDept = remainingDepartments[remainingDepartments.length - 1];
    const scheduledEndDate = departmentSchedule[lastScheduledDept]
        ? new Date(departmentSchedule[lastScheduledDept].end)
        : today;

    // Get the start date from first scheduled department
    const firstScheduledDept = remainingDepartments[0];
    const scheduledStartDate = departmentSchedule[firstScheduledDept]
        ? new Date(departmentSchedule[firstScheduledDept].start)
        : today;

    return {
        ...job,
        scheduledStartDate,
        scheduledEndDate,
        departmentSchedule: departmentSchedule as Job['departmentSchedule'],
        scheduledDepartmentByDate,
        schedulingConflict: true, // Mark as conflict since it was overdue
        urgencyScore: calculateUrgencyScore(job).score,
        isOverdue: true // Flag for UI - this job was past due on import
    };
};

// ============================================================================
// CAPACITY-AWARE SCHEDULING
// ============================================================================

/**
 * Tracks daily capacity usage per department
 * Structure: { "2026-02-04": { "Welding": 150, "Laser": 200, ... }, ... }
 */
export type CapacityBuckets = Record<string, Record<Department, number> & {
    bigRockCount: Record<Department, number>;
    bigRockPoints: Record<Department, number>;
    bigRockJobIds: Record<Department, Set<string>>; // Track which jobs have been counted as big rocks
    poolUsage: Record<Department, Record<number, number>>; // Usage per pool index: { Welding: { 0: 50, 1: 100 } }
}> & {
    weeklyUsage: Record<string, Record<Department, number>>; // Usage per week: { "2026-W05": { "Welding": 450 } }
};

/**
 * Initialize empty capacity buckets for a date range
 */
export const initBuckets = (startDate: Date, endDate: Date): CapacityBuckets => {
    const buckets = { weeklyUsage: {} } as CapacityBuckets; // Initialize with weeklyUsage
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
            bigRockCount: {
                Engineering: 0,
                Laser: 0,
                'Press Brake': 0,
                Welding: 0,
                Polishing: 0,
                Assembly: 0
            },
            bigRockPoints: {
                Engineering: 0,
                Laser: 0,
                'Press Brake': 0,
                Welding: 0,
                Polishing: 0,
                Assembly: 0
            },
            bigRockJobIds: {
                Engineering: new Set(),
                Laser: new Set(),
                'Press Brake': new Set(),
                Welding: new Set(),
                Polishing: new Set(),
                Assembly: new Set()
            },
            poolUsage: {
                Engineering: {},
                Laser: {},
                'Press Brake': {},
                Welding: {},
                Polishing: {},
                Assembly: {}
            }
        };
        current = addDays(current, 1);
    }

    return buckets;
};

/**
 * Get week key for a date (ISO week format: YYYY-Www)
 */
const getWeekKey = (date: Date): string => {
    const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
    const year = weekStart.getFullYear();
    const oneJan = new Date(year, 0, 1);
    const weekNum = Math.ceil((((weekStart.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
};

/**
 * Check if adding points would exceed weekly capacity for a department
 */
const canFitInWeek = (
    date: Date,
    dept: Department,
    points: number,
    buckets: CapacityBuckets
): boolean => {
    const weekKey = getWeekKey(date);
    const currentUsage = buckets.weeklyUsage?.[weekKey]?.[dept] || 0;
    return (currentUsage + points) <= WEEKLY_CAPACITY;
};

/**
 * Reserve weekly capacity for a department
 */
const reserveWeeklyCapacity = (
    date: Date,
    dept: Department,
    points: number,
    buckets: CapacityBuckets
): void => {
    const weekKey = getWeekKey(date);
    if (!buckets.weeklyUsage[weekKey]) {
        buckets.weeklyUsage[weekKey] = {
            Engineering: 0,
            Laser: 0,
            'Press Brake': 0,
            Welding: 0,
            Polishing: 0,
            Assembly: 0
        };
    }
    buckets.weeklyUsage[weekKey][dept] += points;
};

/**
 * Calculate queue buffer depth for each department
 * Returns the number of work days queued for each department from a given start date
 * 
 * @param jobs - Scheduled jobs
 * @param fromDate - Date to start measuring from (default: today)
 * @returns Record of department -> days of work queued
 */
export const calculateQueueBuffer = (
    jobs: Job[],
    fromDate: Date = new Date()
): Record<Department, number> => {
    const startDate = startOfDay(fromDate);
    const queueDepth: Record<Department, number> = {
        Engineering: 0,
        Laser: 0,
        'Press Brake': 0,
        Welding: 0,
        Polishing: 0,
        Assembly: 0
    };

    // For each department, count consecutive work days with scheduled work
    for (const dept of DEPARTMENTS) {
        let currentDate = new Date(startDate);
        let consecutiveDays = 0;
        let foundGap = false;

        // Look ahead up to 10 days
        for (let i = 0; i < 10 && !foundGap; i++) {
            // Skip weekends
            while (isSaturday(currentDate) || isSunday(currentDate)) {
                currentDate = addDays(currentDate, 1);
            }

            // Check if any job is scheduled in this department on this date
            const dateKey = currentDate.toISOString().split('T')[0];
            const hasWork = jobs.some(job => {
                const schedule = job.departmentSchedule || job.remainingDepartmentSchedule;
                if (!schedule || !schedule[dept]) return false;

                const deptStart = new Date(schedule[dept].start);
                const deptEnd = new Date(schedule[dept].end);
                return currentDate >= deptStart && currentDate <= deptEnd;
            });

            if (hasWork) {
                consecutiveDays++;
            } else {
                foundGap = true;
            }

            currentDate = addDays(currentDate, 1);
        }

        queueDepth[dept] = consecutiveDays;
    }

    return queueDepth;
};

/**
 * Check if a job can fit within capacity limits
 * @param job - The job to schedule
 * @param startDate - Proposed start date (first department)
 * @param buckets - Current capacity usage
 * @param maxDaily - Maximum points per day per department (default 300)
 * @returns true if job fits without exceeding limits
 */
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
    maxDaily: number = 300 // Legacy param, now ignored - using weekly pools
): boolean => {
    const durations = calculateAllDurations(job);
    let deptStartDate = new Date(startDate);
    const jobPoints = job.weldingPoints || 0;

    // Check each department sequentially (they run in order, not parallel)
    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0); // Full days only
        if (duration === 0) continue;

        // For weekly pool, we check if the FULL job points fit in the week
        // (not daily load - the week absorbs the full job)

        // Get the first work day for this department to determine which week
        let dayDate = new Date(deptStartDate);
        while (isSaturday(dayDate) || isSunday(dayDate)) {
            dayDate = addDays(dayDate, 1);
        }

        // Check weekly capacity - can this job fit in the week?
        if (!canFitInWeek(dayDate, dept, jobPoints, buckets)) {
            return false; // Week is full
        }

        // Skip through the duration to find where next dept starts
        for (let i = 0; i < duration; i++) {
            while (isSaturday(dayDate) || isSunday(dayDate)) {
                dayDate = addDays(dayDate, 1);
            }
            dayDate = addDays(dayDate, 1);
        }

        // 2. Big Rock Constraints (still apply)
        const pts = job.weldingPoints || 0;
        if (pts >= BIG_ROCK_CONFIG.threshold) {
            const dateKey = deptStartDate.toISOString().split('T')[0];
            const currentBigCount = buckets[dateKey]?.bigRockCount?.[dept] || 0;
            const maxBigConcurrent = BIG_ROCK_CONFIG.maxConcurrent[dept] || 3;

            // Rule A: Max concurrent big rocks per day
            if (currentBigCount >= maxBigConcurrent) {
                return false; // Too many big rocks already
            }
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
    const productType = job.productType || 'FAB';

    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration === 0) continue;

        const dailyLoad = (job.weldingPoints || 0) / Math.max(duration, 1);

        // Identify Pool Index
        const deptConfig = DEPARTMENT_CONFIG[dept];
        const poolIndex = deptConfig?.pools.findIndex(p => !p.productTypes || p.productTypes.includes(productType)) ?? 0;

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
                    bigRockCount: {
                        Engineering: 0,
                        Laser: 0,
                        'Press Brake': 0,
                        Welding: 0,
                        Polishing: 0,
                        Assembly: 0
                    },
                    bigRockPoints: {
                        Engineering: 0,
                        Laser: 0,
                        'Press Brake': 0,
                        Welding: 0,
                        Polishing: 0,
                        Assembly: 0
                    },
                    bigRockJobIds: {
                        Engineering: new Set(),
                        Laser: new Set(),
                        'Press Brake': new Set(),
                        Welding: new Set(),
                        Polishing: new Set(),
                        Assembly: new Set()
                    },
                    poolUsage: {
                        Engineering: {},
                        Laser: {},
                        'Press Brake': {},
                        Welding: {},
                        Polishing: {},
                        Assembly: {}
                    }
                };
            }
            buckets[dateKey][dept] += dailyLoad;

            // Usage for specific pool
            const currentPoolUsage = buckets[dateKey].poolUsage[dept][poolIndex] || 0;
            buckets[dateKey].poolUsage[dept][poolIndex] = currentPoolUsage + dailyLoad;

            // Track Big Rocks - only count once per job per day
            if ((job.weldingPoints || 0) >= BIG_ROCK_CONFIG.threshold) {
                if (!buckets[dateKey].bigRockJobIds[dept].has(job.id)) {
                    buckets[dateKey].bigRockJobIds[dept].add(job.id);
                    buckets[dateKey].bigRockCount[dept] = (buckets[dateKey].bigRockCount[dept] || 0) + 1;
                }
                buckets[dateKey].bigRockPoints[dept] = (buckets[dateKey].bigRockPoints[dept] || 0) + dailyLoad;
            }
            dayDate = addDays(dayDate, 1);
        }

        // Reserve weekly capacity for this department (full job points for the week)
        reserveWeeklyCapacity(deptStartDate, dept, job.weldingPoints || 0, buckets);

        // Next department starts after this one ends
        // Gap logic: Small (≤7 pts) = 0 gap, Medium (8-49) = 1 day, Big Rock (≥50) = 2 days
        const jobPoints = job.weldingPoints || 0;
        let gapDays = 0;
        if (jobPoints >= BIG_ROCK_CONFIG.threshold) {
            gapDays = 2; // Big rock: 2 day gap
        } else if (jobPoints > SMALL_JOB_THRESHOLD) {
            gapDays = 1; // Medium: 1 day gap
        }
        // else: Small job - no gap (same day OK)

        if (gapDays > 0) {
            deptStartDate = addDays(dayDate, gapDays);
            // Skip weekend
            while (isSaturday(deptStartDate) || isSunday(deptStartDate)) {
                deptStartDate = addDays(deptStartDate, 1);
            }
        } else {
            deptStartDate = new Date(dayDate);
        }
    }
};


/**
 * Calculates the number of work days needed for a job in a specific department.
 * Uses department-specific capacity from departmentConfig.
 */
export const calculateDuration = (
    points: number,
    dept: DepartmentName,
    productType: ProductType = 'FAB',
    description?: string
): number => {
    return calculateDeptDuration(dept, points, productType, description);
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

const exceedsDailyDeptLimit = (
    start: Date,
    end: Date,
    dayCounts: Record<string, number>,
    maxPerDay: number
): boolean => {
    let cursor = new Date(start);
    while (cursor <= end) {
        if (isSaturday(cursor) || isSunday(cursor)) {
            cursor = addDays(cursor, 1);
            continue;
        }
        const key = cursor.toISOString().split('T')[0];
        const next = (dayCounts[key] || 0) + 1;
        if (next > maxPerDay) return true;
        cursor = addDays(cursor, 1);
    }
    return false;
};

const addDeptToDayCounts = (
    start: Date,
    end: Date,
    dayCounts: Record<string, number>
): void => {
    let cursor = new Date(start);
    while (cursor <= end) {
        if (isSaturday(cursor) || isSunday(cursor)) {
            cursor = addDays(cursor, 1);
            continue;
        }
        const key = cursor.toISOString().split('T')[0];
        dayCounts[key] = (dayCounts[key] || 0) + 1;
        cursor = addDays(cursor, 1);
    }
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
    const hasRef = (job.description || '').toUpperCase().includes('REF');

    return {
        Engineering: calculateDuration(points, 'Engineering', productType, job.description),
        Laser: calculateDuration(points, 'Laser', productType, job.description),
        'Press Brake': calculateDuration(points, 'Press Brake', productType, job.description),
        Welding: calculateDuration(points, 'Welding', productType, job.description),
        Polishing: calculateDuration(points, 'Polishing', productType, job.description),
        Assembly: Math.max(
            calculateDuration(points, 'Assembly', productType, job.description),
            hasRef ? 4 : 0
        )
    };
};

/**
 * Main Scheduling Function - Welding-Centric (Drum-Buffer-Rope)
 * 
 * 1. Sort jobs by due date (primary), size descending (secondary)
 * 2. Schedule Welding first, then work backwards and forwards
 */
/**
 * Main Scheduling Function with Mode Support
 * 
 * @param jobs - Jobs to schedule
 * @param mode - IMPORT (backward from due date) or OPTIMIZE (fill capacity with 70/30 rule)
 */
export const scheduleJobs = (jobs: Job[], mode: SchedulingMode = 'IMPORT'): Job[] => {
    if (mode === 'IMPORT') {
        return scheduleJobsImportMode(jobs);
    } else {
        return scheduleJobsOptimizeMode(jobs);
    }
};

/**
 * IMPORT Mode: Schedule backward from due dates
 * Each job is scheduled to finish on or before its due date
 * 
 * OVERDUE HANDLING: Jobs past their due date are scheduled forward from TODAY
 * with high priority (scheduled first, most overdue jobs get priority)
 */
const scheduleJobsImportMode = (jobs: Job[]): Job[] => {
    const buckets = initBuckets(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    );

    // Separate overdue vs on-time jobs
    const overdueJobs = jobs.filter(j => isJobOverdue(j));
    const onTimeJobs = jobs.filter(j => !isJobOverdue(j));

    // Sort overdue: most days overdue first, then by size (largest first)
    overdueJobs.sort((a, b) => {
        const aOverdue = getDaysOverdue(a);
        const bOverdue = getDaysOverdue(b);
        if (aOverdue !== bOverdue) return bOverdue - aOverdue; // Most overdue first
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    });

    // Sort on-time: by due date (earliest first), then by size (largest first)
    onTimeJobs.sort((a, b) => {
        const aDue = new Date(a.dueDate).getTime();
        const bDue = new Date(b.dueDate).getTime();
        if (aDue !== bDue) return aDue - bDue;
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    });

    const scheduledJobs: Job[] = [];

    // 1. Schedule OVERDUE jobs FIRST (forward from today)
    for (const job of overdueJobs) {
        const scheduled = scheduleForwardFromToday(job, buckets);
        scheduledJobs.push(scheduled);
    }

    // 2. Schedule ON-TIME jobs (backward from due date)
    for (const job of onTimeJobs) {
        const scheduled = scheduleBackwardFromDue(job, buckets);
        scheduledJobs.push(scheduled);
    }

    return scheduledJobs;
};

/**
 * OPTIMIZE Mode: Fill capacity with 70/30 rule (big rocks first, then smaller jobs)
 * 
 * Strategy:
 * 1. Separate jobs into big rocks (≥50 pts) and smaller jobs (<50 pts)
 * 2. Schedule big rocks first (sorted by due date) - aim for ~70% capacity
 * 3. Fill remaining capacity with smaller jobs - aim for ~30% capacity
 */
const scheduleJobsOptimizeMode = (jobs: Job[]): Job[] => {
    const buckets = initBuckets(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    );

    const scheduledJobs: Job[] = [];

    // =========================================================================
    // OVERDUE HANDLING - START (Delete this block to remove overdue priority)
    // =========================================================================
    const overdueJobs = jobs.filter(j => isJobOverdue(j));
    const nonOverdueJobs = jobs.filter(j => !isJobOverdue(j));

    // Schedule overdue first: most overdue → largest
    overdueJobs.sort((a, b) => {
        const aOverdue = getDaysOverdue(a);
        const bOverdue = getDaysOverdue(b);
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    });

    for (const job of overdueJobs) {
        const scheduled = scheduleForwardFromToday(job, buckets);
        scheduledJobs.push(scheduled);
    }
    // =========================================================================
    // OVERDUE HANDLING - END
    // =========================================================================

    // Separate remaining jobs into big rocks and smaller jobs
    const bigRocks = nonOverdueJobs.filter(j => (j.weldingPoints || 0) >= BIG_ROCK_CONFIG.threshold);
    const smallerJobs = nonOverdueJobs.filter(j => (j.weldingPoints || 0) < BIG_ROCK_CONFIG.threshold);

    bigRocks.sort(compareByDueDateAndSize);
    const orderedSmallerJobs = orderJobsForBatching(smallerJobs, compareByDueDateAndSize);

    // Phase 1: Schedule big rocks first (priority)
    for (const job of bigRocks) {
        const scheduled = scheduleBackwardFromDue(job, buckets);
        scheduledJobs.push(scheduled);
    }

    // Phase 2: Fill remaining capacity with smaller jobs
    for (const job of orderedSmallerJobs) {
        const scheduled = scheduleBackwardFromDue(job, buckets);
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

    const jobDayCounts: Record<string, number> = {};

    const placeDept = (dept: Department, endDate: Date, duration: number) => {
        let deptEnd = new Date(endDate);
        let deptStart = subtractWorkDays(deptEnd, Math.max(duration - 1, 0), allowSaturday);

        while (exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB)) {
            deptEnd = subtractWorkDays(deptEnd, 1, allowSaturday);
            deptStart = subtractWorkDays(deptEnd, Math.max(duration - 1, 0), allowSaturday);
        }

        addDeptToDayCounts(deptStart, deptEnd, jobDayCounts);
        return { start: deptStart, end: deptEnd };
    };

    // Assembly (works backwards from buffer)
    const assembly = placeDept('Assembly', cursorDate, Math.ceil(durations.Assembly || 0));

    // Polishing
    // End date can be same day Assembly starts
    const polishing = placeDept('Polishing', assembly.start, Math.ceil(durations.Polishing || 0));

    // WELDING (THE HEARTBEAT)
    const welding = placeDept('Welding', polishing.start, Math.ceil(durations.Welding || 0));

    // Press Brake
    const pressBrake = placeDept('Press Brake', welding.start, Math.ceil(durations['Press Brake'] || 0));

    // Laser
    const laser = placeDept('Laser', pressBrake.start, Math.ceil(durations.Laser || 0));

    // Engineering
    const engineering = placeDept('Engineering', laser.start, Math.ceil(durations.Engineering || 0));

    // Build schedule object
    const departmentSchedule: Record<string, { start: string; end: string }> = {
        Engineering: { start: engineering.start.toISOString(), end: engineering.end.toISOString() },
        Laser: { start: laser.start.toISOString(), end: laser.end.toISOString() },
        'Press Brake': { start: pressBrake.start.toISOString(), end: pressBrake.end.toISOString() },
        Welding: { start: welding.start.toISOString(), end: welding.end.toISOString() },
        Polishing: { start: polishing.start.toISOString(), end: polishing.end.toISOString() },
        Assembly: { start: assembly.start.toISOString(), end: assembly.end.toISOString() }
    };

    // Check if overdue
    const isOverdue = isBefore(engineering.start, startOfDay(new Date()));

    // If overdue and overtime not yet tried, try with Saturday
    if (isOverdue && overtimeConfig.enabled && !allowSaturday) {
        return scheduleJobFromWelding(job, true);
    }

    return {
        ...job,
        scheduledStartDate: engineering.start,
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
    const jobDayCounts: Record<string, number> = {};

    for (const dept of deptOrder.slice(currentIndex)) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;
        let start = new Date(cursorDate);
        let end = addWorkDays(start, Math.max(duration - 1, 0));
        while (exceedsDailyDeptLimit(start, end, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB)) {
            start = addWorkDays(start, 1);
            end = addWorkDays(start, Math.max(duration - 1, 0));
        }
        deptSchedules[dept] = { start, end };

        // Next department can start the same day this one ends
        cursorDate = new Date(end);
        lastDeptEnd = end;
        addDeptToDayCounts(start, end, jobDayCounts);
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
/**
 * Check if a specific department can fit in a date range
 */
const canFitDepartment = (
    dept: Department,
    startDate: Date,
    endDate: Date,
    duration: number,
    points: number,
    buckets: CapacityBuckets,
    productType: ProductType = 'FAB' // Added for pool logic
): boolean => {
    const dailyLoad = points / Math.max(duration, 1);
    const limit = DEPARTMENT_CONFIG[dept]?.dailyCapacity || 195;

    // Identify Pool and Pool Limit
    const deptConfig = DEPARTMENT_CONFIG[dept];
    const poolIndex = deptConfig?.pools.findIndex(p => !p.productTypes || p.productTypes.includes(productType)) ?? 0;
    const pool = deptConfig?.pools[poolIndex];

    let poolLimit = 195;
    if (pool) {
        poolLimit = pool.count * pool.outputPerDay;
    }

    let dayDate = new Date(startDate);
    for (let i = 0; i < duration; i++) {
        // Skip weekends
        while (isSaturday(dayDate) || isSunday(dayDate)) {
            dayDate = addDays(dayDate, 1);
        }

        const dateKey = dayDate.toISOString().split('T')[0];
        const currentLoad = buckets[dateKey]?.[dept] || 0;
        const currentPoolLoad = buckets[dateKey]?.poolUsage?.[dept]?.[poolIndex] || 0;

        // 1. Total Department Capacity
        if (currentLoad + dailyLoad > limit) {
            return false;
        }

        // 1b. Specific Pool Capacity (Batching Logic)
        if (pool && (currentPoolLoad + dailyLoad > poolLimit)) {
            return false;
        }

        // 2. Big Rock Constraints (Copy of logic from canFitJob)
        if (points >= BIG_ROCK_CONFIG.threshold) {
            const currentBigCount = buckets[dateKey]?.bigRockCount?.[dept] || 0;
            const currentBigPoints = buckets[dateKey]?.bigRockPoints?.[dept] || 0;
            const maxBigConcurrent = BIG_ROCK_CONFIG.maxConcurrent[dept] || 3;

            if (currentBigCount >= maxBigConcurrent) {
                return false;
            }
            if (currentBigCount > 0) {
                const maxBigCapacity = limit * BIG_ROCK_CONFIG.capacityRatio;
                if (currentBigPoints + dailyLoad > maxBigCapacity) {
                    return false;
                }
            }
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
    buckets: CapacityBuckets,
    productType: ProductType = 'FAB',
    jobId: string = '' // For Big Rock job ID tracking
): void => {
    const dailyLoad = points / Math.max(duration, 1);

    // Identify Pool Index
    const deptConfig = DEPARTMENT_CONFIG[dept];
    const poolIndex = deptConfig?.pools.findIndex(p => !p.productTypes || p.productTypes.includes(productType)) ?? 0;

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
                bigRockCount: {
                    Engineering: 0,
                    Laser: 0,
                    'Press Brake': 0,
                    Welding: 0,
                    Polishing: 0,
                    Assembly: 0
                },
                bigRockPoints: {
                    Engineering: 0,
                    Laser: 0,
                    'Press Brake': 0,
                    Welding: 0,
                    Polishing: 0,
                    Assembly: 0
                },
                bigRockJobIds: {
                    Engineering: new Set(),
                    Laser: new Set(),
                    'Press Brake': new Set(),
                    Welding: new Set(),
                    Polishing: new Set(),
                    Assembly: new Set()
                },
                poolUsage: {
                    Engineering: {},
                    Laser: {},
                    'Press Brake': {},
                    Welding: {},
                    Polishing: {},
                    Assembly: {}
                }
            };
        }

        buckets[dateKey][dept] += dailyLoad;

        // Track pool usage
        const currentPool = buckets[dateKey].poolUsage[dept][poolIndex] || 0;
        buckets[dateKey].poolUsage[dept][poolIndex] = currentPool + dailyLoad;

        // Big Rock Reservation - only count once per job per day
        if (points >= BIG_ROCK_CONFIG.threshold && jobId) {
            if (!buckets[dateKey].bigRockJobIds[dept].has(jobId)) {
                buckets[dateKey].bigRockJobIds[dept].add(jobId);
                buckets[dateKey].bigRockCount[dept] = (buckets[dateKey].bigRockCount[dept] || 0) + 1;
            }
            buckets[dateKey].bigRockPoints[dept] = (buckets[dateKey].bigRockPoints[dept] || 0) + dailyLoad;
        }
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
    const productType = job.productType || 'FAB';

    // Determine which departments to schedule (only remaining if job is in progress)
    const currentDeptIndex = job.currentDepartment
        ? DEPARTMENTS.indexOf(job.currentDepartment as Department)
        : 0;
    const remainingDepts = currentDeptIndex >= 0
        ? DEPARTMENTS.slice(currentDeptIndex)
        : DEPARTMENTS;



    const departmentSchedule: Record<string, { start: string; end: string }> = {};
    const scheduledDepartmentByDate: Record<string, Department> = {};
    let hasConflict = false;
    const jobDayCounts: Record<string, number> = {};

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



        while (attempts < maxAttempts) {
            const capacityOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType);
            const limitOk = !exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
            if (capacityOk && limitOk) break;

            // Shift this department block earlier by 1 work day
            deptStart = subtractWorkDays(deptStart, 1);
            deptEnd = subtractWorkDays(deptEnd, 1);
            attempts++;
        }

        // Check if we had to push before today
        if (isBefore(deptStart, today)) {
            hasConflict = true;
        }

        const capacityOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType);
        const limitOk = !exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);

        if (!limitOk) {
            hasConflict = true;
        }

        // Reserve capacity for this department
        if (capacityOk && limitOk) {
            reserveDepartmentCapacity(dept, deptStart, duration, job.weldingPoints || 0, buckets, productType, job.id);
        } else {
            hasConflict = true; // Couldn't find capacity even after shifting
        }

        // Record the schedule
        departmentSchedule[dept] = {
            start: deptStart.toISOString(),
            end: deptEnd.toISOString()
        };
        addDeptToDayCounts(deptStart, deptEnd, jobDayCounts);

        // Track daily assignments
        let dateCursor = new Date(deptStart);
        while (dateCursor <= deptEnd) {
            const dateKey = dateCursor.toISOString().split('T')[0];
            scheduledDepartmentByDate[dateKey] = dept;
            dateCursor = addDays(dateCursor, 1);
        }

        // Next department (going backwards) - gap depends on job size
        // Small (≤7 pts) = 0 gap, Medium (8-49) = 1/2 day, Big Rock (≥50) = 1 day
        const points = job.weldingPoints || 0;
        let gapDays = 0;
        if (!job.noGaps) { // Respect no-gaps override
            if (points >= BIG_ROCK_CONFIG.threshold) {
                gapDays = 1; // Big rock: 1 day gap
            } else if (points > SMALL_JOB_THRESHOLD) {
                gapDays = 0.5; // Medium: 1/2 day gap
            }
        }
        // else: Small job - no gap (same day OK)

        if (gapDays > 0) {
            currentEnd = subtractWorkDays(deptStart, gapDays);
        } else {
            currentEnd = new Date(deptStart);
        }
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
    const jobDayCounts: Record<string, number> = {};

    for (const dept of DEPARTMENTS) {
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;

        let start = new Date(cursorDate);
        let end = addWorkDays(start, Math.max(duration - 1, 0));
        while (exceedsDailyDeptLimit(start, end, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB)) {
            start = addWorkDays(start, 1);
            end = addWorkDays(start, Math.max(duration - 1, 0));
        }

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
        cursorDate = new Date(end);
        addDeptToDayCounts(start, end, jobDayCounts);
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

    // Sort ALL jobs: Score DESC (Primary), then Due Date ASC (Secondary)
    // First, populate scores
    jobs.forEach(job => {
        const scoreResult = calculateUrgencyScore(job);
        job.urgencyScore = scoreResult.score;
        job.urgencyFactors = scoreResult.factors;
    });

    const bigRocks = jobs.filter(j => (j.weldingPoints || 0) >= BIG_ROCK_CONFIG.threshold);
    const smallerJobs = jobs.filter(j => (j.weldingPoints || 0) < BIG_ROCK_CONFIG.threshold);

    bigRocks.sort(compareByUrgencyDueSize);
    const orderedSmallerJobs = orderJobsForBatching(smallerJobs, compareByUrgencyDueSize);

    const scheduled: Job[] = [];

    // =========================================================================
    // OVERDUE HANDLING - START (Delete this block to remove overdue priority)
    // =========================================================================
    const overdueBigRocks = bigRocks.filter(j => isJobOverdue(j));
    const onTimeBigRocks = bigRocks.filter(j => !isJobOverdue(j));
    const overdueSmaller = orderedSmallerJobs.filter(j => isJobOverdue(j));
    const onTimeSmaller = orderedSmallerJobs.filter(j => !isJobOverdue(j));

    // Sort overdue by most days late first
    const sortByMostOverdue = (a: Job, b: Job) => {
        const aOverdue = getDaysOverdue(a);
        const bOverdue = getDaysOverdue(b);
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        return (b.weldingPoints || 0) - (a.weldingPoints || 0);
    };
    overdueBigRocks.sort(sortByMostOverdue);
    overdueSmaller.sort(sortByMostOverdue);

    // Schedule ALL overdue jobs first (forward from today)
    for (const job of overdueBigRocks) {
        const result = scheduleForwardFromToday(job, buckets);
        scheduled.push(result);
    }
    for (const job of overdueSmaller) {
        const result = scheduleForwardFromToday(job, buckets);
        scheduled.push(result);
    }
    // =========================================================================
    // OVERDUE HANDLING - END
    // =========================================================================

    // Schedule on-time big rocks first
    for (const job of onTimeBigRocks) {
        const result = scheduleBackwardFromDue(job, buckets);
        scheduled.push(result);
    }

    // Then fill gaps with on-time smaller jobs (batched by description + due week)
    for (const job of onTimeSmaller) {
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

    // =========================================================================
    // 1. DUE DATE CHANGE DETECTION
    // =========================================================================
    if (previousJob?.dueDate) {
        const prevDue = new Date(previousJob.dueDate);
        const newDue = new Date(job.dueDate);

        // Compare dates (ignore time component)
        const prevDueKey = prevDue.toISOString().split('T')[0];
        const newDueKey = newDue.toISOString().split('T')[0];

        if (prevDueKey !== newDueKey) {
            updatedJob.dueDateChanged = true;
            updatedJob.previousDueDate = prevDue;
            updatedJob.needsReschedule = true; // Flag for user prompt
            console.log(`📅 Due date changed for ${job.id}: ${prevDueKey} → ${newDueKey}`);
        } else {
            // Preserve previous change flag if already set and not resolved
            updatedJob.dueDateChanged = previousJob.dueDateChanged;
            updatedJob.previousDueDate = previousJob.previousDueDate;
            updatedJob.needsReschedule = previousJob.needsReschedule;
        }
    }

    // =========================================================================
    // 2. DEPARTMENT CHANGE DETECTION
    // =========================================================================
    if (previousJob && previousJob.currentDepartment !== job.currentDepartment) {
        updatedJob.lastDepartmentChange = new Date();
    } else if (previousJob?.lastDepartmentChange) {
        updatedJob.lastDepartmentChange = previousJob.lastDepartmentChange;
    }

    // =========================================================================
    // 3. PROGRESS STATUS CALCULATION
    // =========================================================================
    const deptOrder = DEPARTMENTS;
    const currentIndex = deptOrder.indexOf(job.currentDepartment as DepartmentName);

    // Get expected department for today
    let expectedDept: Department | undefined;
    let expectedIndex = -1;

    if (previousJob?.scheduledDepartmentByDate) {
        const today = startOfDay(new Date());
        const todayKey = today.toISOString().split('T')[0];
        expectedDept = previousJob.scheduledDepartmentByDate[todayKey];
        if (expectedDept) {
            expectedIndex = deptOrder.indexOf(expectedDept);
        }
    }

    // Determine progress status
    if (expectedIndex !== -1 && currentIndex !== -1) {
        if (currentIndex > expectedIndex) {
            // Current dept is LATER in the flow than expected = JUMPED AHEAD! 🚀
            updatedJob.progressStatus = 'AHEAD';
        } else if (currentIndex < expectedIndex) {
            // Check for stall (no movement for 2+ days)
            if (updatedJob.lastDepartmentChange) {
                const daysSinceChange = Math.floor(
                    (new Date().getTime() - new Date(updatedJob.lastDepartmentChange).getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysSinceChange >= 2) {
                    updatedJob.progressStatus = 'STALLED';
                } else {
                    updatedJob.progressStatus = 'SLIPPING';
                }
            } else {
                updatedJob.progressStatus = 'SLIPPING';
            }
        } else {
            updatedJob.progressStatus = 'ON_TRACK';
        }
    } else {
        // No expected schedule to compare - default to ON_TRACK
        updatedJob.progressStatus = updatedJob.progressStatus || 'ON_TRACK';
    }

    return updatedJob;
};
