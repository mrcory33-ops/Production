import { Department, ProductType, Job } from '@/types';
import { addDays, isWeekend, startOfWeek, format, differenceInDays, startOfDay } from 'date-fns';
import { calculateDeptDuration } from './departmentConfig';

// ─────────────────────────────────────────────────────────────
// Constants — aligned with scheduler.ts and SCHEDULING_ENGINE.md
// ─────────────────────────────────────────────────────────────

/** $650 in quoted fabrication value ≈ 1 welding point */
const DOLLAR_TO_POINT_RATIO = 650;

/** Standard weekly capacity per department */
const BASE_WEEKLY_CAPACITY = 850;

/**
 * OT Tiers — derived from real shop hours (21.25 pts/hr)
 * Base: 8hr/day × 5 days = 40hr/wk → 850 pts
 */
const OT_TIERS = [
    { tier: 1 as const, label: '9-Hour Days', bonusPoints: 106, weeklyCapacity: 956, weekdayHours: '6am–3pm', saturdayHours: 'N/A' },
    { tier: 2 as const, label: '10-Hour Days', bonusPoints: 213, weeklyCapacity: 1063, weekdayHours: '6am–4pm', saturdayHours: 'N/A' },
    { tier: 3 as const, label: '9hr + Saturday', bonusPoints: 234, weeklyCapacity: 1084, weekdayHours: '6am–3pm', saturdayHours: '6am–12pm' },
    { tier: 4 as const, label: '10hr + Saturday', bonusPoints: 341, weeklyCapacity: 1191, weekdayHours: '6am–4pm', saturdayHours: '6am–12pm' },
] as const;

/** Departments in pipeline order */
const DEPARTMENTS: Department[] = [
    'Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly',
];

/** Big Rock threshold — consistent with BIG_ROCK_CONFIG */
const BIG_ROCK_THRESHOLD = 70;

// ─────────────────────────────────────────────────────────────
// Public Types
// ─────────────────────────────────────────────────────────────

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
    productType?: ProductType; // NEW — defaults to 'FAB' if omitted
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
    /** Actual capacity used in each week by this dept */
    weeklyLoad?: Record<string, number>;
}

export interface JobMovement {
    jobId: string;
    jobName: string;
    department: Department;
    originalDate: Date;
    newDate: Date;
    dueDate: Date;
    bufferDays: number;
    pointsRelieved: number;
}

export interface OTWeekDetail {
    weekKey: string;
    department: Department;
    currentLoad: number;
    baseCapacity: number;
    excess: number;
    recommendedTier: 1 | 2 | 3 | 4;
    tierLabel: string;
    bonusPoints: number;
    covered: boolean;
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
        capacityFreed: number;
    };

    // Tier 3: With OT (now uses tiered system)
    withOT: {
        achievable: boolean;
        completionDate: Date | null;
        otWeeks: OTWeekDetail[];
        recommendedTier: 1 | 2 | 3 | 4 | null;
    };

    recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE';
    explanation: string;
}

// ─────────────────────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────────────────────

/** Convert dollar value to welding points */
export function convertDollarToPoints(dollarValue: number): number {
    return Math.round((dollarValue / DOLLAR_TO_POINT_RATIO) * 10) / 10;
}

/** Calculate total points from quote inputs */
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

// ─────────────────────────────────────────────────────────────
// Date Utilities
// ─────────────────────────────────────────────────────────────

/** Advance by N workdays (skip weekends) */
function addWorkDays(startDate: Date, days: number): Date {
    let current = new Date(startDate);
    let remaining = Math.ceil(days);
    // Handle fractional days: round up to nearest half-day boundary
    if (remaining <= 0) return current;

    while (remaining > 0) {
        current = addDays(current, 1);
        if (!isWeekend(current)) {
            remaining--;
        }
    }

    return current;
}

/** Count workdays between two dates (inclusive) */
function countWorkdaysBetween(startDate: Date, endDate: Date): number {
    let current = startOfDay(startDate);
    const end = startOfDay(endDate);
    let count = 0;

    while (current <= end) {
        if (!isWeekend(current)) count++;
        current = addDays(current, 1);
    }

    return count;
}

/** Get ISO week key for capacity tracking (Monday-based) */
function getWeekKey(date: Date): string {
    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
    return format(weekStart, 'yyyy-MM-dd');
}

/** Calculate end date from start + duration in workdays */
function getEndDateForDuration(startDate: Date, duration: number): Date {
    const daySpan = Math.max(0, Math.ceil(duration) - 1);
    return addWorkDays(startDate, daySpan);
}

/** Department gap based on job size — matches scheduler constants */
function getDepartmentGap(points: number): number {
    if (points >= BIG_ROCK_THRESHOLD) return 1;    // Big Rock: 1 day gap
    if (points >= 8) return 0.5;                    // Medium: half-day gap
    return 0;                                       // Small: no gap
}

/**
 * Distribute a dept's DAILY capacity contribution across weeks
 * Uses the dept's actual duration, not raw welding points
 */
function distributeLoadByWorkday(
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
            const wk = getWeekKey(current);
            distribution.set(wk, (distribution.get(wk) || 0) + pointsPerDay);
        }
        current = addDays(current, 1);
    }

    return distribution;
}

// ─────────────────────────────────────────────────────────────
// Capacity Map — uses dept-level load, not raw welding points
// ─────────────────────────────────────────────────────────────

type CapacityMap = Map<string, Map<Department, number>>;

/**
 * Build capacity usage map from existing jobs.
 * For each department, distributes the job's WELDING POINTS
 * proportionally across the workdays that dept occupies.
 *
 * This gives an accurate per-week load per department.
 */
function buildCapacityMap(existingJobs: Job[]): CapacityMap {
    const capacityMap: CapacityMap = new Map();

    for (const job of existingJobs) {
        if (!job.departmentSchedule) continue;
        const points = Number(job.weldingPoints) || 0;
        if (points <= 0) continue;

        for (const [deptKey, schedule] of Object.entries(job.departmentSchedule)) {
            const dept = deptKey as Department;
            const startDate = new Date(schedule.start);
            const endDate = new Date(schedule.end);

            // Each department contributes the full welding points to its capacity bucket
            // (this is how the scheduler's computeWeeklyLoad works)
            const weekDist = distributeLoadByWorkday(startDate, endDate, points);
            for (const [weekKey, weekPoints] of weekDist.entries()) {
                if (!capacityMap.has(weekKey)) {
                    capacityMap.set(weekKey, new Map());
                }
                const weekMap = capacityMap.get(weekKey)!;
                weekMap.set(dept, (weekMap.get(dept) || 0) + weekPoints);
            }
        }
    }

    return capacityMap;
}

/**
 * Find the first workday where a job's dept-load fits under the weekly capacity.
 * Slides day-by-day until it finds a window where every week the job spans
 * has room.
 */
function findAvailableSlot(
    dept: Department,
    startDate: Date,
    points: number,
    duration: number,
    capacityMap: CapacityMap,
    weeklyCapacity: number
): Date {
    let current = startOfDay(startDate);
    while (isWeekend(current)) current = addDays(current, 1);

    const maxAttempts = 140; // ~28 weeks

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const endDate = getEndDateForDuration(current, duration);
        const distribution = distributeLoadByWorkday(current, endDate, points);

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

        // Slide to next workday
        current = addDays(current, 1);
        while (isWeekend(current)) current = addDays(current, 1);
    }

    // Fallback: return original date
    return startDate;
}

// ─────────────────────────────────────────────────────────────
// Job Buffer Calculation
// ─────────────────────────────────────────────────────────────

/** For each existing job, calculate how many days of buffer it has (due - scheduled end) */
function calculateJobBuffers(existingJobs: Job[]): Map<string, { bufferDays: number; points: number }> {
    const buffers = new Map<string, { bufferDays: number; points: number }>();

    for (const job of existingJobs) {
        if (!job.departmentSchedule || !job.dueDate) continue;

        let latestEnd: Date | null = null;
        for (const schedule of Object.values(job.departmentSchedule)) {
            const endDate = new Date(schedule.end);
            if (!latestEnd || endDate > latestEnd) latestEnd = endDate;
        }

        if (latestEnd) {
            const dueDate = new Date(job.dueDate);
            const bufferDays = differenceInDays(dueDate, latestEnd);
            buffers.set(job.id, {
                bufferDays,
                points: Number(job.weldingPoints) || 0,
            });
        }
    }

    return buffers;
}

// ─────────────────────────────────────────────────────────────
// Sequential Timeline Simulation
// ─────────────────────────────────────────────────────────────

/**
 * Simulate scheduling a new quote through the 6-dept pipeline.
 *
 * IMPORTANT: Uses SEQUENTIAL scheduling (each dept completes before
 * the next starts, plus department gap). This matches the actual
 * scheduler behavior. The old overlapping (25%) timeline was
 * misleadingly optimistic.
 */
export async function simulateQuoteSchedule(
    input: QuoteInput,
    existingJobs: Job[]
): Promise<QuoteEstimate> {
    const pointsCalc = calculateQuotePoints(input);
    const totalPoints = pointsCalc.totalPoints;
    const productType: ProductType = input.productType || 'FAB';
    const gap = getDepartmentGap(totalPoints);

    // Build capacity map from existing scheduled jobs
    const capacityMap = buildCapacityMap(existingJobs);

    // Calculate urgency score
    let urgencyScore = 0;
    if (input.isREF) urgencyScore += 10;
    if (totalPoints >= BIG_ROCK_THRESHOLD) urgencyScore += 10;

    const timeline: DepartmentTimeline[] = [];
    let currentDate = new Date(input.engineeringReadyDate);

    // Sequential scheduling: each dept finds its first available slot,
    // then the next dept starts after this one ends + gap
    for (let i = 0; i < DEPARTMENTS.length; i++) {
        const dept = DEPARTMENTS[i];
        const duration = calculateDeptDuration(dept, totalPoints, productType);

        // Find earliest slot where this dept has capacity
        const slotStart = findAvailableSlot(
            dept, currentDate, totalPoints, duration, capacityMap, BASE_WEEKLY_CAPACITY
        );
        const endDate = getEndDateForDuration(slotStart, duration);

        // Record weekly load for this dept leg
        const weeklyLoad: Record<string, number> = {};
        const dist = distributeLoadByWorkday(slotStart, endDate, totalPoints);
        for (const [wk, pts] of dist.entries()) weeklyLoad[wk] = Math.round(pts);

        timeline.push({
            department: dept,
            startDate: slotStart,
            endDate,
            duration,
            weeklyLoad,
        });

        // "Reserve" this job's load in the capacity map for subsequent depts
        for (const [wk, pts] of dist.entries()) {
            if (!capacityMap.has(wk)) capacityMap.set(wk, new Map());
            const weekMap = capacityMap.get(wk)!;
            weekMap.set(dept, (weekMap.get(dept) || 0) + pts);
        }

        // Next dept starts after this dept ends + gap (sequential, not overlapping)
        currentDate = addWorkDays(endDate, Math.ceil(gap));
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
        isBigRock: pointsCalc.totalPoints >= BIG_ROCK_THRESHOLD,
    };
}

// ─────────────────────────────────────────────────────────────
// Advanced Feasibility Check — 3 Tiers
// ─────────────────────────────────────────────────────────────

export async function checkAdvancedFeasibility(
    input: QuoteInput,
    existingJobs: Job[]
): Promise<FeasibilityCheck> {
    const pointsCalc = calculateQuotePoints(input);
    const totalPoints = pointsCalc.totalPoints;
    const productType: ProductType = input.productType || 'FAB';
    const targetDate = input.targetDate;
    if (!targetDate) throw new Error('Target date required for feasibility check');

    const gap = getDepartmentGap(totalPoints);

    // ═══════════════════════════════════════════════════════════
    // TIER 1: AS-IS — can the new job fit without changes?
    // ═══════════════════════════════════════════════════════════

    const baseCapacityMap = buildCapacityMap(existingJobs);
    let asIsDate = new Date(input.engineeringReadyDate);
    const asIsBottlenecks: string[] = [];

    for (const dept of DEPARTMENTS) {
        const duration = calculateDeptDuration(dept, totalPoints, productType);
        const slotStart = findAvailableSlot(dept, asIsDate, totalPoints, duration, baseCapacityMap, BASE_WEEKLY_CAPACITY);

        if (slotStart > asIsDate) {
            const delayDays = differenceInDays(slotStart, asIsDate);
            asIsBottlenecks.push(`${dept} delayed by ${delayDays} days (capacity full)`);
        }

        const endDate = getEndDateForDuration(slotStart, duration);
        asIsDate = addWorkDays(endDate, Math.ceil(gap));
    }

    // asIsDate is now the projected completion under Tier 1
    const asIsCompletion = asIsDate;
    const asIsAchievable = asIsCompletion <= targetDate;

    // ═══════════════════════════════════════════════════════════
    // TIER 2: WITH MOVES — free up capacity by pushing buffer jobs
    // ═══════════════════════════════════════════════════════════

    const jobBuffers = calculateJobBuffers(existingJobs);
    const today = startOfDay(new Date());
    const MOVE_DAYS = 7; // 1 week push
    const movableDepts: Department[] = ['Engineering', 'Laser'];

    // Find jobs that can be safely pushed
    const jobsToMove: JobMovement[] = [];
    let totalCapacityFreed = 0;

    for (const job of existingJobs) {
        const bufferInfo = jobBuffers.get(job.id);
        if (!bufferInfo || bufferInfo.bufferDays < MOVE_DAYS || !job.departmentSchedule) continue;

        for (const dept of movableDepts) {
            const schedule = (job.departmentSchedule as Record<string, { start: string; end: string }>)[dept];
            if (!schedule) continue;

            const scheduleStart = new Date(schedule.start);
            const proposedNewDate = addWorkDays(scheduleStart, MOVE_DAYS);
            const dueDate = new Date(job.dueDate);

            // Must be in the future and new date must still be before due date
            if (scheduleStart > today && proposedNewDate < dueDate) {
                jobsToMove.push({
                    jobId: job.id,
                    jobName: job.name,
                    department: dept,
                    originalDate: scheduleStart,
                    newDate: proposedNewDate,
                    dueDate,
                    bufferDays: bufferInfo.bufferDays,
                    pointsRelieved: bufferInfo.points,
                });
                totalCapacityFreed += bufferInfo.points;
                break; // One move per job
            }
        }
    }

    // Build capacity map WITH moves applied (simulate the freed capacity)
    let withMovesCompletion = asIsCompletion;
    let withMovesAchievable = asIsAchievable;

    if (jobsToMove.length > 0 && !asIsAchievable) {
        // Clone the capacity map and reduce load for moved jobs
        const movedCapacityMap: CapacityMap = new Map();
        for (const [wk, deptMap] of baseCapacityMap.entries()) {
            movedCapacityMap.set(wk, new Map(deptMap));
        }

        // Remove moved jobs' load from their original weeks
        for (const move of jobsToMove) {
            const job = existingJobs.find(j => j.id === move.jobId);
            if (!job?.departmentSchedule) continue;

            const schedule = (job.departmentSchedule as Record<string, { start: string; end: string }>)[move.department];
            if (!schedule) continue;

            const startDate = new Date(schedule.start);
            const endDate = new Date(schedule.end);
            const points = Number(job.weldingPoints) || 0;
            const dist = distributeLoadByWorkday(startDate, endDate, points);

            for (const [wk, pts] of dist.entries()) {
                const weekMap = movedCapacityMap.get(wk);
                if (weekMap) {
                    const current = weekMap.get(move.department) || 0;
                    weekMap.set(move.department, Math.max(0, current - pts));
                }
            }
        }

        // Re-simulate with freed capacity
        let moveDate = new Date(input.engineeringReadyDate);
        for (const dept of DEPARTMENTS) {
            const duration = calculateDeptDuration(dept, totalPoints, productType);
            const slotStart = findAvailableSlot(dept, moveDate, totalPoints, duration, movedCapacityMap, BASE_WEEKLY_CAPACITY);
            const endDate = getEndDateForDuration(slotStart, duration);
            moveDate = addWorkDays(endDate, Math.ceil(gap));
        }

        withMovesCompletion = moveDate;
        withMovesAchievable = withMovesCompletion <= targetDate;
    }

    // ═══════════════════════════════════════════════════════════
    // TIER 3: WITH OT — use increased weekly capacity
    // ═══════════════════════════════════════════════════════════

    let withOTAchievable = false;
    let otCompletion: Date | null = null;
    const otWeekDetails: OTWeekDetail[] = [];
    let bestOTTier: 1 | 2 | 3 | 4 | null = null;

    if (!asIsAchievable && !withMovesAchievable) {
        // Try each OT tier from lowest to highest until one works
        for (const otTier of OT_TIERS) {
            let otDate = new Date(input.engineeringReadyDate);
            const otCapacityMap = buildCapacityMap(existingJobs);

            // Apply moves first if any
            if (jobsToMove.length > 0) {
                for (const move of jobsToMove) {
                    const job = existingJobs.find(j => j.id === move.jobId);
                    if (!job?.departmentSchedule) continue;
                    const schedule = (job.departmentSchedule as Record<string, { start: string; end: string }>)[move.department];
                    if (!schedule) continue;

                    const startDate = new Date(schedule.start);
                    const endDate = new Date(schedule.end);
                    const points = Number(job.weldingPoints) || 0;
                    const dist = distributeLoadByWorkday(startDate, endDate, points);

                    for (const [wk, pts] of dist.entries()) {
                        const weekMap = otCapacityMap.get(wk);
                        if (weekMap) {
                            const current = weekMap.get(move.department) || 0;
                            weekMap.set(move.department, Math.max(0, current - pts));
                        }
                    }
                }
            }

            // Simulate with OT capacity
            for (const dept of DEPARTMENTS) {
                const duration = calculateDeptDuration(dept, totalPoints, productType);
                const slotStart = findAvailableSlot(
                    dept, otDate, totalPoints, duration, otCapacityMap, otTier.weeklyCapacity
                );
                const endDate = getEndDateForDuration(slotStart, duration);

                // Reserve capacity
                const dist = distributeLoadByWorkday(slotStart, endDate, totalPoints);
                for (const [wk, pts] of dist.entries()) {
                    if (!otCapacityMap.has(wk)) otCapacityMap.set(wk, new Map());
                    const weekMap = otCapacityMap.get(wk)!;
                    weekMap.set(dept, (weekMap.get(dept) || 0) + pts);
                }

                otDate = addWorkDays(endDate, Math.ceil(gap));
            }

            if (otDate <= targetDate) {
                withOTAchievable = true;
                otCompletion = otDate;
                bestOTTier = otTier.tier;

                // Build OT week breakdown for this tier
                // Identify which weeks actually needed OT (exceeded base 850)
                for (const [wk, deptMap] of otCapacityMap.entries()) {
                    for (const [dept, load] of deptMap.entries()) {
                        if (load > BASE_WEEKLY_CAPACITY) {
                            const excess = Math.round(load - BASE_WEEKLY_CAPACITY);
                            otWeekDetails.push({
                                weekKey: wk,
                                department: dept as Department,
                                currentLoad: Math.round(load),
                                baseCapacity: BASE_WEEKLY_CAPACITY,
                                excess,
                                recommendedTier: otTier.tier,
                                tierLabel: otTier.label,
                                bonusPoints: otTier.bonusPoints,
                                covered: excess <= otTier.bonusPoints,
                            });
                        }
                    }
                }
                break; // Found the lowest tier that works
            }
        }

        // If no tier works, try Tier 4 anyway to show the best possible
        if (!withOTAchievable) {
            const maxTier = OT_TIERS[OT_TIERS.length - 1];
            let otDate = new Date(input.engineeringReadyDate);
            const otCapacityMap = buildCapacityMap(existingJobs);

            for (const dept of DEPARTMENTS) {
                const duration = calculateDeptDuration(dept, totalPoints, productType);
                const slotStart = findAvailableSlot(
                    dept, otDate, totalPoints, duration, otCapacityMap, maxTier.weeklyCapacity
                );
                const endDate = getEndDateForDuration(slotStart, duration);
                otDate = addWorkDays(endDate, Math.ceil(gap));
            }

            otCompletion = otDate;
            bestOTTier = 4;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Determine Recommendation
    // ═══════════════════════════════════════════════════════════

    let recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE';
    let explanation: string;

    if (asIsAchievable) {
        recommendation = 'ACCEPT';
        explanation = `Can complete by ${format(asIsCompletion, 'MMM d, yyyy')} without any changes to the existing schedule. No overtime required.`;
    } else if (withMovesAchievable) {
        recommendation = 'ACCEPT_WITH_MOVES';
        explanation = `Can complete by ${format(withMovesCompletion, 'MMM d, yyyy')} by shifting ${jobsToMove.length} existing job(s) that have buffer. No overtime needed — simply reschedule ${jobsToMove.length} job(s) with available slack.`;
    } else if (withOTAchievable && otCompletion) {
        const tierInfo = OT_TIERS.find(t => t.tier === bestOTTier)!;
        recommendation = 'ACCEPT_WITH_OT';
        explanation = `Can complete by ${format(otCompletion, 'MMM d, yyyy')} with ${tierInfo.label} overtime (${tierInfo.weekdayHours}${tierInfo.saturdayHours !== 'N/A' ? ` + Sat ${tierInfo.saturdayHours}` : ''}). adds +${tierInfo.bonusPoints}pts/week capacity.`;
    } else {
        recommendation = 'DECLINE';
        const bestDate = otCompletion ? format(otCompletion, 'MMM d, yyyy') : 'unknown';
        explanation = `Cannot meet target date of ${format(targetDate, 'MMM d, yyyy')} even with job moves and max overtime (Tier 4). Earliest possible: ${bestDate}.`;
    }

    return {
        asIs: {
            achievable: asIsAchievable,
            completionDate: asIsCompletion,
            bottlenecks: asIsBottlenecks,
        },
        withMoves: {
            achievable: withMovesAchievable,
            completionDate: withMovesCompletion,
            jobsToMove: jobsToMove.slice(0, 10),
            totalJobsAffected: jobsToMove.length,
            capacityFreed: totalCapacityFreed,
        },
        withOT: {
            achievable: withOTAchievable,
            completionDate: otCompletion,
            otWeeks: otWeekDetails,
            recommendedTier: bestOTTier,
        },
        recommendation,
        explanation,
    };
}

// ─────────────────────────────────────────────────────────────
// Simple Feasibility Check (backwards-compatible)
// ─────────────────────────────────────────────────────────────

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
