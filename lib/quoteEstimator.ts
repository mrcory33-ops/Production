import { Department, ProductType, Job } from '@/types';
import { addDays, isWeekend, startOfWeek, format, differenceInDays, startOfDay } from 'date-fns';
import { calculateDeptDuration } from './departmentConfig';

// Formula: $650 = 1 welding point
const DOLLAR_TO_POINT_RATIO = 650;
const BASE_WEEKLY_CAPACITY = 850;
const OT_WEEKLY_CAPACITY = 1000;

export interface BigRockInput {
    value: number;
    points?: number;
}

export interface QuoteInput {
    totalValue: number;
    totalQuantity: number;
    bigRocks: BigRockInput[];
    isREF: boolean;
    engineeringReadyDate: Date;
    targetDate?: Date;
}

export interface QuoteEstimate {
    totalPoints: number;
    bigRockPoints: number;
    remainingPoints: number;
    remainingValue: number;
    remainingQuantity: number;
    estimatedCompletion: Date;
    timeline: DepartmentTimeline[];
    urgencyScore: number;
    isBigRock: boolean;
}

export interface DepartmentTimeline {
    department: Department;
    startDate: Date;
    endDate: Date;
    duration: number;
}

export interface JobMovement {
    jobId: string;
    jobName: string;
    department: Department;
    originalDate: Date;
    newDate: Date;
    dueDate: Date;
    bufferDays: number;
}

export interface FeasibilityCheck {
    // Tier 1: As-Is
    asIs: {
        achievable: boolean;
        completionDate: Date | null;
        bottlenecks: string[];
    };

    // Tier 2: With Moves
    withMoves: {
        achievable: boolean;
        completionDate: Date | null;
        jobsToMove: JobMovement[];
        totalJobsAffected: number;
    };

    // Tier 3: With OT
    withOT: {
        achievable: boolean;
        completionDate: Date | null;
        otWeeks: string[];
    };

    recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE';
    explanation: string;
}

/**
 * Convert dollar value to welding points
 */
export function convertDollarToPoints(dollarValue: number): number {
    return Math.round((dollarValue / DOLLAR_TO_POINT_RATIO) * 10) / 10;
}

/**
 * Calculate total points from quote inputs
 */
export function calculateQuotePoints(input: QuoteInput): {
    totalPoints: number;
    bigRockPoints: number;
    remainingPoints: number;
    remainingValue: number;
} {
    const totalValue = Math.max(0, input.totalValue || 0);

    const bigRockPoints = input.bigRocks.reduce((sum, br) => {
        const value = Number(br.value) || 0;
        return sum + convertDollarToPoints(value);
    }, 0);

    const bigRockValue = input.bigRocks.reduce((sum, br) => sum + (Number(br.value) || 0), 0);
    const remainingValue = Math.max(0, totalValue - bigRockValue);
    const remainingPoints = convertDollarToPoints(remainingValue);

    return {
        totalPoints: bigRockPoints + remainingPoints,
        bigRockPoints,
        remainingPoints,
        remainingValue,
    };
}

/**
 * Skip weekends when calculating dates
 */
function addWorkDays(startDate: Date, days: number): Date {
    let current = new Date(startDate);
    let remainingDays = days;

    while (remainingDays > 0) {
        current = addDays(current, 1);
        if (!isWeekend(current)) {
            remainingDays--;
        }
    }

    return current;
}

function countWorkdaysBetween(startDate: Date, endDate: Date): number {
    let current = startOfDay(startDate);
    const end = startOfDay(endDate);
    let count = 0;

    while (current <= end) {
        if (!isWeekend(current)) {
            count++;
        }
        current = addDays(current, 1);
    }

    return count;
}

function distributePointsByWorkday(
    startDate: Date,
    endDate: Date,
    points: number
): Map<string, number> {
    const distribution = new Map<string, number>();
    if (points <= 0) return distribution;

    const totalWorkdays = countWorkdaysBetween(startDate, endDate);
    if (totalWorkdays <= 0) return distribution;

    const pointsPerDay = points / totalWorkdays;
    let current = startOfDay(startDate);
    const end = startOfDay(endDate);

    while (current <= end) {
        if (!isWeekend(current)) {
            const weekKey = getWeekKey(current);
            distribution.set(weekKey, (distribution.get(weekKey) || 0) + pointsPerDay);
        }
        current = addDays(current, 1);
    }

    return distribution;
}

function getEndDateForDuration(startDate: Date, duration: number): Date {
    const daySpan = Math.max(0, Math.ceil(duration) - 1);
    return addWorkDays(startDate, daySpan);
}

/**
 * Calculate department gap based on job size
 */
function getDepartmentGap(points: number): number {
    if (points >= 50) return 1; // Big Rock: 1 day gap
    if (points >= 8) return 0.5; // Medium: 0.5 day gap
    return 0; // Small: no gap
}

/**
 * Get week key for capacity tracking
 */
function getWeekKey(date: Date): string {
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    return format(weekStart, 'yyyy-MM-dd');
}

/**
 * Build capacity usage map from existing jobs
 */
function buildCapacityMap(existingJobs: Job[]): Map<string, Map<Department, number>> {
    const capacityMap = new Map<string, Map<Department, number>>();

    for (const job of existingJobs) {
        if (!job.departmentSchedule) continue;

        for (const [deptKey, schedule] of Object.entries(job.departmentSchedule)) {
            const dept = deptKey as Department;
            const startDate = new Date(schedule.start);
            const endDate = new Date(schedule.end);
            const points = Number(job.weldingPoints) || 0;
            if (points <= 0) continue;

            const weekDistribution = distributePointsByWorkday(startDate, endDate, points);
            for (const [weekKey, weekPoints] of weekDistribution.entries()) {
                if (!capacityMap.has(weekKey)) {
                    capacityMap.set(weekKey, new Map());
                }

                const weekMap = capacityMap.get(weekKey)!;
                const currentUsage = weekMap.get(dept) || 0;
                weekMap.set(dept, currentUsage + weekPoints);
            }
        }
    }

    return capacityMap;
}

/**
 * Find first available slot for a department with given capacity
 */
function findAvailableSlot(
    dept: Department,
    startDate: Date,
    points: number,
    duration: number,
    capacityMap: Map<string, Map<Department, number>>,
    weeklyCapacity: number
): Date {
    let current = startOfDay(startDate);
    while (isWeekend(current)) {
        current = addDays(current, 1);
    }
    let attempts = 0;
    const maxAttempts = 140; // Prevent infinite loop (~28 weeks of workdays)

    while (attempts < maxAttempts) {
        const endDate = getEndDateForDuration(current, duration);
        const distribution = distributePointsByWorkday(current, endDate, points);

        let fits = true;
        for (const [weekKey, weekPoints] of distribution.entries()) {
            const weekMap = capacityMap.get(weekKey);
            const currentUsage = weekMap?.get(dept) || 0;
            if (currentUsage + weekPoints > weeklyCapacity) {
                fits = false;
                break;
            }
        }

        if (fits) return current;

        // Move to next workday
        current = addDays(current, 1);
        while (isWeekend(current)) {
            current = addDays(current, 1);
        }
        attempts++;
    }

    // Fallback: return original date if no slot found
    return startDate;
}

/**
 * Calculate buffer for existing jobs
 */
function calculateJobBuffers(existingJobs: Job[]): Map<string, number> {
    const buffers = new Map<string, number>();

    for (const job of existingJobs) {
        if (!job.departmentSchedule || !job.dueDate) continue;

        // Find latest scheduled end date
        let latestEnd: Date | null = null;
        for (const schedule of Object.values(job.departmentSchedule)) {
            const endDate = new Date(schedule.end);
            if (!latestEnd || endDate > latestEnd) {
                latestEnd = endDate;
            }
        }

        if (latestEnd) {
            const dueDate = new Date(job.dueDate);
            const bufferDays = differenceInDays(dueDate, latestEnd);
            buffers.set(job.id, bufferDays);
        }
    }

    return buffers;
}

/**
 * Simulate scheduling with capacity awareness
 */
export async function simulateQuoteSchedule(
    input: QuoteInput,
    existingJobs: Job[]
): Promise<QuoteEstimate> {
    const pointsCalc = calculateQuotePoints(input);
    const totalPoints = pointsCalc.totalPoints;

    // Calculate urgency score
    let urgencyScore = 0;
    if (input.isREF) urgencyScore += 10;
    if (totalPoints >= 50) urgencyScore += 10;

    const departments: Department[] = [
        'Engineering',
        'Laser',
        'Press Brake',
        'Welding',
        'Polishing',
        'Assembly',
    ];

    const timeline: DepartmentTimeline[] = [];
    let currentDate = new Date(input.engineeringReadyDate);

    // Overlapping timeline: next dept starts after ~20-25% of current dept completes
    // This reflects reality where items flow through as they're completed
    for (let i = 0; i < departments.length; i++) {
        const dept = departments[i];
        const duration = calculateDeptDuration(dept, totalPoints, 'FAB');
        const startDate = new Date(currentDate);
        const endDate = getEndDateForDuration(startDate, duration);

        timeline.push({
            department: dept,
            startDate,
            endDate,
            duration,
        });

        // Calculate overlap: next dept can start after ~25% of current dept
        // Minimum overlap of 1 day for small jobs, more for larger jobs
        const overlapDays = Math.max(1, Math.ceil(duration * 0.25));
        currentDate = addWorkDays(startDate, overlapDays);
    }

    const estimatedCompletion = timeline[timeline.length - 1]?.endDate || addDays(input.engineeringReadyDate, 30);

    return {
        totalPoints: pointsCalc.totalPoints,
        bigRockPoints: pointsCalc.bigRockPoints,
        remainingPoints: pointsCalc.remainingPoints,
        remainingValue: pointsCalc.remainingValue,
        remainingQuantity: Math.max(0, input.totalQuantity - input.bigRocks.length),
        estimatedCompletion,
        timeline,
        urgencyScore,
        isBigRock: pointsCalc.totalPoints >= 50,
    };
}

/**
 * Advanced feasibility check with capacity analysis
 */
export async function checkAdvancedFeasibility(
    input: QuoteInput,
    existingJobs: Job[]
): Promise<FeasibilityCheck> {
    const pointsCalc = calculateQuotePoints(input);
    const totalPoints = pointsCalc.totalPoints;
    const targetDate = input.targetDate;

    if (!targetDate) {
        throw new Error('Target date required for feasibility check');
    }

    const departments: Department[] = [
        'Engineering',
        'Laser',
        'Press Brake',
        'Welding',
        'Polishing',
        'Assembly',
    ];

    const gap = getDepartmentGap(totalPoints);

    // Build capacity maps
    const baseCapacityMap = buildCapacityMap(existingJobs);
    const jobBuffers = calculateJobBuffers(existingJobs);

    // Tier 1: As-Is Check
    let asIsDate = new Date(input.engineeringReadyDate);
    const asIsBottlenecks: string[] = [];

    for (const dept of departments) {
        const duration = calculateDeptDuration(dept, totalPoints, 'FAB');
        const slotStart = findAvailableSlot(dept, asIsDate, totalPoints, duration, baseCapacityMap, BASE_WEEKLY_CAPACITY);

        if (slotStart > asIsDate) {
            asIsBottlenecks.push(`${dept} delayed by ${differenceInDays(slotStart, asIsDate)} days`);
        }

        asIsDate = getEndDateForDuration(slotStart, duration);
        asIsDate = addWorkDays(asIsDate, Math.ceil(gap));
    }

    const asIsAchievable = asIsDate <= targetDate;

    // Tier 2: With Moves Check
    const jobsToMove: JobMovement[] = [];

    // Only consider jobs with future start dates and available buffer
    // Focus on Engineering and Laser - moving later depts doesn't help new jobs entering system
    const today = startOfDay(new Date());
    const movableDepts: Department[] = ['Engineering', 'Laser'];
    const MOVE_DAYS = 7; // How many workdays we propose to move jobs

    for (const job of existingJobs) {
        const buffer = jobBuffers.get(job.id);
        // Only consider jobs where buffer >= move days (ensures they won't miss due date)
        if (buffer && buffer >= MOVE_DAYS && job.departmentSchedule) {
            // Prefer earliest departments first
            for (const dept of movableDepts) {
                const schedule = (job.departmentSchedule as any)[dept];
                if (!schedule) continue;

                const scheduleStart = new Date(schedule.start);
                const proposedNewDate = addWorkDays(scheduleStart, MOVE_DAYS);
                const dueDate = new Date(job.dueDate);

                // Only include if: future date AND new date before due date
                if (scheduleStart > today && proposedNewDate < dueDate) {
                    jobsToMove.push({
                        jobId: job.id,
                        jobName: job.name,
                        department: dept,
                        originalDate: scheduleStart,
                        newDate: proposedNewDate,
                        dueDate: dueDate,
                        bufferDays: buffer,
                    });
                    break;
                }
            }
        }
    }

    // Calculate actual completion using overlapping timeline (same as displayed timeline)
    let timelineCompletion = new Date(input.engineeringReadyDate);
    for (let i = 0; i < departments.length; i++) {
        const dept = departments[i];
        const duration = calculateDeptDuration(dept, totalPoints, 'FAB');
        const startDate = new Date(timelineCompletion);
        const endDate = getEndDateForDuration(startDate, duration);

        // Last department's end date is the completion
        if (i === departments.length - 1) {
            timelineCompletion = endDate;
        } else {
            // Next dept starts after ~25% of current
            const overlapDays = Math.max(1, Math.ceil(duration * 0.25));
            timelineCompletion = addWorkDays(startDate, overlapDays);
        }
    }

    // If we can move jobs, we assume some capacity freed up - but completion is still timeline-based
    const withMovesAchievable = jobsToMove.length > 0 ? timelineCompletion <= targetDate : asIsAchievable;
    const withMovesCompletionDate = timelineCompletion;

    // Tier 3: With OT Check
    // OT means we work at 1000 pts/week instead of 850 pts/week
    // This effectively reduces the duration by the ratio (850/1000 = 85%)
    const OT_SPEED_FACTOR = BASE_WEEKLY_CAPACITY / OT_WEEKLY_CAPACITY; // 0.85

    let otDate = new Date(input.engineeringReadyDate);
    const otWeeks: string[] = [];
    let withOTAchievable = false;
    let otNeeded = false;

    if (asIsAchievable || withMovesAchievable) {
        // If Tier 1 or Tier 2 achieved it, no OT needed
        withOTAchievable = true;
        otNeeded = false;
    } else {
        // Calculate OT scenario - faster timeline due to higher capacity
        otNeeded = true;

        let otCurrentDate = new Date(input.engineeringReadyDate);
        for (let i = 0; i < departments.length; i++) {
            const dept = departments[i];
            const baseDuration = calculateDeptDuration(dept, totalPoints, 'FAB');
            // OT reduces duration (more work done per day)
            const otDuration = Math.ceil(baseDuration * OT_SPEED_FACTOR);

            const startDate = new Date(otCurrentDate);
            const endDate = getEndDateForDuration(startDate, otDuration);

            // Track which weeks need OT
            const weekKey = getWeekKey(startDate);
            if (!otWeeks.includes(weekKey)) {
                otWeeks.push(weekKey);
            }

            // Last department's end date is the completion
            if (i === departments.length - 1) {
                otDate = endDate;
            } else {
                // Next dept starts after ~25% of current
                const overlapDays = Math.max(1, Math.ceil(otDuration * 0.25));
                otCurrentDate = addWorkDays(startDate, overlapDays);
            }
        }

        withOTAchievable = otDate <= targetDate;
    }

    // Determine recommendation
    let recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE';
    let explanation: string;

    if (asIsAchievable) {
        recommendation = 'ACCEPT';
        explanation = `Can complete by ${format(asIsDate, 'MMM d, yyyy')} without any changes to existing schedule.`;
    } else if (withMovesAchievable) {
        recommendation = 'ACCEPT_WITH_MOVES';
        explanation = `Can complete by ${format(timelineCompletion, 'MMM d, yyyy')} by moving ${jobsToMove.length} job(s) with available buffer.`;
    } else if (withOTAchievable) {
        recommendation = 'ACCEPT_WITH_OT';
        explanation = `Can complete by ${format(otDate, 'MMM d, yyyy')} with overtime (15% faster).`;
    } else {
        recommendation = 'DECLINE';
        explanation = `Cannot meet target date of ${format(targetDate, 'MMM d, yyyy')} even with moves and OT.`;
    }

    return {
        asIs: {
            achievable: asIsAchievable,
            completionDate: asIsDate,
            bottlenecks: asIsBottlenecks,
        },
        withMoves: {
            achievable: withMovesAchievable,
            completionDate: withMovesCompletionDate,
            jobsToMove: jobsToMove.slice(0, 10), // Limit to first 10 for display
            totalJobsAffected: jobsToMove.length,
        },
        withOT: {
            achievable: withOTAchievable,
            completionDate: otNeeded ? otDate : null,
            otWeeks,
        },
        recommendation,
        explanation,
    };
}

/**
 * Simple feasibility check (backwards compatible)
 */
export function checkTargetFeasibility(
    estimate: QuoteEstimate,
    targetDate: Date
): { isAchievable: boolean; status: string; gapDays: number; earliestCompletion: Date; bottleneck?: string } {
    const completionTime = estimate.estimatedCompletion.getTime();
    const targetTime = targetDate.getTime();
    const gapMs = targetTime - completionTime;
    const gapDays = Math.round(gapMs / (1000 * 60 * 60 * 24));

    let status: 'ACHIEVABLE' | 'TIGHT' | 'NOT_POSSIBLE';
    let isAchievable = false;

    if (gapDays >= 5) {
        status = 'ACHIEVABLE';
        isAchievable = true;
    } else if (gapDays >= 0) {
        status = 'TIGHT';
        isAchievable = true;
    } else {
        status = 'NOT_POSSIBLE';
        isAchievable = false;
    }

    let bottleneck: string | undefined;
    if (!isAchievable && estimate.timeline.length > 0) {
        const longestDept = estimate.timeline.reduce(
            (max, curr) => (curr.duration > max.duration ? curr : max),
            estimate.timeline[0]
        );
        bottleneck = `${longestDept.department} (${longestDept.duration} days needed)`;
    }

    return {
        isAchievable,
        status,
        gapDays,
        earliestCompletion: estimate.estimatedCompletion,
        bottleneck,
    };
}
