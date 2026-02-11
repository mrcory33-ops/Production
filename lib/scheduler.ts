import { Job, Department, ProductType, ScheduleInsights, LateJob, OverloadedWeek, MoveOption, OTRecommendation, SupervisorAlert } from '@/types';
import { addDays, isSaturday, isSunday, subDays, startOfDay, isBefore, startOfWeek } from 'date-fns';
import { DEPARTMENT_CONFIG, calculateDeptDuration, calculateDoorWeldingSubStages, classifyDoorSubType } from './departmentConfig';
import { calculateUrgencyScore } from './scoring';
import { BIG_ROCK_CONFIG } from './scoringConfig';

// Scheduling Modes
export type SchedulingMode = 'IMPORT' | 'OPTIMIZE';

// Configuration Constants
const BUFFER_DAYS = 1; // Days before due date to finish Assembly
const MAX_DEPTS_PER_DAY_PER_JOB = 2;
const SMALL_JOB_THRESHOLD = 7; // Jobs < 7 points can have same-day dept transitions
const BATCH_WEEK_STARTS_ON = 1; // Monday
export const BATCH_COHORT_WINDOW_BUSINESS_DAYS = 12;
export const QUEUE_BUFFER_DAYS = 2; // Each department should maintain a 2-day work buffer
const WEEKLY_CAPACITY = 850; // Weekly capacity pool per department (pts/week)
const OT_WEEKLY_CAPACITY = 950; // OT ceiling — max capacity with overtime
const BATCH_LOCKSTEP_DEPARTMENTS: Department[] = ['Engineering', 'Laser', 'Press Brake'];

// ── Unified Inter-Department Gap Table ──────────────────────────────────────
// Single source of truth for transition gaps between departments.
// Small jobs can transition same-day; medium jobs get a half-day buffer;
// Big Rocks get a full day for material staging and QC handoff.
const DEPT_GAP_DAYS = {
    small: 0,      // ≤ SMALL_JOB_THRESHOLD pts
    medium: 0.5,   // SMALL_JOB_THRESHOLD < pts < BIG_ROCK threshold
    bigRock: 1     // ≥ BIG_ROCK threshold (50 pts)
} as const;

const getDeptGap = (points: number, noGaps?: boolean): number => {
    if (noGaps) return 0;
    if (points >= BIG_ROCK_CONFIG.threshold) return DEPT_GAP_DAYS.bigRock;
    if (points > SMALL_JOB_THRESHOLD) return DEPT_GAP_DAYS.medium;
    return DEPT_GAP_DAYS.small;
};

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

const WALL_PANEL_PATTERNS = [
    'wall panel',
    'wall panels'
];

const DISH_TABLE_PATTERNS = [
    'dish table',
    'dishtable'
];

const THREE_COMP_SINK_PATTERNS = [
    '3cpt sink',
    '3 cpt sink',
    '3 compartment sink',
    '3-compartment sink',
    '3 compartment sinks',
    '3-compartment sinks'
];

const WALL_SHELF_PATTERNS = [
    'wall shelf',
    'wall shelves',
    'lower wall shelf',
    'upper wall shelf'
];

const CORNER_GUARD_PATTERNS = [
    'corner guard',
    'corner guards',
    'cornerguard',
    'cornerguards'
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

export const normalizeBatchText = (value?: string): string =>
    (value || '')
        .toLowerCase()
        .replace(/[-_/,;.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const matchesAny = (text: string, patterns: string[]): boolean =>
    patterns.some(pattern => text.includes(pattern));

const hasToken = (text: string, token: string): boolean =>
    new RegExp(`\\b${token}\\b`).test(text);

export const getBatchCategory = (
    text: string
): 'FRAME_KD' | 'FRAME_CO' | 'DOOR_LOCK_SEAM' | 'WALL_PANEL' | 'DISH_TABLE' | 'THREE_COMP_SINK' | 'WALL_SHELF' | 'CORNER_GUARD' | null => {
    if (matchesAny(text, FRAME_KD_PATTERNS)) return 'FRAME_KD';
    if (matchesAny(text, FRAME_CO_PATTERNS)) return 'FRAME_CO';
    const hasDoorLockSeamWords =
        (hasToken(text, 'door') || hasToken(text, 'doors')) &&
        (text.includes('lock seam') || text.includes('lockseam'));
    if (matchesAny(text, DOOR_LOCK_SEAM_PATTERNS) || hasDoorLockSeamWords || hasToken(text, 'ls')) {
        return 'DOOR_LOCK_SEAM';
    }
    if (matchesAny(text, WALL_PANEL_PATTERNS)) return 'WALL_PANEL';
    if (matchesAny(text, DISH_TABLE_PATTERNS)) return 'DISH_TABLE';
    if (matchesAny(text, THREE_COMP_SINK_PATTERNS)) return 'THREE_COMP_SINK';
    if (matchesAny(text, WALL_SHELF_PATTERNS)) return 'WALL_SHELF';
    if (matchesAny(text, CORNER_GUARD_PATTERNS)) return 'CORNER_GUARD';
    return null;
};

export const extractGauge = (text: string): string | null => {
    const gaMatch = text.match(/\b(\d{1,2})\s*(ga|gage)\b/);
    if (gaMatch) return gaMatch[1];

    const hashMatch = text.match(/#\s*(\d{2})\b/);
    if (hashMatch) return hashMatch[1];

    return null;
};

export const extractMaterial = (text: string): string | null => {
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

export const getDueWeekStart = (dueDate: Date): Date =>
    startOfWeek(startOfDay(dueDate), { weekStartsOn: BATCH_WEEK_STARTS_ON });

export const getBatchKeyFromText = (text: string): string | null => {
    const category = getBatchCategory(text);
    if (!category) return null;
    const gauge = extractGauge(text) || 'none';
    const material = extractMaterial(text) || 'none';
    return `${category}|${gauge}|${material}`;
};

export const getBatchKeyForJob = (job: Pick<Job, 'description'>): string | null =>
    getBatchKeyFromText(normalizeBatchText(job.description || ''));

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

interface BatchCohort {
    key: string;
    jobs: Job[];
}

const countBusinessDaysBetweenInclusive = (from: Date, to: Date): number => {
    const start = startOfDay(from);
    const end = startOfDay(to);
    if (end < start) return 0;

    let count = 0;
    let cursor = new Date(start);
    while (cursor <= end) {
        if (!isSaturday(cursor) && !isSunday(cursor)) count++;
        cursor = addDays(cursor, 1);
    }
    return count;
};

const businessDayDistance = (from: Date, to: Date): number => {
    const start = startOfDay(from);
    const end = startOfDay(to);
    if (end.getTime() === start.getTime()) return 0;

    const forward = end > start;
    let count = 0;
    let cursor = new Date(start);
    while (forward ? cursor < end : cursor > end) {
        cursor = addDays(cursor, forward ? 1 : -1);
        if (!isSaturday(cursor) && !isSunday(cursor)) {
            count += forward ? 1 : -1;
        }
    }
    return count;
};

const shiftDateByBusinessDays = (date: Date, deltaBusinessDays: number): Date => {
    if (deltaBusinessDays === 0) return startOfDay(date);
    return deltaBusinessDays > 0
        ? addWorkDays(startOfDay(date), deltaBusinessDays)
        : subtractWorkDays(startOfDay(date), Math.abs(deltaBusinessDays));
};

const splitJobsIntoBatchCohorts = (
    jobs: Job[],
    windowBusinessDays: number = BATCH_COHORT_WINDOW_BUSINESS_DAYS
): BatchCohort[] => {
    const keyedGroups = new Map<string, Job[]>();
    const cohorts: BatchCohort[] = [];

    for (const job of jobs) {
        const batchKey = getBatchKeyForJob(job);
        if (!batchKey) continue;
        const dept = job.currentDepartment || 'UNKNOWN';
        const cohortKey = `${batchKey}|DEPT:${dept}`;
        if (!keyedGroups.has(cohortKey)) keyedGroups.set(cohortKey, []);
        keyedGroups.get(cohortKey)!.push(job);
    }

    keyedGroups.forEach((groupJobs, key) => {
        const sorted = [...groupJobs].sort(compareByDueDateAndSize);
        let currentCohort: Job[] = [];
        let cohortAnchorDue: Date | null = null;

        for (const job of sorted) {
            const due = startOfDay(new Date(job.dueDate));
            if (!cohortAnchorDue) {
                cohortAnchorDue = due;
                currentCohort.push(job);
                continue;
            }

            const dueDistance = businessDayDistance(cohortAnchorDue, due);
            if (dueDistance > windowBusinessDays) {
                cohorts.push({ key, jobs: currentCohort });
                currentCohort = [job];
                cohortAnchorDue = due;
                continue;
            }

            currentCohort.push(job);
        }

        if (currentCohort.length > 0) {
            cohorts.push({ key, jobs: currentCohort });
        }
    });

    return cohorts;
};

const buildBatchSizeMap = (jobs: Job[]): Map<string, number> => {
    const batchSizeMap = new Map<string, number>();
    for (const job of jobs) batchSizeMap.set(job.id, 1);

    const cohorts = splitJobsIntoBatchCohorts(jobs);
    for (const cohort of cohorts) {
        const size = cohort.jobs.length;
        for (const job of cohort.jobs) {
            batchSizeMap.set(job.id, size);
        }
    }

    return batchSizeMap;
};

const buildScheduledDepartmentByDate = (
    schedule: Record<string, { start: string; end: string }>
): Record<string, Department> => {
    const byDate: Record<string, Department> = {};
    const orderedDepts = DEPARTMENTS.filter(dept => !!schedule[dept]);

    for (const dept of orderedDepts) {
        const window = schedule[dept];
        if (!window) continue;
        let cursor = startOfDay(new Date(window.start));
        const end = startOfDay(new Date(window.end));
        while (cursor <= end) {
            if (!isSaturday(cursor) && !isSunday(cursor)) {
                byDate[cursor.toISOString().split('T')[0]] = dept;
            }
            cursor = addDays(cursor, 1);
        }
    }

    return byDate;
};

const buildRemainingScheduleFromCurrentDept = (
    schedule: Record<string, { start: string; end: string }>,
    currentDepartment?: Department
): Record<string, { start: string; end: string }> | undefined => {
    if (!currentDepartment) return schedule;
    const currentIndex = DEPARTMENTS.indexOf(currentDepartment);
    if (currentIndex < 0) return schedule;

    const remaining: Record<string, { start: string; end: string }> = {};
    for (const dept of DEPARTMENTS.slice(currentIndex)) {
        if (schedule[dept]) remaining[dept] = schedule[dept];
    }

    return Object.keys(remaining).length > 0 ? remaining : undefined;
};

const enforceSequentialDepartmentOrder = (
    schedule: Record<string, { start: string; end: string }>
): Record<string, { start: string; end: string }> => {
    const normalized = { ...schedule };
    let previousEnd: Date | null = null;

    for (const dept of DEPARTMENTS) {
        const window = normalized[dept];
        if (!window) continue;

        let start = startOfDay(new Date(window.start));
        let end = startOfDay(new Date(window.end));

        if (previousEnd && isBefore(start, previousEnd)) {
            const shiftDays = Math.max(0, businessDayDistance(start, previousEnd));
            if (shiftDays > 0) {
                const downstream = DEPARTMENTS.filter(
                    candidate => DEPARTMENTS.indexOf(candidate) >= DEPARTMENTS.indexOf(dept)
                );
                for (const candidate of downstream) {
                    const candidateWindow = normalized[candidate];
                    if (!candidateWindow) continue;
                    const shiftedStart = shiftDateByBusinessDays(new Date(candidateWindow.start), shiftDays);
                    const shiftedEnd = shiftDateByBusinessDays(new Date(candidateWindow.end), shiftDays);
                    normalized[candidate] = {
                        start: shiftedStart.toISOString(),
                        end: shiftedEnd.toISOString()
                    };
                }
                start = startOfDay(new Date(normalized[dept].start));
                end = startOfDay(new Date(normalized[dept].end));
            }
        }

        previousEnd = end;
    }

    return normalized;
};

const applyBatchLockstepAlignment = (jobs: Job[]): Job[] => {
    if (jobs.length === 0) return jobs;

    const result = jobs.map(job => ({ ...job }));
    const byId = new Map<string, Job>(result.map(job => [job.id, job]));
    const PRESS_BRAKE_INDEX = DEPARTMENTS.indexOf('Press Brake');
    const cohorts = splitJobsIntoBatchCohorts(result).filter(cohort => cohort.jobs.length >= 2);

    for (const cohort of cohorts) {
        const baseEligible = cohort.jobs.filter(job => {
            if (job.isOverdue) return false;
            const currentIndex = DEPARTMENTS.indexOf(job.currentDepartment as Department);
            if (currentIndex > PRESS_BRAKE_INDEX) return false;
            return !!job.departmentSchedule;
        });

        if (baseEligible.length < 2) continue;

        const subgroups = new Map<string, { alignDepts: Department[]; jobs: Job[] }>();
        for (const job of baseEligible) {
            const currentIndex = DEPARTMENTS.indexOf(job.currentDepartment as Department);
            const startIndex = currentIndex >= 0 ? currentIndex : 0;
            const alignDepts = BATCH_LOCKSTEP_DEPARTMENTS.filter(dept => {
                const deptIndex = DEPARTMENTS.indexOf(dept);
                return deptIndex >= startIndex &&
                    deptIndex <= PRESS_BRAKE_INDEX &&
                    !!job.departmentSchedule?.[dept];
            });
            if (alignDepts.length === 0) continue;

            const signature = alignDepts.join('|');
            if (!subgroups.has(signature)) {
                subgroups.set(signature, { alignDepts, jobs: [] });
            }
            subgroups.get(signature)!.jobs.push(job);
        }

        for (const subgroup of subgroups.values()) {
            if (subgroup.jobs.length < 2) continue;

            const alignDepts = subgroup.alignDepts;
            const sortedEligible = [...subgroup.jobs].sort(compareByDueDateAndSize);
            const anchorJob = sortedEligible[0];
            if (!anchorJob.departmentSchedule) continue;

            const lastAlignedDept = alignDepts[alignDepts.length - 1];
            const lastAlignedDeptIndex = DEPARTMENTS.indexOf(lastAlignedDept);
            const anchorLastWindow = anchorJob.departmentSchedule[lastAlignedDept];
            if (!anchorLastWindow) continue;

            const maxDurations = new Map<Department, number>();
            for (const dept of alignDepts) {
                const deptMax = Math.max(
                    ...sortedEligible.map(job => {
                        const window = job.departmentSchedule?.[dept];
                        if (!window) return 1;
                        return Math.max(
                            1,
                            countBusinessDaysBetweenInclusive(new Date(window.start), new Date(window.end))
                        );
                    })
                );
                maxDurations.set(dept, deptMax);
            }

            const sharedWindows = new Map<Department, { start: Date; end: Date }>();
            let cursorEnd = startOfDay(new Date(anchorLastWindow.end));
            for (let i = alignDepts.length - 1; i >= 0; i--) {
                const dept = alignDepts[i];
                const duration = Math.max(1, maxDurations.get(dept) || 1);
                const start = subtractWorkDays(cursorEnd, Math.max(duration - 1, 0));
                sharedWindows.set(dept, { start, end: cursorEnd });
                cursorEnd = startOfDay(start);
            }

            for (const sourceJob of sortedEligible) {
                const target = byId.get(sourceJob.id);
                if (!target?.departmentSchedule) continue;

                const updatedSchedule = { ...target.departmentSchedule };
                const oldLastWindow = updatedSchedule[lastAlignedDept];
                if (!oldLastWindow) continue;
                const oldLastEnd = startOfDay(new Date(oldLastWindow.end));

                for (const dept of alignDepts) {
                    const shared = sharedWindows.get(dept);
                    if (!shared) continue;
                    updatedSchedule[dept] = {
                        start: shared.start.toISOString(),
                        end: shared.end.toISOString()
                    };
                }

                const sharedLast = sharedWindows.get(lastAlignedDept);
                if (!sharedLast) continue;
                const deltaBusinessDays = businessDayDistance(oldLastEnd, sharedLast.end);
                if (deltaBusinessDays !== 0) {
                    const downstreamDepts = DEPARTMENTS.filter(
                        dept => DEPARTMENTS.indexOf(dept) > lastAlignedDeptIndex
                    );
                    for (const downstream of downstreamDepts) {
                        const window = updatedSchedule[downstream];
                        if (!window) continue;
                        const shiftedStart = shiftDateByBusinessDays(new Date(window.start), deltaBusinessDays);
                        const shiftedEnd = shiftDateByBusinessDays(new Date(window.end), deltaBusinessDays);
                        updatedSchedule[downstream] = {
                            start: shiftedStart.toISOString(),
                            end: shiftedEnd.toISOString()
                        };
                    }
                }

                const normalizedSchedule = enforceSequentialDepartmentOrder(updatedSchedule);
                const allStarts = Object.values(normalizedSchedule).map(s => new Date(s.start));
                const allEnds = Object.values(normalizedSchedule).map(s => new Date(s.end));
                const earliestStart = allStarts.length > 0
                    ? new Date(Math.min(...allStarts.map(d => d.getTime())))
                    : target.scheduledStartDate || new Date();
                const latestEnd = allEnds.length > 0
                    ? new Date(Math.max(...allEnds.map(d => d.getTime())))
                    : earliestStart;
                const dueDate = normalizeWorkEnd(new Date(target.dueDate));
                const hasConflict = isBefore(dueDate, latestEnd);

                byId.set(target.id, {
                    ...target,
                    departmentSchedule: normalizedSchedule,
                    remainingDepartmentSchedule: buildRemainingScheduleFromCurrentDept(
                        normalizedSchedule,
                        target.currentDepartment as Department
                    ),
                    scheduledDepartmentByDate: buildScheduledDepartmentByDate(normalizedSchedule),
                    scheduledStartDate: earliestStart,
                    schedulingConflict: hasConflict,
                    progressStatus: hasConflict ? 'SLIPPING' : (target.progressStatus || 'ON_TRACK')
                });
            }
        }
    }

    return result.map(job => byId.get(job.id) || job);
};

export const alignBatchCohorts = (jobs: Job[]): Job[] => applyBatchLockstepAlignment(jobs);

const orderJobsForBatching = (jobs: Job[], compareBase: (a: Job, b: Job) => number): Job[] => {
    type Group = {
        jobs: Job[];
        minDue: number;
        maxScore: number;
        maxPoints: number;
        isBatch: boolean;
        cohortSize: number;
    };

    const batchKeys = new Set<string>();
    const groups: Group[] = [];
    const cohorts = splitJobsIntoBatchCohorts(jobs);

    for (const cohort of cohorts) {
        cohort.jobs.sort(compareBase);
        batchKeys.add(cohort.key);
        groups.push({
            jobs: cohort.jobs,
            minDue: Math.min(...cohort.jobs.map(j => new Date(j.dueDate).getTime())),
            maxScore: Math.max(...cohort.jobs.map(j => j.urgencyScore || 0)),
            maxPoints: Math.max(...cohort.jobs.map(j => j.weldingPoints || 0)),
            isBatch: cohort.jobs.length >= 2,
            cohortSize: cohort.jobs.length
        });
    }

    for (const job of jobs) {
        const key = getBatchKeyForJob(job);
        if (key && batchKeys.has(key)) continue;
        groups.push({
            jobs: [job],
            minDue: new Date(job.dueDate).getTime(),
            maxScore: job.urgencyScore || 0,
            maxPoints: job.weldingPoints || 0,
            isBatch: false,
            cohortSize: 1
        });
    }

    return groups
        .sort((a, b) => {
            if (a.minDue !== b.minDue) return a.minDue - b.minDue;
            if (a.isBatch !== b.isBatch) return a.isBatch ? -1 : 1;
            if (a.cohortSize !== b.cohortSize) return b.cohortSize - a.cohortSize;
            const scoreDiff = b.maxScore - a.maxScore;
            if (Math.abs(scoreDiff) > 1) return scoreDiff;
            return b.maxPoints - a.maxPoints;
        })
        .flatMap(group => group.jobs);
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

        // Next department starts after this one ends (unified gap table)
        const gapDays = getDeptGap(points, job.noGaps);

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
        schedulingConflict: isBefore(
            normalizeWorkEnd(new Date(job.dueDate)),
            scheduledEndDate
        ), // Only flag conflict if forward schedule misses due date
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

const canFitInWeek = (
    date: Date,
    dept: Department,
    points: number,
    buckets: CapacityBuckets,
    allowOT: boolean = false
): boolean => {
    const weekKey = getWeekKey(date);
    const currentUsage = buckets.weeklyUsage?.[weekKey]?.[dept] || 0;
    const capacity = allowOT ? OT_WEEKLY_CAPACITY : WEEKLY_CAPACITY;
    return (currentUsage + points) <= capacity;
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
 * Prorate weekly capacity across multiple weeks for multi-day jobs.
 * Instead of reserving all points in the start week, distribute
 * points evenly across each work day the job spans.
 * Example: 200 pts / 8 days = 25 pts/day → 125 in week 1, 75 in week 2.
 */
const prorateWeeklyCapacity = (
    startDate: Date,
    durationDays: number,
    dept: Department,
    totalPoints: number,
    buckets: CapacityBuckets
): void => {
    const effectiveDays = Math.max(durationDays, 1);
    const pointsPerDay = totalPoints / effectiveDays;
    let cursor = new Date(startDate);
    let remaining = effectiveDays;

    while (remaining > 0) {
        // Skip weekends
        while (isSaturday(cursor) || isSunday(cursor)) {
            cursor = addDays(cursor, 1);
        }
        reserveWeeklyCapacity(cursor, dept, pointsPerDay, buckets);
        cursor = addDays(cursor, 1);
        remaining--;
    }
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

        // Prorate weekly capacity across all weeks this dept spans
        prorateWeeklyCapacity(deptStartDate, duration, dept, job.weldingPoints || 0, buckets);

        // Next department starts after this one ends (unified gap table)
        const jobPoints = job.weldingPoints || 0;
        const gapDays = getDeptGap(jobPoints);

        if (gapDays > 0) {
            deptStartDate = addDays(dayDate, gapDays);
            // Skip weekend
            while (isSaturday(deptStartDate) || isSunday(deptStartDate)) {
                deptStartDate = addDays(deptStartDate, 1);
            }
        } else {
            deptStartDate = new Date(dayDate);
        }
    };
};

/**
 * Calculates the number of work days needed for a job in a specific department.
 * Uses department-specific capacity from departmentConfig.
 */
export const calculateDuration = (
    points: number,
    dept: DepartmentName,
    productType: ProductType = 'FAB',
    description?: string,
    jobName?: string,
    requiresPainting?: boolean,
    customerName?: string,
    batchSize?: number,
    quantity?: number
): number => {
    return calculateDeptDuration(dept, points, productType, description, jobName, requiresPainting, customerName, batchSize, quantity);
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
 * @param job - The job to calculate durations for
 * @param batchSize - Optional batch size for efficiency discount
 */
const calculateAllDurations = (job: Job, batchSize?: number): Record<Department, number> => {
    const points = job.weldingPoints || 0;
    const productType = job.productType || 'FAB';
    const hasRef = (job.description || '').toUpperCase().includes('REF');
    const custName = job.customerName;
    const qty = job.quantity;

    // For DOORS productType, also compute welding sub-stages if applicable
    if (productType === 'DOORS' && qty && qty > 0) {
        const pointsPerDoor = points / qty;
        const subResult = calculateDoorWeldingSubStages(qty, pointsPerDoor, job.description || '', job.name || '');
        if (subResult) {
            job.weldingSubStages = subResult.stages;
            job.doorSubType = subResult.subType;
        } else {
            job.weldingSubStages = undefined;
            job.doorSubType = classifyDoorSubType(job.description || '', job.name || '');
        }
    }

    return {
        Engineering: calculateDuration(points, 'Engineering', productType, job.description, job.name, job.requiresPainting, custName, batchSize),
        Laser: calculateDuration(points, 'Laser', productType, job.description, job.name, job.requiresPainting, custName, batchSize),
        'Press Brake': calculateDuration(points, 'Press Brake', productType, job.description, job.name, job.requiresPainting, custName, batchSize),
        Welding: calculateDuration(points, 'Welding', productType, job.description, job.name, job.requiresPainting, custName, batchSize, qty),
        Polishing: calculateDuration(points, 'Polishing', productType, job.description, job.name, job.requiresPainting, custName, batchSize),
        Assembly: Math.max(
            calculateDuration(points, 'Assembly', productType, job.description, job.name, job.requiresPainting, custName, batchSize),
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
    return schedulePipeline(jobs).jobs;
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
        const scheduled = scheduleBackwardFromDue(job, buckets, scheduledJobs);
        scheduledJobs.push(scheduled);
    }

    // Phase 2: Fill remaining capacity with smaller jobs
    for (const job of orderedSmallerJobs) {
        const scheduled = scheduleBackwardFromDue(job, buckets, scheduledJobs);
        scheduledJobs.push(scheduled);
    }

    return applyBatchLockstepAlignment(scheduledJobs);
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
    productType: ProductType = 'FAB',
    allowOT: boolean = false
): boolean => {
    const dailyLoad = points / Math.max(duration, 1);
    const limit = DEPARTMENT_CONFIG[dept]?.dailyCapacity || 195;

    // Weekly capacity check — ensure job fits in the week
    if (!canFitInWeek(startDate, dept, points, buckets, allowOT)) {
        return false;
    }

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
 * 
 * Three-tier capacity resolution:
 * Tier 1: Shift backward (up to 60 attempts)
 * Tier 2: Today-floor — never schedule remaining depts before today
 * Tier 3: Forward-scan — find first available slot from today
 */
const scheduleBackwardFromDue = (
    job: Job,
    buckets: CapacityBuckets,
    scheduledJobs?: Job[],
    batchSize?: number,
    options?: { allowOT?: boolean; dryRun?: boolean }
): Job => {
    const allowOT = options?.allowOT ?? false;
    const dryRun = options?.dryRun ?? false;
    const dueDate = normalizeWorkEnd(new Date(job.dueDate));
    const today = normalizeWorkStart(new Date());
    const durations = calculateAllDurations(job, batchSize);
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
    let hitTodayFloor = false;

    // Schedule each department backwards
    for (let i = remainingDepts.length - 1; i >= 0; i--) {
        const dept = remainingDepts[i];
        const duration = Math.ceil(durations[dept] || 0);

        if (duration <= 0) continue;

        // Calculate ideal start for this department (inclusive end date)
        let deptStart = subtractWorkDays(currentEnd, Math.max(duration - 1, 0));
        let deptEnd = new Date(currentEnd);

        // =====================================================================
        // BIDIRECTIONAL CAPACITY SEARCH
        // Try ideal position first, then alternate forward/backward to find
        // the closest available slot. This minimizes inter-department gaps.
        // Forward bounded by previous dept's end, backward bounded by today.
        // =====================================================================
        const maxSearchRadius = 30; // Max work days to search in each direction
        let foundSlot = false;

        // Compute the forward bound: this dept cannot end AFTER the next dept's start
        // (the next dept = the one already scheduled, i+1 in remainingDepts since we go in reverse)
        // For the last dept (Assembly, i = remainingDepts.length - 1), the bound is the due date
        const nextDeptIndex = i + 1;
        const forwardBound = nextDeptIndex < remainingDepts.length
            ? (() => {
                const nextDept = remainingDepts[nextDeptIndex];
                const nextSchedule = departmentSchedule[nextDept];
                if (nextSchedule) {
                    // This dept's end must be before the next dept's start
                    return subtractWorkDays(new Date(nextSchedule.start), 1);
                }
                return new Date(dueDate);
            })()
            : new Date(dueDate);

        // Try ideal position first
        {
            const capacityOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType, allowOT);
            const limitOk = !exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
            if (capacityOk && limitOk) {
                foundSlot = true;
            }
        }

        // Alternate forward/backward from ideal
        if (!foundSlot) {
            const idealStart = new Date(deptStart);
            const idealEnd = new Date(deptEnd);

            for (let offset = 1; offset <= maxSearchRadius && !foundSlot; offset++) {
                // Try FORWARD first (toward due date — keeps departments tight)
                const fwdStart = addWorkDays(idealStart, offset);
                const fwdEnd = addWorkDays(fwdStart, Math.max(duration - 1, 0));

                // Forward bound: don't overlap into the next department
                if (!isBefore(forwardBound, fwdEnd)) {
                    const fwdCapOk = canFitDepartment(dept, fwdStart, fwdEnd, duration, job.weldingPoints || 0, buckets, productType, allowOT);
                    const fwdLimOk = !exceedsDailyDeptLimit(fwdStart, fwdEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
                    if (fwdCapOk && fwdLimOk) {
                        deptStart = fwdStart;
                        deptEnd = fwdEnd;
                        foundSlot = true;
                        break;
                    }
                }

                // Try BACKWARD (away from due date)
                const bwdStart = subtractWorkDays(idealStart, offset);
                const bwdEnd = subtractWorkDays(idealEnd, offset);

                // Backward bound: don't go before today
                if (!isBefore(bwdStart, today)) {
                    const bwdCapOk = canFitDepartment(dept, bwdStart, bwdEnd, duration, job.weldingPoints || 0, buckets, productType, allowOT);
                    const bwdLimOk = !exceedsDailyDeptLimit(bwdStart, bwdEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
                    if (bwdCapOk && bwdLimOk) {
                        deptStart = bwdStart;
                        deptEnd = bwdEnd;
                        foundSlot = true;
                        break;
                    }
                } else {
                    // We've hit the today floor going backward — if forward also exhausted, stop
                    hitTodayFloor = true;
                }
            }
        }

        // FALLBACK: If bidirectional search failed, do a forward scan from today
        if (!foundSlot) {
            hasConflict = true;
            deptStart = new Date(today);
            deptEnd = addWorkDays(deptStart, Math.max(duration - 1, 0));

            for (let fwd = 0; fwd < 60; fwd++) {
                const capOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType);
                const limOk = !exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
                if (capOk && limOk) {
                    foundSlot = true;
                    break;
                }
                deptStart = addWorkDays(deptStart, 1);
                deptEnd = addWorkDays(deptStart, Math.max(duration - 1, 0));
            }
        }

        // Reserve capacity for this department (skip in dry-run mode)
        if (foundSlot) {
            if (!dryRun) {
                reserveDepartmentCapacity(dept, deptStart, duration, job.weldingPoints || 0, buckets, productType, job.id);
            }
        } else {
            hasConflict = true;
            // Still reserve at best-effort position to prevent infinite stacking
            if (!dryRun) {
                reserveDepartmentCapacity(dept, deptStart, duration, job.weldingPoints || 0, buckets, productType, job.id);
            }
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
        const points = job.weldingPoints || 0;
        const gapDays = getDeptGap(points, job.noGaps);

        if (hitTodayFloor) {
            // If we hit the today floor, all subsequent depts (going backward = earlier in flow)
            // must also be scheduled forward from where this one ends
            currentEnd = new Date(deptStart); // For backward iteration, this becomes the "before" boundary
        } else if (gapDays > 0) {
            currentEnd = subtractWorkDays(deptStart, gapDays);
        } else {
            currentEnd = new Date(deptStart);
        }
    }

    // =========================================================================
    // POST-PROCESSING: If we hit the today floor, the backward-scheduled depts
    // may be out of order. Re-sort them forward from today to ensure sequential flow.
    // =========================================================================
    if (hitTodayFloor) {
        // Re-schedule all departments forward from today to ensure correct ordering
        let forwardCursor = new Date(today);
        const reorderedSchedule: Record<string, { start: string; end: string }> = {};
        const reorderedByDate: Record<string, Department> = {};
        const fwdJobDayCounts: Record<string, number> = {};

        for (const dept of remainingDepts) {
            const duration = Math.ceil(durations[dept] || 0);
            if (duration <= 0) continue;

            // Skip weekends
            while (isSaturday(forwardCursor) || isSunday(forwardCursor)) {
                forwardCursor = addDays(forwardCursor, 1);
            }

            let deptStart = new Date(forwardCursor);
            let deptEnd = addWorkDays(deptStart, Math.max(duration - 1, 0));

            // Find capacity slot going forward
            let fwdAttempts = 0;
            while (fwdAttempts < 60) {
                const capOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType);
                const limOk = !exceedsDailyDeptLimit(deptStart, deptEnd, fwdJobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
                if (capOk && limOk) break;
                deptStart = addWorkDays(deptStart, 1);
                deptEnd = addWorkDays(deptStart, Math.max(duration - 1, 0));
                fwdAttempts++;
            }

            // Reserve
            const capOk = canFitDepartment(dept, deptStart, deptEnd, duration, job.weldingPoints || 0, buckets, productType);
            const limOk = !exceedsDailyDeptLimit(deptStart, deptEnd, fwdJobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB);
            if (capOk && limOk) {
                if (!dryRun) {
                    reserveDepartmentCapacity(dept, deptStart, duration, job.weldingPoints || 0, buckets, productType, job.id);
                }
            }

            reorderedSchedule[dept] = {
                start: deptStart.toISOString(),
                end: deptEnd.toISOString()
            };
            addDeptToDayCounts(deptStart, deptEnd, fwdJobDayCounts);

            let dc = new Date(deptStart);
            while (dc <= deptEnd) {
                const dk = dc.toISOString().split('T')[0];
                reorderedByDate[dk] = dept;
                dc = addDays(dc, 1);
            }

            // Next dept starts after gap
            const pts = job.weldingPoints || 0;
            const gap = getDeptGap(pts, job.noGaps);
            forwardCursor = addWorkDays(deptEnd, gap + 1);
        }

        // Use the forward-scheduled result
        const firstDept = remainingDepts[0];
        const scheduledStartDate = reorderedSchedule[firstDept]
            ? new Date(reorderedSchedule[firstDept].start)
            : today;

        return {
            ...job,
            scheduledStartDate,
            isOverdue: false, // Not overdue — just capacity-constrained
            departmentSchedule: reorderedSchedule,
            scheduledDepartmentByDate: reorderedByDate,
            schedulingConflict: true,
            progressStatus: 'ON_TRACK'
        };
    }

    // Normal backward-scheduled result (no floor hit)
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

// ============================================================================
// 4-PHASE WEEKLY SCHEDULING PIPELINE (v2.0)
// See docs/SCHEDULING_ENGINE.md for full design documentation
// ============================================================================

const WEEKLY_TARGET = 850;
const FROZEN_WEEKS = 2;

// ---- Phase 1 Helper: Place a single job backward from due date (NO capacity) ----

const placeIdeal = (job: Job, batchSize?: number): Job => {
    const dueDate = normalizeWorkEnd(new Date(job.dueDate));
    const today = normalizeWorkStart(new Date());
    const durations = calculateAllDurations(job, batchSize);

    const currentDeptIndex = job.currentDepartment
        ? DEPARTMENTS.indexOf(job.currentDepartment as Department)
        : 0;
    const remainingDepts = currentDeptIndex >= 0
        ? DEPARTMENTS.slice(currentDeptIndex)
        : DEPARTMENTS;

    const departmentSchedule: Record<string, { start: string; end: string }> = {};
    const jobDayCounts: Record<string, number> = {};

    // Start from Assembly end (due date minus buffer)
    let currentEnd = subtractWorkDays(dueDate, BUFFER_DAYS);

    // Schedule each department backwards — NO capacity checking
    for (let i = remainingDepts.length - 1; i >= 0; i--) {
        const dept = remainingDepts[i];
        const duration = Math.ceil(durations[dept] || 0);
        if (duration <= 0) continue;

        let deptStart = subtractWorkDays(currentEnd, Math.max(duration - 1, 0));
        let deptEnd = new Date(currentEnd);

        // Respect daily dept limit for the job itself (max 2 depts per day)
        while (exceedsDailyDeptLimit(deptStart, deptEnd, jobDayCounts, MAX_DEPTS_PER_DAY_PER_JOB)) {
            deptStart = subtractWorkDays(deptStart, 1);
            deptEnd = subtractWorkDays(deptEnd, 1);
        }

        departmentSchedule[dept] = {
            start: deptStart.toISOString(),
            end: deptEnd.toISOString()
        };
        addDeptToDayCounts(deptStart, deptEnd, jobDayCounts);

        // Next department gap
        const points = job.weldingPoints || 0;
        const gapDays = getDeptGap(points, job.noGaps);

        currentEnd = gapDays > 0
            ? subtractWorkDays(deptStart, gapDays)
            : new Date(deptStart);
    }

    // ═══════════════════════════════════════════════════════════
    // TODAY FLOOR: If any department starts before today, shift
    // the entire job forward so earliest dept starts today.
    // This means the job may finish AFTER its due date — that's OK,
    // Phase 4 will flag it as a conflict.
    // ═══════════════════════════════════════════════════════════
    const allStarts = Object.values(departmentSchedule).map(s => new Date(s.start));
    const earliestStart = allStarts.length > 0
        ? new Date(Math.min(...allStarts.map(d => d.getTime())))
        : today;

    if (isBefore(earliestStart, today)) {
        // Calculate how many work days to shift forward
        let shiftDays = 0;
        let cursor = new Date(earliestStart);
        while (isBefore(cursor, today)) {
            if (!isSaturday(cursor) && !isSunday(cursor)) shiftDays++;
            cursor = addDays(cursor, 1);
        }

        if (shiftDays > 0) {
            // Shift ALL departments forward by shiftDays
            for (const [dept, sched] of Object.entries(departmentSchedule)) {
                const newStart = addWorkDays(new Date(sched.start), shiftDays);
                const newEnd = addWorkDays(new Date(sched.end), shiftDays);
                departmentSchedule[dept] = {
                    start: newStart.toISOString(),
                    end: newEnd.toISOString()
                };
            }
        }
    }

    const firstDept = remainingDepts[0];
    const scheduledStartDate = departmentSchedule[firstDept]
        ? new Date(departmentSchedule[firstDept].start)
        : today;

    // Check if we'll miss the due date after clamping
    const allEnds = Object.values(departmentSchedule).map(s => new Date(s.end));
    const latestEnd = allEnds.length > 0
        ? new Date(Math.max(...allEnds.map(d => d.getTime())))
        : today;
    const willMissDueDate = isBefore(dueDate, latestEnd);

    return {
        ...job,
        scheduledStartDate,
        isOverdue: false,
        departmentSchedule,
        schedulingConflict: willMissDueDate,
        progressStatus: willMissDueDate ? 'SLIPPING' : 'ON_TRACK'
    };
};

// ---- Phase 2: Weekly Capacity Audit ----

interface WeekDeptLoad {
    total: number;
    bigRockPts: number;
    smallRockPts: number;
    contributions: { jobId: string; pts: number }[];
}

type WeeklyCapacityMap = Record<string, Record<string, WeekDeptLoad>>;

const computeWeeklyLoad = (jobs: Job[]): WeeklyCapacityMap => {
    const capacity: WeeklyCapacityMap = {};

    for (const job of jobs) {
        if (!job.departmentSchedule) continue;
        const points = job.weldingPoints || 0;
        const isBigRock = points >= BIG_ROCK_CONFIG.threshold;

        for (const [dept, schedule] of Object.entries(job.departmentSchedule)) {
            const start = new Date(schedule.start);
            const end = new Date(schedule.end);

            // Count total work days for this department span
            let totalWorkDays = 0;
            let cursor = new Date(start);
            while (cursor <= end) {
                if (!isSaturday(cursor) && !isSunday(cursor)) totalWorkDays++;
                cursor = addDays(cursor, 1);
            }
            totalWorkDays = Math.max(totalWorkDays, 1);
            const dailyLoad = points / totalWorkDays;

            // Distribute points across weeks proportionally
            const weekContribs: Record<string, number> = {};
            cursor = new Date(start);
            while (cursor <= end) {
                if (!isSaturday(cursor) && !isSunday(cursor)) {
                    const wk = getWeekKey(cursor);
                    weekContribs[wk] = (weekContribs[wk] || 0) + dailyLoad;
                }
                cursor = addDays(cursor, 1);
            }

            for (const [wk, pts] of Object.entries(weekContribs)) {
                if (!capacity[wk]) capacity[wk] = {};
                if (!capacity[wk][dept]) {
                    capacity[wk][dept] = { total: 0, bigRockPts: 0, smallRockPts: 0, contributions: [] };
                }
                capacity[wk][dept].total += pts;
                if (isBigRock) capacity[wk][dept].bigRockPts += pts;
                else capacity[wk][dept].smallRockPts += pts;
                capacity[wk][dept].contributions.push({ jobId: job.id, pts });
            }
        }
    }

    return capacity;
};

// ---- Phase 3 Helpers ----

/** Calculate FORWARD slack: work days between last dept end and due date.
 *  This tells us how far the job can be pushed LATER without missing its deadline. */
const getJobForwardSlack = (job: Job): number => {
    if (!job.departmentSchedule || job.isOverdue) return 0;

    const dueDate = new Date(job.dueDate);
    const allEnds = Object.values(job.departmentSchedule).map(s => new Date(s.end));
    if (allEnds.length === 0) return 0;
    const latestEnd = new Date(Math.max(...allEnds.map(d => d.getTime())));

    // Count work days between latest end and due date
    let slack = 0;
    let cursor = addDays(latestEnd, 1);
    while (isBefore(cursor, dueDate)) {
        if (!isSaturday(cursor) && !isSunday(cursor)) slack++;
        cursor = addDays(cursor, 1);
    }
    return slack;
};

// ---- Phase 3: Shift Helper ----

/** Shift all departments of a job by N work days (positive = earlier, negative = later) */
const shiftJobSchedule = (job: Job, shiftWorkDays: number): Job => {
    if (!job.departmentSchedule || shiftWorkDays === 0) return job;

    const newSchedule: Record<string, { start: string; end: string }> = {};

    for (const [dept, schedule] of Object.entries(job.departmentSchedule)) {
        const start = new Date(schedule.start);
        const end = new Date(schedule.end);

        const newStart = shiftWorkDays > 0
            ? subtractWorkDays(start, shiftWorkDays)
            : addWorkDays(start, Math.abs(shiftWorkDays));
        const newEnd = shiftWorkDays > 0
            ? subtractWorkDays(end, shiftWorkDays)
            : addWorkDays(end, Math.abs(shiftWorkDays));

        newSchedule[dept] = { start: newStart.toISOString(), end: newEnd.toISOString() };
    }

    const allStarts = Object.values(newSchedule).map(s => new Date(s.start));
    const scheduledStartDate = allStarts.length > 0
        ? new Date(Math.min(...allStarts.map(d => d.getTime())))
        : job.scheduledStartDate;

    return { ...job, departmentSchedule: newSchedule, scheduledStartDate };
};

// ---- Phase 3: Compression ----
// Strategy: Push flexible jobs LATER (toward their due date) to free up
// overloaded near-term weeks. Small jobs are moved first since they're
// easier to shift without disrupting the schedule.

const compressSchedule = (jobs: Job[]): Job[] => {
    const today = normalizeWorkStart(new Date());
    const jobMap = new Map<string, Job>();
    for (const job of jobs) jobMap.set(job.id, { ...job });

    // Iterative compression: up to 10 passes
    for (let pass = 0; pass < 10; pass++) {
        const currentJobs = Array.from(jobMap.values());
        const weeklyLoad = computeWeeklyLoad(currentJobs);

        // Find overloaded week-dept pairs
        const overloaded: { weekKey: string; dept: string; excess: number }[] = [];
        for (const [wk, depts] of Object.entries(weeklyLoad)) {
            for (const [dept, load] of Object.entries(depts)) {
                if (load.total > WEEKLY_TARGET) {
                    overloaded.push({ weekKey: wk, dept, excess: load.total - WEEKLY_TARGET });
                }
            }
        }

        if (overloaded.length === 0) {
            console.log(`[SCHEDULER] Phase 3: Balanced after ${pass + 1} pass(es)`);
            break;
        }

        overloaded.sort((a, b) => b.excess - a.excess);
        let movedAny = false;

        for (const { weekKey, dept } of overloaded) {
            const load = weeklyLoad[weekKey]?.[dept];
            if (!load || load.total <= WEEKLY_TARGET) continue;

            // Find moveable jobs: most FORWARD SLACK first, smallest jobs first
            const contributors = load.contributions
                .map(c => {
                    const j = jobMap.get(c.jobId)!;
                    return { job: j, pts: c.pts, fwdSlack: j ? getJobForwardSlack(j) : 0, points: j?.weldingPoints || 0 };
                })
                .filter(c => c.job && c.fwdSlack >= 3 && !c.job.isOverdue)
                .sort((a, b) => {
                    if (b.fwdSlack !== a.fwdSlack) return b.fwdSlack - a.fwdSlack;
                    return a.points - b.points;
                });

            for (const { job: candidate, pts } of contributors) {
                if (!candidate) continue;
                const currentLoad = weeklyLoad[weekKey]?.[dept]?.total || 0;
                if (currentLoad <= WEEKLY_TARGET) break;

                // Try shifting 5, 3, or 1 work days LATER (toward due date)
                let shifted: Job | null = null;
                for (const tryDays of [5, 3, 1]) {
                    const attempt = shiftJobSchedule(candidate, -tryDays);
                    const newEnds = Object.values(attempt.departmentSchedule || {}).map(s => new Date(s.end));
                    const latestNew = newEnds.length > 0 ? new Date(Math.max(...newEnds.map(d => d.getTime()))) : today;
                    if (!isBefore(new Date(candidate.dueDate), latestNew)) {
                        shifted = attempt;
                        break;
                    }
                }

                if (shifted) {
                    // Verify shifted job doesn't miss due date
                    const shiftedEnds = Object.values(shifted.departmentSchedule || {}).map(s => new Date(s.end));
                    const latestEnd = shiftedEnds.length > 0 ? new Date(Math.max(...shiftedEnds.map(d => d.getTime()))) : today;
                    if (isBefore(new Date(shifted.dueDate), latestEnd)) {
                        // Shift would cause due-date miss — reject it
                        // Don't update jobMap or weeklyLoad, skip to next candidate
                    } else {
                        jobMap.set(candidate.id, shifted);
                        movedAny = true;
                        // Note: weeklyLoad is fully recomputed at top of each pass,
                        // so no in-place subtraction needed here
                    }
                }
            }
        }

        if (!movedAny) {
            console.log(`[SCHEDULER] Phase 3: No more moves possible after ${pass + 1} pass(es)`);
            break;
        }
    }

    return Array.from(jobMap.values());
};

// ---- Phase 4: Validation ----

const validateSchedule = (jobs: Job[]): Job[] => {
    return jobs.map(job => {
        if (!job.departmentSchedule || job.isOverdue) return job;

        // Check last department ends before due date
        const allEnds = Object.values(job.departmentSchedule).map(s => new Date(s.end));
        const latestEnd = allEnds.length > 0
            ? new Date(Math.max(...allEnds.map(d => d.getTime())))
            : new Date();
        const missedDueDate = isBefore(new Date(job.dueDate), latestEnd);

        // Check departments are in sequential order
        const deptOrder = DEPARTMENTS.filter(d => job.departmentSchedule?.[d]);
        let outOfOrder = false;
        for (let i = 1; i < deptOrder.length; i++) {
            const prevEnd = new Date(job.departmentSchedule![deptOrder[i - 1]].end);
            const currStart = new Date(job.departmentSchedule![deptOrder[i]].start);
            // Allow same-day transitions (valid for small jobs); only flag true overlaps
            if (isBefore(currStart, startOfDay(prevEnd))) { outOfOrder = true; break; }
        }

        return {
            ...job,
            schedulingConflict: missedDueDate || outOfOrder,
            progressStatus: missedDueDate ? 'SLIPPING' : outOfOrder ? 'STALLED' : 'ON_TRACK'
        };
    });
};

// ---- Phase 5: Schedule Analysis v2 (Decision-Support Model) ----

// OT capacity constants — derived from base: 850pts / 40hrs = 21.25 pts/hr
const PTS_PER_HOUR = 21.25;
const OT_TIERS = [
    { tier: 1 as const, label: '9-Hour Days', weekdayHrs: '6:00am – 3:30pm', satHrs: 'N/A', extraHrs: 5, satHrs6: 0, bonusPts: Math.round(5 * PTS_PER_HOUR) },  // +106
    { tier: 2 as const, label: '10-Hour Days', weekdayHrs: '6:00am – 4:30pm', satHrs: 'N/A', extraHrs: 10, satHrs6: 0, bonusPts: Math.round(10 * PTS_PER_HOUR) }, // +213
    { tier: 3 as const, label: '9-Hour Days + Saturday', weekdayHrs: '6:00am – 3:30pm', satHrs: '6:00am – 12:00pm', extraHrs: 5, satHrs6: 6, bonusPts: Math.round(11 * PTS_PER_HOUR) }, // +234
    { tier: 4 as const, label: '10-Hour Days + Saturday', weekdayHrs: '6:00am – 4:30pm', satHrs: '6:00am – 12:00pm', extraHrs: 10, satHrs6: 6, bonusPts: Math.round(16 * PTS_PER_HOUR) }, // +340
] as const;

// ── Helper: find late jobs from a weekly load map ──
const findLateJobs = (jobs: Job[], weeklyLoad: WeeklyCapacityMap): LateJob[] => {
    const lateJobs: LateJob[] = [];
    for (const job of jobs) {
        if (!job.departmentSchedule || job.isOverdue) continue;

        const dueDate = new Date(job.dueDate);
        const allEnds = Object.values(job.departmentSchedule).map(s => new Date(s.end));
        if (allEnds.length === 0) continue;
        const latestEnd = new Date(Math.max(...allEnds.map(d => d.getTime())));

        if (isBefore(dueDate, latestEnd)) {
            // Count work days late
            let daysLate = 0;
            let cursor = addDays(dueDate, 1);
            while (isBefore(cursor, latestEnd) || cursor.getTime() === latestEnd.getTime()) {
                if (!isSaturday(cursor) && !isSunday(cursor)) daysLate++;
                cursor = addDays(cursor, 1);
            }

            // Identify bottleneck department
            let bottleneckDept = 'Unknown';
            let maxExcess = 0;
            for (const [dept, sched] of Object.entries(job.departmentSchedule)) {
                const wk = getWeekKey(new Date(sched.start));
                const load = weeklyLoad[wk]?.[dept];
                if (load && load.total > WEEKLY_TARGET && (load.total - WEEKLY_TARGET) > maxExcess) {
                    maxExcess = load.total - WEEKLY_TARGET;
                    bottleneckDept = dept;
                }
            }

            lateJobs.push({
                jobId: job.id,
                jobName: job.name,
                salesOrder: job.salesOrder,
                dueDate: dueDate.toISOString().split('T')[0],
                estimatedCompletion: latestEnd.toISOString().split('T')[0],
                daysLate,
                points: job.weldingPoints || 0,
                bottleneckDept
            });
        }
    }
    return lateJobs.sort((a, b) => b.daysLate - a.daysLate);
};

// ── Helper: find overloaded weeks ──
const findOverloadedWeeks = (weeklyLoad: WeeklyCapacityMap): OverloadedWeek[] => {
    const overloaded: OverloadedWeek[] = [];
    for (const [wk, depts] of Object.entries(weeklyLoad)) {
        for (const [dept, load] of Object.entries(depts)) {
            if (load.total > WEEKLY_TARGET) {
                overloaded.push({
                    weekKey: wk,
                    weekStart: wk,
                    department: dept,
                    scheduledPoints: Math.round(load.total),
                    capacity: WEEKLY_TARGET,
                    excess: Math.round(load.total - WEEKLY_TARGET),
                    jobCount: load.contributions.length
                });
            }
        }
    }
    return overloaded.sort((a, b) => b.excess - a.excess);
};

// ── Helper: deep-clone a weekly load map for simulation ──
const cloneWeeklyLoad = (wl: WeeklyCapacityMap): WeeklyCapacityMap => {
    const clone: WeeklyCapacityMap = {};
    for (const [wk, depts] of Object.entries(wl)) {
        clone[wk] = {};
        for (const [dept, load] of Object.entries(depts)) {
            clone[wk][dept] = {
                total: load.total,
                bigRockPts: load.bigRockPts,
                smallRockPts: load.smallRockPts,
                contributions: [...load.contributions]
            };
        }
    }
    return clone;
};

// ── Helper: remove a job's contributions from a simulated weekly load ──
const removeJobFromLoad = (simLoad: WeeklyCapacityMap, jobId: string) => {
    for (const [, depts] of Object.entries(simLoad)) {
        for (const [, load] of Object.entries(depts)) {
            let removedPoints = 0;
            const kept: { jobId: string; pts: number }[] = [];

            for (const contribution of load.contributions) {
                if (contribution.jobId === jobId) {
                    removedPoints += contribution.pts;
                } else {
                    kept.push(contribution);
                }
            }

            if (removedPoints > 0) {
                load.total -= removedPoints;
                load.contributions = kept;
            }
        }
    }
};

// ── Helper: count late jobs using a simulated load ──
// This is an approximation — it checks if the bottleneck weeks for each
// late job have been relieved enough to potentially bring the job on-time.
const estimateLateJobsAfterRelief = (
    originalLateJobs: LateJob[],
    originalLoad: WeeklyCapacityMap,
    simulatedLoad: WeeklyCapacityMap,
    jobsById: Map<string, Job>
): { recoveredIds: string[]; stillLate: LateJob[] } => {
    const recoveredIds: string[] = [];
    const stillLate: LateJob[] = [];

    for (const lj of originalLateJobs) {
        const job = jobsById.get(lj.jobId);
        if (!job?.departmentSchedule) { stillLate.push(lj); continue; }

        // Check if this job's bottleneck weeks have been sufficiently relieved
        let recovered = false;
        for (const [dept, sched] of Object.entries(job.departmentSchedule)) {
            const wk = getWeekKey(new Date(sched.start));
            const origLoad = originalLoad[wk]?.[dept]?.total || 0;
            const simLoad = simulatedLoad[wk]?.[dept]?.total || 0;

            if (origLoad > WEEKLY_TARGET && simLoad <= WEEKLY_TARGET) {
                // This bottleneck was cleared — estimate relief in work days
                const ptsRelieved = origLoad - simLoad;
                const daysRelieved = Math.round(ptsRelieved / (WEEKLY_TARGET / 5)); // ~170pts/day
                if (daysRelieved >= lj.daysLate) {
                    recovered = true;
                    break;
                }
            }
        }

        if (recovered) {
            recoveredIds.push(lj.jobId);
        } else {
            stillLate.push(lj);
        }
    }

    return { recoveredIds, stillLate };
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCHEDULE ANALYSIS v2 — Decision-Support Model
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Philosophy: "Better to disappoint 1 customer by 1-2 weeks than 5-10
 *              customers by 3-5 days."
 *
 * The analysis generates:
 * 1. BASELINE — current late jobs and overloaded weeks
 * 2. MOVE OPTIONS — both WO-level and SO-level pushes (+1wk, +2wk max)
 *    scored by how many late jobs each recovers globally
 * 3. OT RECOMMENDATIONS — 4-tier breakdown with hours and explanations
 * 4. PROJECTED OUTCOMES — before/after snapshots
 *
 * Hard constraint: NEVER push a job more than 2 weeks. Never 3 weeks late.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const analyzeSchedule = (
    jobs: Job[],
    activeAlerts: SupervisorAlert[] = []
): ScheduleInsights => {
    const weeklyLoad = computeWeeklyLoad(jobs);
    const jobsById = new Map<string, Job>();
    for (const job of jobs) jobsById.set(job.id, job);
    const blockedJobIds = new Set(
        activeAlerts
            .filter(alert => alert.status === 'active')
            .flatMap(alert => [alert.jobId, ...(alert.additionalJobIds || [])])
    );

    // ══════════════════════════════════════════════
    // 1. BASELINE
    // ══════════════════════════════════════════════
    const lateJobs = findLateJobs(jobs, weeklyLoad);
    const overloadedWeeks = findOverloadedWeeks(weeklyLoad);

    // ══════════════════════════════════════════════
    // 2. MOVE OPTIONS (Greedy — WO + SO at +1wk / +2wk)
    // ══════════════════════════════════════════════
    const moveOptions: MoveOption[] = [];

    // Build candidate set: jobs in overloaded weeks that could be pushed
    const candidateJobIds = new Set<string>();
    for (const ow of overloadedWeeks) {
        const weekLoad = weeklyLoad[ow.weekKey]?.[ow.department];
        if (!weekLoad) continue;
        for (const c of weekLoad.contributions) {
            candidateJobIds.add(c.jobId);
        }
    }

    // Determine which jobs are currently late (can't be Tier A candidates)
    const lateJobIds = new Set(lateJobs.map(lj => lj.jobId));

    // Tier A: non-late, non-overdue jobs with forward slack
    const tierAJobs = Array.from(candidateJobIds)
        .map(id => jobsById.get(id))
        .filter((j): j is Job => !!j && !j.isOverdue && !lateJobIds.has(j.id) && !blockedJobIds.has(j.id))
        .sort((a, b) => (b.weldingPoints || 0) - (a.weldingPoints || 0));

    // For each candidate, try +1wk and +2wk pushes and evaluate impact
    for (const candidate of tierAJobs.slice(0, 20)) { // Evaluate top 20 by points
        for (const pushWeeks of [1, 2] as (1 | 2)[]) {
            const currentDue = new Date(candidate.dueDate);
            const suggestedDue = addWorkDays(currentDue, pushWeeks * 5);

            // Simulate: remove this job's contributions from the load
            const simLoad = cloneWeeklyLoad(weeklyLoad);
            removeJobFromLoad(simLoad, candidate.id);

            // Check what departments/weeks are affected
            const affectedWeeks: string[] = [];
            const affectedDepts: string[] = [];
            let totalRelieved = 0;

            if (candidate.departmentSchedule) {
                for (const [dept, sched] of Object.entries(candidate.departmentSchedule)) {
                    const wk = getWeekKey(new Date(sched.start));
                    const origLoad = weeklyLoad[wk]?.[dept]?.total || 0;
                    if (origLoad > WEEKLY_TARGET) {
                        const contrib = weeklyLoad[wk][dept].contributions.find(c => c.jobId === candidate.id);
                        if (contrib) {
                            totalRelieved += Math.round(contrib.pts);
                            if (!affectedWeeks.includes(wk)) affectedWeeks.push(wk);
                            if (!affectedDepts.includes(dept)) affectedDepts.push(dept);
                        }
                    }
                }
            }

            if (totalRelieved === 0) continue; // No overloaded weeks affected

            // Estimate recovery
            const { recoveredIds, stillLate } = estimateLateJobsAfterRelief(
                lateJobs, weeklyLoad, simLoad, jobsById
            );

            // Check if pushing this job makes it late itself
            const latestEnd = candidate.departmentSchedule
                ? Math.max(...Object.values(candidate.departmentSchedule).map(s => new Date(s.end).getTime()))
                : currentDue.getTime();
            const newSlack = Math.round(
                (suggestedDue.getTime() - latestEnd) / (1000 * 60 * 60 * 24)
            );
            const riskLevel: 'safe' | 'moderate' = newSlack >= 3 ? 'safe' : 'moderate';

            // Build impact summary
            const recoveredCount = recoveredIds.length;
            const deptList = affectedDepts.join(', ');
            const weekList = affectedWeeks.join(', ');
            const impactSummary = recoveredCount > 0
                ? `Recovers ${recoveredCount} late job${recoveredCount > 1 ? 's' : ''}, relieves ${totalRelieved}pts from ${deptList} (${weekList})`
                : `Relieves ${totalRelieved}pts from ${deptList} (${weekList}) but doesn't directly recover any late jobs`;

            moveOptions.push({
                type: 'work_order',
                id: candidate.id,
                name: candidate.name,
                jobIds: [candidate.id],
                currentDueDate: currentDue.toISOString().split('T')[0],
                pushWeeks,
                suggestedDueDate: suggestedDue.toISOString().split('T')[0],
                pointsRelieved: totalRelieved,
                affectedWeeks,
                affectedDepartments: affectedDepts,
                riskLevel,
                lateJobsBefore: lateJobs.length,
                lateJobsAfter: stillLate.length,
                lateJobsRecovered: recoveredIds,
                impactSummary
            });
        }
    }

    // ── Sales Order level moves ──
    // Group candidates by SO# and evaluate pushing entire projects
    const soGroupMap = new Map<string, Job[]>();
    for (const candidate of tierAJobs) {
        if (!candidate.salesOrder) continue;
        if (!soGroupMap.has(candidate.salesOrder)) soGroupMap.set(candidate.salesOrder, []);
        soGroupMap.get(candidate.salesOrder)!.push(candidate);
    }

    for (const [so, soJobs] of soGroupMap) {
        if (soJobs.length < 1) continue; // Include even single-job SOs for comparison

        for (const pushWeeks of [1, 2] as (1 | 2)[]) {
            const earliestDue = new Date(Math.min(...soJobs.map(j => new Date(j.dueDate).getTime())));
            const suggestedDue = addWorkDays(earliestDue, pushWeeks * 5);

            // Simulate: remove ALL jobs in this SO from the load
            const simLoad = cloneWeeklyLoad(weeklyLoad);
            for (const j of soJobs) removeJobFromLoad(simLoad, j.id);

            // Aggregate impact
            const affectedWeeks: string[] = [];
            const affectedDepts: string[] = [];
            let totalRelieved = 0;

            for (const j of soJobs) {
                if (!j.departmentSchedule) continue;
                for (const [dept, sched] of Object.entries(j.departmentSchedule)) {
                    const wk = getWeekKey(new Date(sched.start));
                    const origLoad = weeklyLoad[wk]?.[dept]?.total || 0;
                    if (origLoad > WEEKLY_TARGET) {
                        const contrib = weeklyLoad[wk][dept].contributions.find(c => c.jobId === j.id);
                        if (contrib) {
                            totalRelieved += Math.round(contrib.pts);
                            if (!affectedWeeks.includes(wk)) affectedWeeks.push(wk);
                            if (!affectedDepts.includes(dept)) affectedDepts.push(dept);
                        }
                    }
                }
            }

            if (totalRelieved === 0) continue;

            const { recoveredIds, stillLate } = estimateLateJobsAfterRelief(
                lateJobs, weeklyLoad, simLoad, jobsById
            );

            const recoveredCount = recoveredIds.length;
            const deptList = affectedDepts.join(', ');
            const impactSummary = recoveredCount > 0
                ? `Recovers ${recoveredCount} late job${recoveredCount > 1 ? 's' : ''}, relieves ${totalRelieved}pts from ${deptList} across ${affectedWeeks.length} week${affectedWeeks.length > 1 ? 's' : ''}`
                : `Relieves ${totalRelieved}pts from ${deptList} but doesn't directly recover any late jobs`;

            moveOptions.push({
                type: 'sales_order',
                id: so,
                name: `SO ${so} (${soJobs.length} job${soJobs.length > 1 ? 's' : ''})`,
                jobIds: soJobs.map(j => j.id),
                currentDueDate: earliestDue.toISOString().split('T')[0],
                pushWeeks,
                suggestedDueDate: suggestedDue.toISOString().split('T')[0],
                pointsRelieved: totalRelieved,
                affectedWeeks,
                affectedDepartments: affectedDepts,
                riskLevel: 'safe', // SO moves are inherently safe (whole project moves)
                lateJobsBefore: lateJobs.length,
                lateJobsAfter: stillLate.length,
                lateJobsRecovered: recoveredIds,
                impactSummary
            });
        }
    }

    // Sort move options: most late jobs recovered first, then by points relieved
    moveOptions.sort((a, b) => {
        const recoveryDiff = b.lateJobsRecovered.length - a.lateJobsRecovered.length;
        if (recoveryDiff !== 0) return recoveryDiff;
        return b.pointsRelieved - a.pointsRelieved;
    });

    // ══════════════════════════════════════════════
    // 3. OT RECOMMENDATIONS (4 Tiers)
    // ══════════════════════════════════════════════
    const otRecommendations: OTRecommendation[] = [];
    for (const ow of overloadedWeeks) {
        // Find the minimum tier that covers the excess
        const selectedTier = OT_TIERS.find(t => t.bonusPts >= ow.excess) || OT_TIERS[OT_TIERS.length - 1];
        const remaining = ow.excess - selectedTier.bonusPts;

        // Build explanation
        let explanation: string;
        if (selectedTier.bonusPts >= ow.excess) {
            explanation = `${ow.department} is ${ow.excess}pts over capacity (${ow.scheduledPoints}/${ow.capacity}). ` +
                `${selectedTier.label} adds +${selectedTier.bonusPts}pts/week, fully covering the excess.`;
        } else {
            explanation = `${ow.department} is ${ow.excess}pts over capacity (${ow.scheduledPoints}/${ow.capacity}). ` +
                `Even ${selectedTier.label} (+${selectedTier.bonusPts}pts) leaves ${remaining}pts uncovered. ` +
                `Job moves are needed to relieve the remaining load.`;
        }

        // Add note about lower tiers that could partially help
        const lowerTier = OT_TIERS.find(t => t.tier < selectedTier.tier && t.bonusPts < ow.excess);
        if (lowerTier && selectedTier.tier > 1) {
            explanation += ` Note: ${lowerTier.label} (+${lowerTier.bonusPts}pts) would reduce but not fully clear the excess.`;
        }

        otRecommendations.push({
            weekKey: ow.weekKey,
            weekStart: ow.weekStart,
            department: ow.department,
            currentLoad: ow.scheduledPoints,
            baseCapacity: ow.capacity,
            excess: ow.excess,
            recommendedTier: selectedTier.tier,
            tierLabel: selectedTier.label,
            bonusPoints: selectedTier.bonusPts,
            remainingExcess: remaining,
            explanation,
            weekdayHours: selectedTier.weekdayHrs,
            saturdayHours: selectedTier.satHrs
        });
    }

    // ══════════════════════════════════════════════
    // 4. PROJECTED OUTCOMES
    // ══════════════════════════════════════════════

    // Project WITH MOVES: apply the top-scoring unique moves greedily
    const simLoadAfterMoves = cloneWeeklyLoad(weeklyLoad);
    const appliedMoveJobIds = new Set<string>();

    // Greedily apply the best non-overlapping moves
    for (const move of moveOptions) {
        // Skip if any job in this move has already been "moved"
        const alreadyApplied = move.jobIds.some(id => appliedMoveJobIds.has(id));
        if (alreadyApplied) continue;

        // Only apply moves that actually recover late jobs
        if (move.lateJobsRecovered.length === 0) continue;

        for (const jid of move.jobIds) {
            removeJobFromLoad(simLoadAfterMoves, jid);
            appliedMoveJobIds.add(jid);
        }
    }
    // Re-add late jobs that are still in the schedule but weren't moved
    const unmovableLate = lateJobs.filter(lj => !appliedMoveJobIds.has(lj.jobId));
    const afterMovesLate = estimateLateJobsAfterRelief(unmovableLate, weeklyLoad, simLoadAfterMoves, jobsById);
    const projectedOverloadedAfterMoves = findOverloadedWeeks(simLoadAfterMoves);

    // Project WITH MOVES + OT: add OT bonus to remaining overloaded weeks
    const simLoadAfterOT = cloneWeeklyLoad(simLoadAfterMoves);
    for (const ot of otRecommendations) {
        // Only apply OT to weeks that are still overloaded after moves
        const load = simLoadAfterOT[ot.weekKey]?.[ot.department];
        if (load && load.total > WEEKLY_TARGET) {
            load.total = Math.max(0, load.total - ot.bonusPoints);
        }
    }
    const afterOTLate = estimateLateJobsAfterRelief(afterMovesLate.stillLate, simLoadAfterMoves, simLoadAfterOT, jobsById);
    const projectedOverloadedAfterOT = findOverloadedWeeks(simLoadAfterOT);

    // ══════════════════════════════════════════════
    // 5. BUILD FINAL RESULT
    // ══════════════════════════════════════════════
    const totalExcessPoints = overloadedWeeks.reduce((sum, w) => sum + w.excess, 0);

    let alertImpact: ScheduleInsights['alertImpact'] | undefined;
    if (blockedJobIds.size > 0) {
        const blockedPointsByDepartment: Record<string, number> = {};

        for (const [, departments] of Object.entries(weeklyLoad)) {
            for (const [department, load] of Object.entries(departments)) {
                const blockedPoints = load.contributions
                    .filter(contribution => blockedJobIds.has(contribution.jobId))
                    .reduce((sum, contribution) => sum + contribution.pts, 0);

                if (blockedPoints > 0) {
                    blockedPointsByDepartment[department] =
                        (blockedPointsByDepartment[department] || 0) + blockedPoints;
                }
            }
        }

        const availableCapacityByDepartment: Record<string, number> = {};
        for (const [department, points] of Object.entries(blockedPointsByDepartment)) {
            availableCapacityByDepartment[department] = Math.round(points);
        }

        const blockedPointsTotal = Object.values(availableCapacityByDepartment)
            .reduce((sum, value) => sum + value, 0);

        alertImpact = {
            activeAlertCount: activeAlerts.filter(alert => alert.status === 'active').length,
            blockedJobCount: blockedJobIds.size,
            blockedJobIds: Array.from(blockedJobIds),
            blockedPointsTotal,
            blockedPointsByDepartment: availableCapacityByDepartment,
            availableCapacityByDepartment,
            note: 'Blocked jobs are excluded from move suggestions while active alerts remain unresolved.'
        };
    }

    return {
        lateJobs,
        overloadedWeeks,
        moveOptions,
        otRecommendations,
        projectedWithMoves: {
            lateJobs: afterMovesLate.stillLate,
            overloadedWeeks: projectedOverloadedAfterMoves
        },
        projectedWithMovesAndOT: {
            lateJobs: afterOTLate.stillLate,
            overloadedWeeks: projectedOverloadedAfterOT
        },
        summary: {
            totalJobs: jobs.length,
            onTimeJobs: jobs.length - lateJobs.length,
            lateJobCount: lateJobs.length,
            weeksRequiringOT: new Set(overloadedWeeks.map(w => w.weekKey)).size,
            totalExcessPoints: Math.round(totalExcessPoints),
            projectedLateAfterMoves: afterMovesLate.stillLate.length,
            projectedLateAfterOT: afterOTLate.stillLate.length
        },
        alertImpact
    };
};

type AlertAdjustmentStrategy = 'direct' | 'move_jobs' | 'ot';
type OvertimeTier = 1 | 2 | 3 | 4;

export interface AlertAdjustmentJobShift {
    jobId: string;
    workDays: number; // positive = later, negative = earlier
    reason: string;
}

export interface AlertAdjustmentOTRequirement {
    weekKey: string;
    department: string;
    excess: number;
    requiredTier: OvertimeTier;
    tierLabel: string;
    bonusPoints: number;
}

export interface AlertAdjustmentDecision {
    success: boolean;
    requestedStartDate: string;
    selectedStartDate?: string;
    strategy?: AlertAdjustmentStrategy;
    reason: string;
    affectedJobIds: string[];
    jobShifts: AlertAdjustmentJobShift[];
    otRequirements?: AlertAdjustmentOTRequirement[];
}

const normalizeToWorkday = (date: Date): Date => {
    let cursor = startOfDay(date);
    while (isSaturday(cursor) || isSunday(cursor)) {
        cursor = addDays(cursor, 1);
    }
    return cursor;
};

const calculateWorkdayDelta = (fromDate: Date, toDate: Date): number => {
    const from = startOfDay(fromDate);
    const to = startOfDay(toDate);
    if (from.getTime() === to.getTime()) return 0;

    const forward = to.getTime() > from.getTime();
    let cursor = new Date(from);
    let delta = 0;

    while (forward ? cursor < to : cursor > to) {
        cursor = addDays(cursor, forward ? 1 : -1);
        if (!isSaturday(cursor) && !isSunday(cursor)) {
            delta += forward ? 1 : -1;
        }
    }

    return delta;
};

const shiftScheduleByWorkdayDelta = (
    schedule?: Record<string, { start: string; end: string }>,
    deltaWorkDays: number = 0
): Record<string, { start: string; end: string }> | undefined => {
    if (!schedule) return undefined;
    if (deltaWorkDays === 0) return { ...schedule };

    const shifted: Record<string, { start: string; end: string }> = {};
    for (const [department, window] of Object.entries(schedule)) {
        const start = startOfDay(new Date(window.start));
        const end = startOfDay(new Date(window.end));
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

        const newStart = deltaWorkDays >= 0
            ? addWorkDays(start, deltaWorkDays)
            : subtractWorkDays(start, Math.abs(deltaWorkDays));
        const newEnd = deltaWorkDays >= 0
            ? addWorkDays(end, deltaWorkDays)
            : subtractWorkDays(end, Math.abs(deltaWorkDays));

        shifted[department] = {
            start: newStart.toISOString(),
            end: newEnd.toISOString()
        };
    }

    return Object.keys(shifted).length ? shifted : undefined;
};

const buildEffectiveCapacityJob = (job: Job): Job => {
    const remaining = job.remainingDepartmentSchedule;
    const hasRemaining = remaining && Object.keys(remaining).length > 0;
    return {
        ...job,
        departmentSchedule: hasRemaining ? remaining : job.departmentSchedule
    };
};

const shiftCapacityJob = (job: Job, deltaWorkDays: number): Job => {
    const shiftedSchedule = shiftScheduleByWorkdayDelta(job.departmentSchedule, deltaWorkDays);
    return {
        ...job,
        departmentSchedule: shiftedSchedule || job.departmentSchedule
    };
};

const isLateAgainstDueDate = (job: Job): boolean => {
    if (!job.departmentSchedule) return false;
    const latestEnd = Object.values(job.departmentSchedule)
        .map(window => startOfDay(new Date(window.end)))
        .filter(date => !Number.isNaN(date.getTime()))
        .reduce<Date | null>((max, current) => {
            if (!max) return current;
            return current > max ? current : max;
        }, null);

    if (!latestEnd) return false;
    const due = startOfDay(new Date(job.dueDate));
    return isBefore(due, latestEnd);
};

const weekDeptKey = (weekKey: string, department: string): string => `${weekKey}::${department}`;

const collectWeekDeptKeys = (job: Job): Set<string> => {
    const keys = new Set<string>();
    if (!job.departmentSchedule) return keys;

    for (const [department, window] of Object.entries(job.departmentSchedule)) {
        let cursor = startOfDay(new Date(window.start));
        const end = startOfDay(new Date(window.end));
        if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) continue;

        while (cursor <= end) {
            if (!isSaturday(cursor) && !isSunday(cursor)) {
                keys.add(weekDeptKey(getWeekKey(cursor), department));
            }
            cursor = addDays(cursor, 1);
        }
    }

    return keys;
};

type ImpactedOverload = {
    weekKey: string;
    department: string;
    scheduledPoints: number;
    excess: number;
};

const getImpactedOverloads = (
    weeklyLoad: WeeklyCapacityMap,
    targetWeekDeptKeys: Set<string>
): ImpactedOverload[] => {
    const overloads: ImpactedOverload[] = [];

    for (const key of targetWeekDeptKeys) {
        const [weekKey, department] = key.split('::');
        if (!weekKey || !department) continue;

        const total = weeklyLoad[weekKey]?.[department]?.total || 0;
        if (total > WEEKLY_TARGET) {
            overloads.push({
                weekKey,
                department,
                scheduledPoints: Math.round(total),
                excess: Math.round(total - WEEKLY_TARGET)
            });
        }
    }

    overloads.sort((a, b) => b.excess - a.excess);
    return overloads;
};

/**
 * Plan an "Adjust" action for a supervisor alert.
 * Decision order:
 * 1) Fit at requested resolution date with no overload
 * 2) Fit by shifting non-late jobs (never create new late jobs)
 * 3) Fit by OT tier coverage
 * 4) If none works, scan forward to first date where any strategy works
 */
export const planAlertAdjustment = (
    jobs: Job[],
    alert: SupervisorAlert,
    options: { searchWorkDays?: number; moveShiftDays?: number } = {}
): AlertAdjustmentDecision => {
    const searchWorkDays = Math.max(0, Math.min(options.searchWorkDays ?? 40, 120));
    const moveShiftDays = Math.max(1, Math.min(options.moveShiftDays ?? 5, 10));

    const requestedStart = normalizeToWorkday(new Date(alert.estimatedResolutionDate));
    if (Number.isNaN(requestedStart.getTime())) {
        return {
            success: false,
            requestedStartDate: '',
            reason: 'Adjustment failed: invalid estimated resolution date on the alert.',
            affectedJobIds: [],
            jobShifts: []
        };
    }

    const requestedStartDate = requestedStart.toISOString().split('T')[0];
    const requestedTargetIds = [alert.jobId, ...(alert.additionalJobIds || [])]
        .map(id => String(id || '').trim())
        .filter(Boolean);
    const uniqueTargetIds = Array.from(new Set(requestedTargetIds));

    const capacityJobs = jobs.map(buildEffectiveCapacityJob);
    const jobsById = new Map<string, Job>(capacityJobs.map(job => [job.id, job]));
    const targetJobs = uniqueTargetIds
        .map(jobId => jobsById.get(jobId))
        .filter((job): job is Job => !!job && !!job.departmentSchedule);
    const targetJobIdSet = new Set(targetJobs.map(job => job.id));
    const missingTargetIds = uniqueTargetIds.filter(jobId => !targetJobIdSet.has(jobId));
    const skippedNote = missingTargetIds.length > 0
        ? ` ${missingTargetIds.length} selected work order${missingTargetIds.length > 1 ? 's were' : ' was'} not loaded and skipped.`
        : '';

    if (targetJobs.length === 0) {
        return {
            success: false,
            requestedStartDate,
            reason: `Adjustment failed: none of the selected work orders have an active schedule.`,
            affectedJobIds: [],
            jobShifts: []
        };
    }

    const anchorJob = targetJobs.find(job => !!job.departmentSchedule?.[alert.department]);
    if (!anchorJob || !anchorJob.departmentSchedule) {
        return {
            success: false,
            requestedStartDate,
            reason: `Adjustment failed: ${alert.department} is not present in any selected job schedule.`,
            affectedJobIds: targetJobs.map(job => job.id),
            jobShifts: []
        };
    }

    const alertDeptWindow = anchorJob.departmentSchedule[alert.department];
    const currentDeptStart = startOfDay(new Date(alertDeptWindow.start));
    if (Number.isNaN(currentDeptStart.getTime())) {
        return {
            success: false,
            requestedStartDate,
            reason: `Adjustment failed: current ${alert.department} start date is invalid.`,
            affectedJobIds: targetJobs.map(job => job.id),
            jobShifts: []
        };
    }

    for (let offset = 0; offset <= searchWorkDays; offset += 1) {
        const candidateStart = offset === 0 ? requestedStart : addWorkDays(requestedStart, offset);
        const candidateStartDate = candidateStart.toISOString().split('T')[0];
        const targetShiftDays = calculateWorkdayDelta(currentDeptStart, candidateStart);
        const scenarioJobs = new Map(jobsById);
        const targetShifts: AlertAdjustmentJobShift[] = [];
        const impactedKeys = new Set<string>();

        for (const targetJob of targetJobs) {
            const shiftedTarget = shiftCapacityJob(targetJob, targetShiftDays);
            scenarioJobs.set(targetJob.id, shiftedTarget);
            targetShifts.push({
                jobId: targetJob.id,
                workDays: targetShiftDays,
                reason: `Shift ${targetJob.id} to align ${alert.department} with ${candidateStartDate}.`
            });
            const keys = collectWeekDeptKeys(shiftedTarget);
            for (const key of keys) impactedKeys.add(key);
        }

        if (impactedKeys.size === 0) continue;

        const baseLoad = computeWeeklyLoad(Array.from(scenarioJobs.values()));
        const baseOverloads = getImpactedOverloads(baseLoad, impactedKeys);

        if (baseOverloads.length === 0) {
            const reason = offset === 0
                ? `Moved ${targetJobs.length} affected work order${targetJobs.length > 1 ? 's' : ''} to ${candidateStartDate}. Capacity is available in all affected department-week slots.${skippedNote}`
                : `Requested date could not fit. First available slot is ${candidateStartDate} for ${targetJobs.length} affected work order${targetJobs.length > 1 ? 's' : ''}.${skippedNote}`;
            return {
                success: true,
                requestedStartDate,
                selectedStartDate: candidateStartDate,
                strategy: 'direct',
                reason,
                affectedJobIds: targetJobs.map(job => job.id),
                jobShifts: targetShifts
            };
        }

        const reliefByJob = new Map<string, number>();
        for (const overload of baseOverloads) {
            const contributions = baseLoad[overload.weekKey]?.[overload.department]?.contributions || [];
            for (const contribution of contributions) {
                if (targetJobIdSet.has(contribution.jobId)) continue;
                reliefByJob.set(
                    contribution.jobId,
                    (reliefByJob.get(contribution.jobId) || 0) + contribution.pts
                );
            }
        }

        const movableCandidates = Array.from(reliefByJob.entries())
            .map(([jobId, reliefPoints]) => {
                const candidate = scenarioJobs.get(jobId);
                if (!candidate || !candidate.departmentSchedule) return null;
                if (isLateAgainstDueDate(candidate)) return null;

                const shiftedCandidate = shiftCapacityJob(candidate, moveShiftDays);
                if (isLateAgainstDueDate(shiftedCandidate)) return null;

                return {
                    jobId,
                    reliefPoints,
                    shiftedCandidate
                };
            })
            .filter((value): value is { jobId: string; reliefPoints: number; shiftedCandidate: Job } => !!value)
            .sort((a, b) => {
                if (b.reliefPoints !== a.reliefPoints) return b.reliefPoints - a.reliefPoints;
                return a.shiftedCandidate.weldingPoints - b.shiftedCandidate.weldingPoints;
            });

        if (movableCandidates.length > 0) {
            const moveScenario = new Map(scenarioJobs);
            const moveShifts: AlertAdjustmentJobShift[] = [];

            for (const candidate of movableCandidates) {
                moveScenario.set(candidate.jobId, candidate.shiftedCandidate);
                moveShifts.push({
                    jobId: candidate.jobId,
                    workDays: moveShiftDays,
                    reason: `Shift ${candidate.jobId} by ${moveShiftDays} work day${moveShiftDays > 1 ? 's' : ''} to relieve overloaded slots.`
                });

                const loadAfterMoves = computeWeeklyLoad(Array.from(moveScenario.values()));
                const remainingOverloads = getImpactedOverloads(loadAfterMoves, impactedKeys);
                if (remainingOverloads.length === 0) {
                    const reason = offset === 0
                        ? `Moved ${targetJobs.length} affected work order${targetJobs.length > 1 ? 's' : ''} to ${candidateStartDate}. Required shifting ${moveShifts.length} non-late job${moveShifts.length > 1 ? 's' : ''} to clear capacity without creating late jobs.${skippedNote}`
                        : `Requested date could not fit. First workable slot is ${candidateStartDate} by shifting ${moveShifts.length} non-late job${moveShifts.length > 1 ? 's' : ''} while keeping those jobs on-time.${skippedNote}`;
                    return {
                        success: true,
                        requestedStartDate,
                        selectedStartDate: candidateStartDate,
                        strategy: 'move_jobs',
                        reason,
                        affectedJobIds: targetJobs.map(job => job.id),
                        jobShifts: [...targetShifts, ...moveShifts]
                    };
                }
            }
        }

        const otRequirements: AlertAdjustmentOTRequirement[] = [];
        let otCanCover = true;
        for (const overload of baseOverloads) {
            const tier = OT_TIERS.find(ot => ot.bonusPts >= overload.excess);
            if (!tier) {
                otCanCover = false;
                break;
            }
            otRequirements.push({
                weekKey: overload.weekKey,
                department: overload.department,
                excess: overload.excess,
                requiredTier: tier.tier,
                tierLabel: tier.label,
                bonusPoints: tier.bonusPts
            });
        }

        if (otCanCover && otRequirements.length > 0) {
            const otDetails = otRequirements
                .map(requirement => `${requirement.department} ${requirement.weekKey}: Tier ${requirement.requiredTier}`)
                .join(', ');
            const maxTier = otRequirements.reduce<OvertimeTier>((acc, requirement) =>
                requirement.requiredTier > acc ? requirement.requiredTier : acc
                , 1);
            const reason = offset === 0
                ? `Moved ${targetJobs.length} affected work order${targetJobs.length > 1 ? 's' : ''} to ${candidateStartDate}. Capacity requires OT support (up to Tier ${maxTier}) in affected slots: ${otDetails}.${skippedNote}`
                : `Requested date could not fit. First workable slot is ${candidateStartDate} with OT support (up to Tier ${maxTier}): ${otDetails}.${skippedNote}`;
            return {
                success: true,
                requestedStartDate,
                selectedStartDate: candidateStartDate,
                strategy: 'ot',
                reason,
                affectedJobIds: targetJobs.map(job => job.id),
                jobShifts: targetShifts,
                otRequirements
            };
        }
    }

    return {
        success: false,
        requestedStartDate,
        reason: `No feasible slot found within ${searchWorkDays} work days after ${requestedStartDate}.`,
        affectedJobIds: targetJobs.map(job => job.id),
        jobShifts: []
    };
};

// ---- Pipeline Orchestrator ----

const schedulePipeline = (jobs: Job[]): { jobs: Job[]; insights: ScheduleInsights } => {
    const today = normalizeWorkStart(new Date());

    console.log(`[SCHEDULER] ========= 4-Phase Pipeline: ${jobs.length} jobs =========`);

    // --- Phase 1: Ideal Placement ---
    console.log(`[SCHEDULER] Phase 1: Ideal placement...`);
    const overdueJobs = jobs.filter(j => isJobOverdue(j));
    const onTimeJobs = jobs.filter(j => !isJobOverdue(j));

    const placed: Job[] = [];

    // Shared capacity pool — overdue + on-time jobs see each other's reservations
    const buckets = initBuckets(subDays(today, 30), addDays(today, 180));

    // Overdue jobs: forward from today (capacity-aware to avoid stacking)
    if (overdueJobs.length > 0) {
        overdueJobs.sort((a, b) => getDaysOverdue(b) - getDaysOverdue(a));
        for (const job of overdueJobs) {
            placed.push(scheduleForwardFromToday(job, buckets));
        }
        console.log(`[SCHEDULER]   ${overdueJobs.length} overdue → forward from today`);
    }

    // On-time jobs: compute batch sizes, then place backward from due date (CAPACITY-AWARE)
    onTimeJobs.sort(compareByDueDateAndSize);
    const ordered = orderJobsForBatching(onTimeJobs, compareByDueDateAndSize);

    const batchSizeMap = buildBatchSizeMap(ordered);

    // Populate urgency scores
    ordered.forEach(job => {
        const scoreResult = calculateUrgencyScore(job);
        job.urgencyScore = scoreResult.score;
        job.urgencyFactors = scoreResult.factors;
    });

    let otCount = 0;
    for (const job of ordered) {
        const batchSize = batchSizeMap.get(job.id) || 1;

        // Pass 1: Try regular capacity (850/week)
        const dryResult = scheduleBackwardFromDue(job, buckets, placed, batchSize, { dryRun: true });

        // Check if regular capacity can meet due date
        const dryEnds = Object.values(dryResult.departmentSchedule || {}).map(s => new Date(s.end));
        const dryLatest = dryEnds.length > 0 ? new Date(Math.max(...dryEnds.map(d => d.getTime()))) : today;
        const wouldMiss = isBefore(normalizeWorkEnd(new Date(job.dueDate)), dryLatest);

        if (!wouldMiss) {
            // Fits at regular capacity — do the real run
            placed.push(scheduleBackwardFromDue(job, buckets, placed, batchSize));
        } else {
            // OT escalation: retry with 950/week ceiling
            const otResult = scheduleBackwardFromDue(job, buckets, placed, batchSize, { allowOT: true });
            const otEnds = Object.values(otResult.departmentSchedule || {}).map(s => new Date(s.end));
            const otLatest = otEnds.length > 0 ? new Date(Math.max(...otEnds.map(d => d.getTime()))) : today;
            const stillMisses = isBefore(normalizeWorkEnd(new Date(job.dueDate)), otLatest);

            if (!stillMisses) {
                // OT saved it — tag the job
                placed.push({ ...otResult, requiresOT: true });
                otCount++;
            } else {
                // Even OT can't save it — accept the late position
                placed.push({ ...otResult, requiresOT: true, schedulingConflict: true });
                otCount++;
            }
        }
    }
    const lockstepPlaced = applyBatchLockstepAlignment(placed);
    console.log(`[SCHEDULER]   ${onTimeJobs.length} on-time → backward from due date (${otCount} required OT escalation)`);

    // --- Phase 2: Capacity Audit ---
    console.log(`[SCHEDULER] Phase 2: Capacity audit...`);
    const initialLoad = computeWeeklyLoad(lockstepPlaced);
    let overloadCount = 0;
    for (const depts of Object.values(initialLoad)) {
        for (const load of Object.values(depts)) {
            if (load.total > WEEKLY_TARGET) overloadCount++;
        }
    }
    console.log(`[SCHEDULER]   ${overloadCount} overloaded week-dept pairs`);

    // --- Phase 3: Compression ---
    console.log(`[SCHEDULER] Phase 3: Compressing...`);
    const compressed = compressSchedule(lockstepPlaced);
    // Re-align batches after compression. Lockstep only touches Engineering,
    // Laser, and Press Brake — so it preserves compression's capacity work
    // on Welding/Polishing/Assembly while keeping batches tight upstream.
    const lockstepCompressed = applyBatchLockstepAlignment(compressed);

    // --- Phase 4: Validation ---
    console.log(`[SCHEDULER] Phase 4: Validating...`);
    const validated = validateSchedule(lockstepCompressed);
    const conflicts = validated.filter(j => j.schedulingConflict).length;
    console.log(`[SCHEDULER]   ${conflicts} jobs with conflicts`);

    // --- Phase 5: Analysis ---
    console.log(`[SCHEDULER] Phase 5: Analyzing...`);
    const insights = analyzeSchedule(validated);
    console.log(`[SCHEDULER]   ${insights.summary.lateJobCount} late jobs, ${insights.summary.weeksRequiringOT} weeks needing OT`);
    console.log(`[SCHEDULER]   ${insights.moveOptions.length} move options, ${insights.otRecommendations.length} OT recommendations`);
    console.log(`[SCHEDULER] ========= Pipeline Complete =========`);

    return { jobs: validated, insights };
};

// ---- Due Date Change: Smart Reschedule Suggestion ----

export interface RescheduleSuggestion {
    jobId: string;
    jobName: string;
    previousDueDate: string;       // ISO date
    newDueDate: string;            // ISO date
    currentSchedule: Record<string, { start: string; end: string }>;
    suggestedSchedule: Record<string, { start: string; end: string }>;
    strategy: 'direct' | 'move_jobs' | 'ot' | 'no_fit';
    hasConflict: boolean;
    shiftDirection: 'earlier' | 'later' | 'unchanged';
    shiftWorkDays: number;
    jobShifts: Array<{
        jobId: string;
        jobName: string;
        workDays: number;
        reason: string;
    }>;
    otRequirements?: Array<{
        weekKey: string;
        department: string;
        excess: number;
        requiredTier: 1 | 2 | 3 | 4;
        tierLabel: string;
        bonusPoints: number;
    }>;
    summary: string;
}

/**
 * Suggest optimal placement for a job whose due date has changed.
 * Uses 3-tier capacity-aware strategy:
 *   Tier 1: Direct Fit — place at ideal spot if capacity allows
 *   Tier 2: Shift Flexible Jobs — nudge non-late jobs to open slots
 *   Tier 3: OT Coverage — calculate overtime needed for remaining excess
 *   Fallback: warn that due date can't be met
 */
export const suggestReschedule = (targetJob: Job, allJobs: Job[]): RescheduleSuggestion => {
    const MOVE_SHIFT_DAYS = 5; // Max days to nudge flexible jobs

    // Safe date parser: handles Firestore Timestamps, Date objects, ISO strings
    const safeDate = (val: any): Date | null => {
        if (!val) return null;
        if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
        if (typeof val?.toDate === 'function') return val.toDate();
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    };

    const jobName = targetJob.name || targetJob.id;
    const prevDate = safeDate(targetJob.previousDueDate);
    const previousDueDate = prevDate ? prevDate.toISOString().split('T')[0] : '?';
    const curDate = safeDate(targetJob.dueDate);
    const newDueDate = curDate ? curDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const currentSchedule = targetJob.departmentSchedule || {};

    // Step 1: Compute ideal placement with the new due date
    const idealJob = placeIdeal(targetJob);
    const suggestedSchedule = idealJob.departmentSchedule || {};

    // Calculate shift direction and magnitude
    const currentFirstStart = getEarliestStart(currentSchedule);
    const suggestedFirstStart = getEarliestStart(suggestedSchedule);
    let shiftDirection: 'earlier' | 'later' | 'unchanged' = 'unchanged';
    let shiftWorkDays = 0;

    if (currentFirstStart && suggestedFirstStart) {
        shiftWorkDays = Math.abs(calculateWorkdayDelta(currentFirstStart, suggestedFirstStart));
        if (suggestedFirstStart < currentFirstStart) shiftDirection = 'earlier';
        else if (suggestedFirstStart > currentFirstStart) shiftDirection = 'later';
    }

    // Step 2: Check capacity impact of the new placement
    // Build scenario: all jobs EXCEPT the target, + the target at new placement
    const otherJobs = allJobs.filter(j => j.id !== targetJob.id);
    const scenarioJobs = [...otherJobs.map(buildEffectiveCapacityJob), idealJob];

    const weeklyLoad = computeWeeklyLoad(scenarioJobs);
    const targetWeekDeptKeys = collectWeekDeptKeys(idealJob);
    const overloads = getImpactedOverloads(weeklyLoad, targetWeekDeptKeys);

    // Tier 1: Direct Fit — no overloads in the target job's slots
    if (overloads.length === 0) {
        const directionText = shiftDirection === 'unchanged'
            ? 'No schedule change needed'
            : `Moves ${shiftWorkDays} work day${shiftWorkDays !== 1 ? 's' : ''} ${shiftDirection}`;

        return {
            jobId: targetJob.id,
            jobName,
            previousDueDate,
            newDueDate,
            currentSchedule,
            suggestedSchedule,
            strategy: 'direct',
            hasConflict: !!idealJob.schedulingConflict,
            shiftDirection,
            shiftWorkDays,
            jobShifts: [],
            summary: `✅ Clean fit. ${directionText}. All capacity slots are available.`
                + (idealJob.schedulingConflict ? ' ⚠ However, the job will finish after the new due date.' : '')
        };
    }

    // Tier 2: Try shifting non-late jobs
    const targetJobIdSet = new Set([targetJob.id]);

    // Find jobs contributing to overloaded slots that can be shifted
    const reliefByJob = new Map<string, number>();
    for (const overload of overloads) {
        const contributions = weeklyLoad[overload.weekKey]?.[overload.department]?.contributions || [];
        for (const contribution of contributions) {
            if (targetJobIdSet.has(contribution.jobId)) continue;
            reliefByJob.set(
                contribution.jobId,
                (reliefByJob.get(contribution.jobId) || 0) + contribution.pts
            );
        }
    }

    // Find movable candidates (non-late jobs with slack)
    const scenarioJobsById = new Map(scenarioJobs.map(j => [j.id, j]));
    const movableCandidates = Array.from(reliefByJob.entries())
        .map(([jobId, reliefPoints]) => {
            const candidate = scenarioJobsById.get(jobId);
            if (!candidate || !candidate.departmentSchedule) return null;
            if (isLateAgainstDueDate(candidate)) return null;

            const shiftedCandidate = shiftCapacityJob(candidate, MOVE_SHIFT_DAYS);
            if (isLateAgainstDueDate(shiftedCandidate)) return null;

            return { jobId, reliefPoints, shiftedCandidate, jobName: candidate.name || candidate.id };
        })
        .filter((v): v is NonNullable<typeof v> => !!v)
        .sort((a, b) => b.reliefPoints - a.reliefPoints);

    if (movableCandidates.length > 0) {
        const moveScenarioJobs = new Map(scenarioJobsById);
        const appliedShifts: RescheduleSuggestion['jobShifts'] = [];

        for (const candidate of movableCandidates) {
            moveScenarioJobs.set(candidate.jobId, candidate.shiftedCandidate);
            appliedShifts.push({
                jobId: candidate.jobId,
                jobName: candidate.jobName,
                workDays: MOVE_SHIFT_DAYS,
                reason: `Shift +${MOVE_SHIFT_DAYS} work days to free capacity (stays on-time)`
            });

            // Recheck overloads
            const loadAfterMoves = computeWeeklyLoad(Array.from(moveScenarioJobs.values()));
            const remainingOverloads = getImpactedOverloads(loadAfterMoves, targetWeekDeptKeys);
            if (remainingOverloads.length === 0) {
                const directionText = shiftDirection === 'unchanged'
                    ? 'No schedule change needed'
                    : `Moves ${shiftWorkDays} work day${shiftWorkDays !== 1 ? 's' : ''} ${shiftDirection}`;

                return {
                    jobId: targetJob.id,
                    jobName,
                    previousDueDate,
                    newDueDate,
                    currentSchedule,
                    suggestedSchedule,
                    strategy: 'move_jobs',
                    hasConflict: !!idealJob.schedulingConflict,
                    shiftDirection,
                    shiftWorkDays,
                    jobShifts: appliedShifts,
                    summary: `🔄 Requires shifting ${appliedShifts.length} job${appliedShifts.length !== 1 ? 's' : ''}. ${directionText}. All shifted jobs remain on-time.`
                        + (idealJob.schedulingConflict ? ' ⚠ However, the job will finish after the new due date.' : '')
                };
            }
        }
    }

    // Tier 3: OT coverage
    const otRequirements: RescheduleSuggestion['otRequirements'] = [];
    let otCanCover = true;
    for (const overload of overloads) {
        const tier = OT_TIERS.find(t => t.bonusPts >= overload.excess);
        if (!tier) {
            otCanCover = false;
            break;
        }
        otRequirements.push({
            weekKey: overload.weekKey,
            department: overload.department,
            excess: overload.excess,
            requiredTier: tier.tier,
            tierLabel: tier.label,
            bonusPoints: tier.bonusPts
        });
    }

    if (otCanCover && otRequirements.length > 0) {
        const maxTier = otRequirements.reduce((acc, r) => (r.requiredTier > acc ? r.requiredTier : acc), 1 as 1 | 2 | 3 | 4);
        const directionText = shiftDirection === 'unchanged'
            ? 'No schedule change needed'
            : `Moves ${shiftWorkDays} work day${shiftWorkDays !== 1 ? 's' : ''} ${shiftDirection}`;

        return {
            jobId: targetJob.id,
            jobName,
            previousDueDate,
            newDueDate,
            currentSchedule,
            suggestedSchedule,
            strategy: 'ot',
            hasConflict: !!idealJob.schedulingConflict,
            shiftDirection,
            shiftWorkDays,
            jobShifts: [],
            otRequirements,
            summary: `⏱ Requires overtime (up to Tier ${maxTier}). ${directionText}. ` +
                `${otRequirements.length} department-week slot${otRequirements.length !== 1 ? 's' : ''} need OT coverage.`
                + (idealJob.schedulingConflict ? ' ⚠ However, the job will finish after the new due date.' : '')
        };
    }

    // Fallback: No fit possible
    return {
        jobId: targetJob.id,
        jobName,
        previousDueDate,
        newDueDate,
        currentSchedule,
        suggestedSchedule,
        strategy: 'no_fit',
        hasConflict: true,
        shiftDirection,
        shiftWorkDays,
        jobShifts: [],
        otRequirements,
        summary: `⚠ Cannot cleanly meet the new due date. The ideal placement creates overloads that cannot be resolved with job moves or overtime. ` +
            `The suggested schedule is the best-effort backward placement from the new due date.`
    };
};

/** Helper: get earliest start date from a department schedule */
const getEarliestStart = (schedule: Record<string, { start: string; end: string }>): Date | null => {
    const starts = Object.values(schedule).map(s => new Date(s.start)).filter(d => !isNaN(d.getTime()));
    if (starts.length === 0) return null;
    return new Date(Math.min(...starts.map(d => d.getTime())));
};

// ---- Public Entry Points (updated to use pipeline) ----

/**
 * Unified Backward Scheduler — 4-Phase Weekly Pipeline
 * Used by the import page for initial and subsequent XLSX imports
 */
export const scheduleAllJobs = (jobs: Job[], existingJobs: Job[] = []): { jobs: Job[]; insights: ScheduleInsights } => {
    console.log('🔥 4-PHASE WEEKLY PIPELINE — Scheduling', jobs.length, 'jobs');
    return schedulePipeline(jobs);
};

/**
 * Analyze already-scheduled jobs to generate insights without re-running the pipeline.
 * Used by the Planning Board to show insights on-demand.
 */
export const analyzeScheduleFromJobs = (jobs: Job[], activeAlerts: SupervisorAlert[] = []): ScheduleInsights => {
    return analyzeSchedule(jobs, activeAlerts);
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
                const daysSinceChange = businessDayDistance(
                    startOfDay(new Date(updatedJob.lastDepartmentChange)),
                    startOfDay(new Date())
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
