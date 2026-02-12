import { Department, ProductType, Job } from '@/types';
import { addDays, isWeekend, startOfWeek, format, differenceInDays, startOfDay } from 'date-fns';
import { calculateDeptDuration, DEPARTMENT_CONFIG } from './departmentConfig';

// ─────────────────────────────────────────────────────────────
// Constants — aligned with scheduler.ts and SCHEDULING_ENGINE.md
// ─────────────────────────────────────────────────────────────

/** $650 in quoted fabrication value ≈ 1 welding point (FAB/HARMONIC) */
const DOLLAR_TO_POINT_RATIO = 650;

/** $475 in quoted door/frame value ≈ 1 welding point (DOORS) */
const DOORS_DOLLAR_TO_POINT_RATIO = 475;

/** Standard weekly capacity per department (fallback) */
const BASE_WEEKLY_CAPACITY = 850;

/** Department-specific weekly capacities derived from DEPARTMENT_CONFIG */
const DEPT_WEEKLY_CAPACITY: Record<Department, number> = Object.fromEntries(
    Object.entries(DEPARTMENT_CONFIG).map(([dept, config]) => [
        dept,
        config.dailyCapacity * 5  // 5-day work week
    ])
) as Record<Department, number>;

/** Get the weekly capacity for a department, with optional OT bonus */
function getDeptWeeklyCapacity(dept: Department, otBonus = 0): number {
    return (DEPT_WEEKLY_CAPACITY[dept] || BASE_WEEKLY_CAPACITY) + otBonus;
}

/**
 * Get the weekly capacity for only the worker pool(s) that handle a given product type.
 * Uses explicit `weeklyCapacity` when set on a pool (authoritative scheduling number),
 * otherwise falls back to count × outputPerDay × 5.
 * Falls back to full department capacity if no pool segmentation exists.
 */
function getPoolWeeklyCapacity(dept: Department, productType: ProductType, otBonus = 0): number {
    const config = DEPARTMENT_CONFIG[dept];
    if (!config) return BASE_WEEKLY_CAPACITY + otBonus;

    // Find pools that serve this product type
    const matchingPools = config.pools.filter(pool =>
        !pool.productTypes || pool.productTypes.length === 0 || pool.productTypes.includes(productType)
    );

    if (matchingPools.length === 0) {
        // No matching pools — fall back to full dept capacity
        return config.dailyCapacity * 5 + otBonus;
    }

    // Use explicit weeklyCapacity when set, otherwise compute from workers
    const weeklyCap = matchingPools.reduce((sum, pool) =>
        sum + (pool.weeklyCapacity ?? pool.count * pool.outputPerDay * 5), 0
    );
    return weeklyCap + otBonus;
}

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
const BIG_ROCK_THRESHOLD = 60;

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
    productType?: ProductType; // defaults to 'FAB' if omitted
    // DOORS-specific inputs
    doorQty?: number;          // Number of doors in the order
    frameQty?: number;         // Number of frames in the order
    doorType?: 'seamless' | 'lockseam'; // Door press type
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
    /** Pipelined earliest start before capacity check */
    earliestDate?: Date;
    /** Days delayed due to capacity constraints */
    capacityDelayDays?: number;
    /** Weekly capacity used for this department */
    weeklyCapacity?: number;
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

export interface BottleneckDetail {
    department: Department;
    delayDays: number;
    firstAvailableDate: Date;
}

export interface FeasibilityCheck {
    // Tier 1: As-Is
    asIs: {
        achievable: boolean;
        completionDate: Date | null;
        bottlenecks: BottleneckDetail[];
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
        overCapacityDepts: { department: string; weekKey: string; load: number; capacity: number }[];
    };

    recommendation: 'ACCEPT' | 'ACCEPT_WITH_MOVES' | 'ACCEPT_WITH_OT' | 'DECLINE';
    explanation: string;
}

// ─────────────────────────────────────────────────────────────
// Core Helpers
// ─────────────────────────────────────────────────────────────

/** Convert dollar value to welding points (product-type aware) */
export function convertDollarToPoints(dollarValue: number, productType?: ProductType): number {
    const ratio = productType === 'DOORS' ? DOORS_DOLLAR_TO_POINT_RATIO : DOLLAR_TO_POINT_RATIO;
    return Math.round((dollarValue / ratio) * 10) / 10;
}

/** Calculate total points from quote inputs */
export function calculateQuotePoints(input: QuoteInput): {
    totalPoints: number;
    bigRockPoints: number;
    remainingPoints: number;
    remainingValue: number;
} {
    const totalValue = Math.max(0, input.totalValue || 0);
    const pt = input.productType;

    const bigRockPoints = input.bigRocks.reduce((sum, br) => {
        const value = Number(br.value) || 0;
        return sum + convertDollarToPoints(value, pt);
    }, 0);

    const bigRockValue = input.bigRocks.reduce((sum, br) => sum + (Number(br.value) || 0), 0);
    const remainingValue = Math.max(0, totalValue - bigRockValue);
    const remainingPoints = convertDollarToPoints(remainingValue, pt);

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
 * Pipeline overlap fraction — the next department can start after this
 * percentage of the previous department's duration is complete.
 * 0.3 = 30% → if Engineering takes 10 days, Laser can start on day 4.
 */
const PIPELINE_OVERLAP = 0.30;

/**
 * Calculate when the next department can start, accounting for pipelining.
 * Instead of waiting for 100% completion, the next dept starts after
 * PIPELINE_OVERLAP of the previous dept's duration + the inter-dept gap.
 */
function getPipelinedNextStart(
    prevStart: Date,
    prevDuration: number,
    gap: number
): Date {
    const overlapDays = Math.max(1, Math.ceil(prevDuration * PIPELINE_OVERLAP));
    const pipelinedDate = addWorkDays(prevStart, overlapDays + Math.ceil(gap) - 1);
    return pipelinedDate;
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

function cloneCapacityMap(capacityMap: CapacityMap): CapacityMap {
    const clone: CapacityMap = new Map();
    for (const [weekKey, deptMap] of capacityMap.entries()) {
        clone.set(weekKey, new Map(deptMap));
    }
    return clone;
}

/**
 * Build capacity usage map from existing jobs.
 * For each department, distributes the job's WELDING POINTS
 * proportionally across the workdays that dept occupies.
 *
 * When a productType filter is provided, only jobs of that same
 * product type contribute to the capacity map. This prevents FAB
 * welding load from blocking DOORS jobs (separate worker pools).
 */
function buildCapacityMap(existingJobs: Job[], productTypeFilter?: ProductType): CapacityMap {
    const capacityMap: CapacityMap = new Map();

    for (const job of existingJobs) {
        if (!job.departmentSchedule) continue;
        const points = Number(job.weldingPoints) || 0;
        if (points <= 0) continue;

        const jobMismatchesFilter = productTypeFilter && job.productType && job.productType !== productTypeFilter;

        for (const [deptKey, schedule] of Object.entries(job.departmentSchedule)) {
            const dept = deptKey as Department;

            // Only filter by product type for departments that have
            // product-type-specific pools (Engineering, Welding).
            // Shared departments (Laser, Press Brake, Polishing, Assembly)
            // count ALL jobs toward capacity regardless of product type.
            if (jobMismatchesFilter) {
                const config = DEPARTMENT_CONFIG[dept];
                const hasProductTypePools = config?.pools.some(p => p.productTypes && p.productTypes.length > 0);
                if (hasProductTypePools) continue;
            }

            const startDate = new Date(schedule.start);
            const endDate = new Date(schedule.end);

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

function applyMovesToCapacityMap(
    baseCapacityMap: CapacityMap,
    jobsToMove: JobMovement[],
    existingJobsById: Map<string, Job>
): CapacityMap {
    const movedCapacityMap = cloneCapacityMap(baseCapacityMap);

    for (const move of jobsToMove) {
        const job = existingJobsById.get(move.jobId);
        if (!job?.departmentSchedule) continue;

        const schedule = (job.departmentSchedule as Record<string, { start: string; end: string }>)[move.department];
        if (!schedule) continue;

        const startDate = new Date(schedule.start);
        const endDate = new Date(schedule.end);
        const points = Number(job.weldingPoints) || 0;
        const dist = distributeLoadByWorkday(startDate, endDate, points);

        for (const [wk, pts] of dist.entries()) {
            const weekMap = movedCapacityMap.get(wk);
            if (!weekMap) continue;
            const current = weekMap.get(move.department) || 0;
            weekMap.set(move.department, Math.max(0, current - pts));
        }
    }

    return movedCapacityMap;
}

// ─────────────────────────────────────────────────────────────
// Sequential Timeline Simulation
// ─────────────────────────────────────────────────────────────

/**
 * Simulate scheduling a new quote through the 6-dept pipeline.
 *
 * Uses PIPELINED scheduling — each dept starts after 30% of the
 * previous dept's duration is complete, plus department gap.
 * This models real shop-floor handoffs where partial batches
 * move to the next station before the full order is done.
 */
export async function simulateQuoteSchedule(
    input: QuoteInput,
    existingJobs: Job[]
): Promise<QuoteEstimate> {
    const pointsCalc = calculateQuotePoints(input);
    const totalPoints = pointsCalc.totalPoints;
    const productType: ProductType = input.productType || 'FAB';
    const gap = getDepartmentGap(totalPoints);

    // Build capacity map — filter by product type so DOORS/FAB don't compete
    const capacityMap = buildCapacityMap(existingJobs, productType);

    // DOORS-specific: build description + quantity for sub-pipeline
    const doorQty = input.doorQty || 0;
    const frameQty = input.frameQty || 0;
    const totalQty = doorQty + frameQty;
    // Build synthetic description for door type classification
    // e.g. "door seamless" or "door lock seam" for leaf classification
    // Frames: "frame" only (no sub-type needed)
    let doorsDescription = '';
    if (productType === 'DOORS') {
        const parts: string[] = [];
        if (doorQty > 0) parts.push(input.doorType === 'lockseam' ? 'door lock seam' : 'door seamless');
        if (frameQty > 0) parts.push('frame');
        doorsDescription = parts.join(' ');
    }

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
        const duration = calculateDeptDuration(
            dept, totalPoints, productType,
            doorsDescription || undefined,  // description for door classification
            undefined,                       // jobName
            undefined,                       // requiresPainting
            undefined,                       // customerName
            undefined,                       // batchSize
            totalQty > 0 ? totalQty : undefined // quantity for door sub-pipeline
        );

        // Find earliest slot where this dept has capacity
        // Use pool-specific capacity (e.g. 420/wk DOORS Welding, not 910/wk combined)
        const slotStart = findAvailableSlot(
            dept, currentDate, totalPoints, duration, capacityMap, getPoolWeeklyCapacity(dept, productType)
        );
        const endDate = getEndDateForDuration(slotStart, duration);



        // Record weekly load for this dept leg
        const weeklyLoad: Record<string, number> = {};
        const dist = distributeLoadByWorkday(slotStart, endDate, totalPoints);
        for (const [wk, pts] of dist.entries()) weeklyLoad[wk] = Math.round(pts);

        const capacityDelayDays = slotStart > currentDate
            ? differenceInDays(slotStart, currentDate)
            : 0;

        timeline.push({
            department: dept,
            startDate: slotStart,
            endDate,
            duration,
            weeklyLoad,
            earliestDate: new Date(currentDate),
            capacityDelayDays,
            weeklyCapacity: getDeptWeeklyCapacity(dept),
        });

        // "Reserve" this job's load in the capacity map for subsequent depts
        for (const [wk, pts] of dist.entries()) {
            if (!capacityMap.has(wk)) capacityMap.set(wk, new Map());
            const weekMap = capacityMap.get(wk)!;
            weekMap.set(dept, (weekMap.get(dept) || 0) + pts);
        }

        // Next dept starts after 30% of this dept's duration + gap (pipelined)
        currentDate = getPipelinedNextStart(slotStart, duration, gap);

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

    // DOORS-specific: build description + quantity for sub-pipeline (same as simulateQuoteSchedule)
    const doorQty = input.doorQty || 0;
    const frameQty = input.frameQty || 0;
    const feasTotalQty = doorQty + frameQty;
    let feasDescription = '';
    if (productType === 'DOORS') {
        const parts: string[] = [];
        if (doorQty > 0) parts.push(input.doorType === 'lockseam' ? 'door lock seam' : 'door seamless');
        if (frameQty > 0) parts.push('frame');
        feasDescription = parts.join(' ');
    }
    const feasQty = feasTotalQty > 0 ? feasTotalQty : undefined;
    const feasDesc = feasDescription || undefined;

    // ═══════════════════════════════════════════════════════════
    // TIER 1: AS-IS — can the new job fit without changes?
    // ═══════════════════════════════════════════════════════════

    const baseCapacityMap = buildCapacityMap(existingJobs, productType);
    const existingJobsById = new Map<string, Job>();
    for (const job of existingJobs) existingJobsById.set(job.id, job);
    let asIsDate = new Date(input.engineeringReadyDate);
    let lastDeptEndDate = new Date(input.engineeringReadyDate);
    const asIsBottlenecks: BottleneckDetail[] = [];

    for (const dept of DEPARTMENTS) {
        const duration = calculateDeptDuration(dept, totalPoints, productType, feasDesc, undefined, undefined, undefined, undefined, feasQty);
        const slotStart = findAvailableSlot(dept, asIsDate, totalPoints, duration, baseCapacityMap, getPoolWeeklyCapacity(dept, productType));

        if (slotStart > asIsDate) {
            const delayDays = differenceInDays(slotStart, asIsDate);
            asIsBottlenecks.push({ department: dept, delayDays, firstAvailableDate: slotStart });
        }

        const endDate = getEndDateForDuration(slotStart, duration);
        lastDeptEndDate = endDate; // Track actual end of last department
        asIsDate = getPipelinedNextStart(slotStart, duration, gap);
    }

    // Use the actual end date of the last department (Assembly), not the pipelined cursor
    const asIsCompletion = lastDeptEndDate;
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

    const capacityMapAfterMoves = jobsToMove.length > 0
        ? applyMovesToCapacityMap(baseCapacityMap, jobsToMove, existingJobsById)
        : baseCapacityMap;

    // Build capacity map WITH moves applied (simulate the freed capacity)
    let withMovesCompletion = asIsCompletion;
    let withMovesAchievable = asIsAchievable;

    if (jobsToMove.length > 0 && !asIsAchievable) {
        // Re-simulate with freed capacity
        let moveDate = new Date(input.engineeringReadyDate);
        let moveLastEnd = new Date(input.engineeringReadyDate);
        for (const dept of DEPARTMENTS) {
            const duration = calculateDeptDuration(dept, totalPoints, productType, feasDesc, undefined, undefined, undefined, undefined, feasQty);
            const slotStart = findAvailableSlot(dept, moveDate, totalPoints, duration, capacityMapAfterMoves, getPoolWeeklyCapacity(dept, productType));
            const endDate = getEndDateForDuration(slotStart, duration);
            moveLastEnd = endDate;
            moveDate = getPipelinedNextStart(slotStart, duration, gap);
        }

        withMovesCompletion = moveLastEnd;
        withMovesAchievable = withMovesCompletion <= targetDate;
    }

    // ═══════════════════════════════════════════════════════════
    // TIER 3: WITH OT — use increased weekly capacity
    // Only offer OT if no department is already OVER capacity.
    // If departments are overloaded, OT won't help — the problem
    // is structural (too many jobs), not a lack of extra hours.
    // ═══════════════════════════════════════════════════════════

    let withOTAchievable = false;
    let otCompletion: Date | null = null;
    const otWeekDetails: OTWeekDetail[] = [];
    let bestOTTier: 1 | 2 | 3 | 4 | null = null;
    const otBaseCapacityMap = jobsToMove.length > 0 ? capacityMapAfterMoves : baseCapacityMap;

    // Pre-check: are any departments already OVER their base capacity
    // in weeks between today and the target date?
    const overCapacityDepts: { department: string; weekKey: string; load: number; capacity: number }[] = [];
    const todayStr = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const targetStr = format(startOfWeek(targetDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    for (const [wk, deptMap] of otBaseCapacityMap.entries()) {
        // Only check weeks in the relevant window (today → target)
        if (wk < todayStr || wk > targetStr) continue;

        for (const [dept, load] of deptMap.entries()) {
            const cap = getPoolWeeklyCapacity(dept as Department, productType);
            if (load > cap) {
                overCapacityDepts.push({
                    department: dept,
                    weekKey: wk,
                    load: Math.round(load),
                    capacity: cap,
                });
            }
        }
    }

    const deptsAlreadyOverloaded = overCapacityDepts.length > 0;

    if (!asIsAchievable && !withMovesAchievable && !deptsAlreadyOverloaded) {
        // Try each OT tier from lowest to highest until one works
        for (const otTier of OT_TIERS) {
            let otDate = new Date(input.engineeringReadyDate);
            let otLastEnd = new Date(input.engineeringReadyDate);
            const otCapacityMap = cloneCapacityMap(otBaseCapacityMap);

            // Simulate with OT capacity
            for (const dept of DEPARTMENTS) {
                const duration = calculateDeptDuration(dept, totalPoints, productType, feasDesc, undefined, undefined, undefined, undefined, feasQty);
                const slotStart = findAvailableSlot(
                    dept, otDate, totalPoints, duration, otCapacityMap, getPoolWeeklyCapacity(dept, productType, otTier.bonusPoints)
                );
                const endDate = getEndDateForDuration(slotStart, duration);

                // Reserve capacity
                const dist = distributeLoadByWorkday(slotStart, endDate, totalPoints);
                for (const [wk, pts] of dist.entries()) {
                    if (!otCapacityMap.has(wk)) otCapacityMap.set(wk, new Map());
                    const weekMap = otCapacityMap.get(wk)!;
                    weekMap.set(dept, (weekMap.get(dept) || 0) + pts);
                }

                otLastEnd = endDate;
                otDate = getPipelinedNextStart(slotStart, duration, gap);
            }

            if (otLastEnd <= targetDate) {
                withOTAchievable = true;
                otCompletion = otLastEnd;
                bestOTTier = otTier.tier;

                // Build OT week breakdown for this tier
                // Identify which weeks actually needed OT (exceeded dept-specific capacity)
                for (const [wk, deptMap] of otCapacityMap.entries()) {
                    for (const [dept, load] of deptMap.entries()) {
                        const deptBase = getPoolWeeklyCapacity(dept as Department, productType);
                        if (load > deptBase) {
                            const excess = Math.round(load - deptBase);
                            otWeekDetails.push({
                                weekKey: wk,
                                department: dept as Department,
                                currentLoad: Math.round(load),
                                baseCapacity: deptBase,
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
            const otCapacityMap = cloneCapacityMap(otBaseCapacityMap);

            for (const dept of DEPARTMENTS) {
                const duration = calculateDeptDuration(dept, totalPoints, productType, feasDesc, undefined, undefined, undefined, undefined, feasQty);
                const slotStart = findAvailableSlot(
                    dept, otDate, totalPoints, duration, otCapacityMap, getPoolWeeklyCapacity(dept, productType, maxTier.bonusPoints)
                );
                const endDate = getEndDateForDuration(slotStart, duration);
                otDate = getPipelinedNextStart(slotStart, duration, gap);
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
        if (deptsAlreadyOverloaded) {
            const uniqueDepts = [...new Set(overCapacityDepts.map(d => d.department))];
            explanation = `Cannot meet target date of ${format(targetDate, 'MMM d, yyyy')}. Overtime was not considered because ${uniqueDepts.join(', ')} ${uniqueDepts.length === 1 ? 'is' : 'are'} already over capacity in the existing schedule. The shop needs to reduce its current workload before taking on more work.`;
        } else {
            const bestDate = otCompletion ? format(otCompletion, 'MMM d, yyyy') : 'unknown';
            explanation = `Cannot meet target date of ${format(targetDate, 'MMM d, yyyy')} even with job moves and max overtime (Tier 4). Earliest possible: ${bestDate}.`;
        }
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
            overCapacityDepts,
        },
        recommendation,
        explanation,
    };
}


// ─────────────────────────────────────────────────────────────
// Sales Rep Capacity Trade
// ─────────────────────────────────────────────────────────────

/** A group of jobs under one sales order that could be pushed back */
export interface RepTradeCandidate {
    salesOrder: string;
    jobs: {
        id: string;
        name: string;
        weldingPoints: number;
        dueDate: Date;
    }[];
    totalPoints: number;
    currentDueDate: Date; // Earliest due date across jobs in the SO
}

/** Per-department, per-week capacity change caused by a trade */
export interface CapacityDelta {
    department: Department;
    weekKey: string;
    pointsFreed: number;       // How many points were removed from this dept/week
    loadBefore: number;        // Dept load in that week BEFORE the trade
    loadAfter: number;         // Dept load in that week AFTER the trade
    capacityCeiling: number;   // Weekly capacity for this dept
    wasBottleneck: boolean;    // Was this dept/week at or over capacity before?
    isBottleneckAfter: boolean; // Still at/over capacity after?
}

/** Detailed reasoning for why a trade scenario does or doesn't help */
export interface TradeReasoning {
    summary: string;           // Human-readable explanation
    capacityImpact: CapacityDelta[];  // Per-department breakdown of capacity freed
    quoteBottleneck: {         // Which dept is the real bottleneck for the new quote
        department: Department;
        delayDays: number;
        reason: string;
    } | null;
    safetyDetail: {            // Detailed safety analysis for the pushed job(s)
        bufferDaysBeforePush: number;   // Due date minus schedule end (original)
        bufferDaysAfterPush: number;    // New due date minus latest dept end (after push)
        latestDeptEnd: Date | null;     // When the pushed job finishes its last dept
        riskLevel: 'safe' | 'moderate' | 'risky';
        riskExplanation: string;
    };
}

/** Result of pushing one SO group's due date back */
export interface RepTradeScenario {
    candidate: RepTradeCandidate;
    pushWeeks: number;               // How many weeks pushed (1 or 2)
    newDueDate: Date;                // The pushed-back due date (what to tell the customer)
    newCompletion: Date;             // New quote completion after this trade
    improvementDays: number;         // Days saved on the new quote vs baseline
    safeToMove: boolean;             // True if pushed job's schedule ends before new due date
    reasoning: TradeReasoning;       // Detailed explanation of the trade's impact
}

/** Full rep trade analysis result */
export interface RepTradeResult {
    repCode: string;
    candidates: RepTradeCandidate[];
    baselineCompletion: Date;
    scenarios: RepTradeScenario[];          // Individual SO trades per tier, ranked by improvement
    pushAllScenarios: {                     // Push everything at each tier
        pushWeeks: number;
        newCompletion: Date;
        improvementDays: number;
        allSafe: boolean;
        reasoning: TradeReasoning;
    }[];
}

const PUSH_TIERS = [1, 2]; // Push due dates by 1 week and 2 weeks

/**
 * Simulate the impact of a sales rep pushing back their own jobs' DUE DATES
 * to free capacity for the new quote. The rep would call their customer and
 * negotiate a later delivery — the scheduler then deprioritizes those jobs.
 *
 * The system:
 *  1. Finds the rep's jobs still in Engineering
 *  2. Groups them by sales order
 *  3. For each SO, simulates pushing the due date (+ entire schedule) back 1 and 2 weeks
 *  4. Rebuilds the capacity map and diffs before/after to see exactly which depts/weeks benefit
 *  5. Re-simulates the new quote against the modified capacity to measure improvement
 *  6. Analyzes safety: computes buffer days before & after push, checks if pushed jobs
 *     collide with overloaded weeks, and assigns a risk level (safe/moderate/risky)
 *  7. Identifies the bottleneck department — if the new quote doesn't improve, explains why
 *     (e.g. "Engineering freed 120pts but Welding is the real constraint")
 */
export async function simulateRepTrade(
    repCode: string,
    quoteInput: QuoteInput,
    existingJobs: Job[]
): Promise<RepTradeResult> {
    // ═══════════════════════════════════════════════════════════
    // STEP 1: Get baseline — what happens with NO trades?
    // ═══════════════════════════════════════════════════════════
    const baselineEstimate = await simulateQuoteSchedule(quoteInput, existingJobs);
    const baselineCompletion = baselineEstimate.estimatedCompletion;
    const baselineCapacityMap = buildCapacityMap(existingJobs);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Find rep's jobs still in Engineering
    // ═══════════════════════════════════════════════════════════
    // Departments that come AFTER Engineering in the pipeline.
    // If a job's schedule shows any of these with a start date in the past,
    // the job has moved on — regardless of what currentDepartment says.
    const POST_ENGINEERING_DEPTS: Department[] = [
        'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'
    ];
    const today = startOfDay(new Date());

    /** Check if a job has genuinely NOT left Engineering yet */
    const isStillInEngineering = (j: Job): boolean => {
        // Primary check — must say Engineering
        if (j.currentDepartment !== 'Engineering') return false;

        // Cross-check against departmentSchedule:
        // If a downstream department has already started, the job has moved on
        if (j.departmentSchedule) {
            const sched = j.departmentSchedule as Record<string, { start: string; end: string }>;
            for (const dept of POST_ENGINEERING_DEPTS) {
                const entry = sched[dept];
                if (entry?.start) {
                    const deptStart = startOfDay(new Date(entry.start));
                    if (deptStart <= today) {
                        // This downstream dept has already started — job is NOT in Engineering
                        return false;
                    }
                }
            }
        }

        // Cross-check against remainingDepartmentSchedule:
        // If it exists and Engineering is NOT in it, the job has moved past Engineering
        if (j.remainingDepartmentSchedule) {
            const remaining = j.remainingDepartmentSchedule as Record<string, { start: string; end: string }>;
            if (!remaining['Engineering']) {
                return false;
            }
        }

        return true;
    };

    const repEngJobs = existingJobs.filter(
        (j) =>
            j.salesRepCode?.toUpperCase() === repCode.toUpperCase() &&
            isStillInEngineering(j) &&
            j.status !== 'COMPLETED' &&
            j.status !== 'HOLD'
    );


    // ═══════════════════════════════════════════════════════════
    // STEP 3: Group by sales order
    // ═══════════════════════════════════════════════════════════
    const soGroups = new Map<string, Job[]>();
    for (const job of repEngJobs) {
        const so = job.salesOrder || job.id;
        if (!soGroups.has(so)) soGroups.set(so, []);
        soGroups.get(so)!.push(job);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Build candidates
    // ═══════════════════════════════════════════════════════════
    const candidates: RepTradeCandidate[] = [];
    for (const [so, jobs] of soGroups.entries()) {
        const totalPoints = jobs.reduce((sum, j) => sum + (Number(j.weldingPoints) || 0), 0);
        const dueDates = jobs
            .filter((j) => j.dueDate)
            .map((j) => new Date(j.dueDate));
        const currentDueDate = dueDates.length > 0
            ? new Date(Math.min(...dueDates.map((d) => d.getTime())))
            : new Date();


        candidates.push({
            salesOrder: so,
            jobs: jobs.map((j) => ({
                id: j.id,
                name: j.name,
                weldingPoints: Number(j.weldingPoints) || 0,
                dueDate: new Date(j.dueDate),
            })),
            totalPoints,
            currentDueDate,
        });
    }

    // Sort candidates by total points (biggest capacity impact first)
    candidates.sort((a, b) => b.totalPoints - a.totalPoints);

    // ═══════════════════════════════════════════════════════════
    // HELPER: Shift a job forward by N work days
    // ═══════════════════════════════════════════════════════════
    const pushJobForward = (j: Job, days: number): Job => {
        const shifted: Job = {
            ...j,
            dueDate: addWorkDays(new Date(j.dueDate), days),
        };
        if (j.departmentSchedule) {
            const newSchedule: Record<string, { start: string; end: string }> = {};
            for (const [dept, sched] of Object.entries(j.departmentSchedule as Record<string, { start: string; end: string }>)) {
                newSchedule[dept] = {
                    start: addWorkDays(new Date(sched.start), days).toISOString(),
                    end: addWorkDays(new Date(sched.end), days).toISOString(),
                };
            }
            shifted.departmentSchedule = newSchedule;
        }
        return shifted;
    };

    // ═══════════════════════════════════════════════════════════
    // HELPER: Compute capacity deltas between baseline and trade
    // Shows exactly which dept/weeks got relief (or got worse)
    // ═══════════════════════════════════════════════════════════
    const computeCapacityDeltas = (
        beforeMap: CapacityMap,
        afterMap: CapacityMap
    ): CapacityDelta[] => {
        const deltas: CapacityDelta[] = [];
        const allWeeks = new Set([...beforeMap.keys(), ...afterMap.keys()]);

        for (const weekKey of allWeeks) {
            const beforeDepts = beforeMap.get(weekKey);
            const afterDepts = afterMap.get(weekKey);
            const allDepts = new Set([
                ...(beforeDepts?.keys() || []),
                ...(afterDepts?.keys() || []),
            ]);

            for (const dept of allDepts) {
                const loadBefore = beforeDepts?.get(dept) || 0;
                const loadAfter = afterDepts?.get(dept) || 0;
                const pointsFreed = loadBefore - loadAfter;

                // Only report meaningful deltas (> 1pt to avoid floating point noise)
                if (Math.abs(pointsFreed) < 1) continue;

                const cap = getDeptWeeklyCapacity(dept as Department);
                deltas.push({
                    department: dept as Department,
                    weekKey,
                    pointsFreed: Math.round(pointsFreed),
                    loadBefore: Math.round(loadBefore),
                    loadAfter: Math.round(loadAfter),
                    capacityCeiling: cap,
                    wasBottleneck: loadBefore >= cap * 0.95,  // within 5% counts as bottleneck
                    isBottleneckAfter: loadAfter >= cap * 0.95,
                });
            }
        }

        // Sort: biggest freed first
        deltas.sort((a, b) => b.pointsFreed - a.pointsFreed);
        return deltas;
    };

    // ═══════════════════════════════════════════════════════════
    // HELPER: Analyze safety + buffer for a set of pushed jobs
    // CAPACITY-AWARE: checks the post-trade capacity map.
    // If the pushed schedule lands in overloaded weeks, it estimates
    // additional delay days so the risk badge reflects reality.
    // ═══════════════════════════════════════════════════════════
    const analyzeSafety = (
        jobIds: Set<string>,
        pushDays: number,
        afterCapacityMap: CapacityMap
    ): TradeReasoning['safetyDetail'] => {
        let worstBufferBefore = Infinity;
        let worstBufferAfter = Infinity;
        let worstLatestEnd: Date | null = null;

        for (const jid of jobIds) {
            const orig = existingJobs.find((j) => j.id === jid);
            if (!orig?.departmentSchedule || !orig.dueDate) continue;

            const origDue = new Date(orig.dueDate);
            const newDue = addWorkDays(origDue, pushDays);

            // ── Original buffer (before trade) ──
            let origLatestEnd: Date | null = null;
            for (const sched of Object.values(orig.departmentSchedule as Record<string, { start: string; end: string }>)) {
                const end = new Date(sched.end);
                if (!origLatestEnd || end > origLatestEnd) origLatestEnd = end;
            }

            // ── Capacity-aware pushed completion ──
            // For each department in the pushed schedule, check if the
            // week it lands in is overloaded. If so, estimate how many
            // extra workdays the job will be delayed.
            let capacityDelayDays = 0;
            const pushedSched = orig.departmentSchedule as Record<string, { start: string; end: string }>;

            for (const [dept, sched] of Object.entries(pushedSched)) {
                const pushedEnd = addWorkDays(new Date(sched.end), pushDays);
                const weekKey = format(startOfWeek(pushedEnd, { weekStartsOn: 1 }), 'yyyy-MM-dd');

                // Look up the capacity load in the week this dept lands in
                const deptTyped = dept as Department;
                const weekDepts = afterCapacityMap.get(weekKey);
                const loadInWeek = weekDepts?.get(deptTyped) || 0;
                const cap = getDeptWeeklyCapacity(deptTyped);

                if (loadInWeek > cap) {
                    // Overloaded! Estimate spillover delay:
                    // How many extra days does the overflow represent?
                    const overflow = loadInWeek - cap;
                    const dailyThroughput = cap / 5; // pts per day
                    const extraDays = dailyThroughput > 0
                        ? Math.ceil(overflow / dailyThroughput)
                        : 0;

                    capacityDelayDays = Math.max(capacityDelayDays, extraDays);
                }
            }

            // Compute pushed latest end WITH capacity delay
            let pushedLatestEnd: Date | null = null;
            for (const sched of Object.values(pushedSched)) {
                const end = addWorkDays(new Date(sched.end), pushDays + capacityDelayDays);
                if (!pushedLatestEnd || end > pushedLatestEnd) pushedLatestEnd = end;
            }

            if (origLatestEnd) {
                const bufferBefore = differenceInDays(origDue, origLatestEnd);
                if (bufferBefore < worstBufferBefore) worstBufferBefore = bufferBefore;
            }

            if (pushedLatestEnd) {
                const bufferAfter = differenceInDays(newDue, pushedLatestEnd);
                if (bufferAfter < worstBufferAfter) {
                    worstBufferAfter = bufferAfter;
                    worstLatestEnd = pushedLatestEnd;
                }
            }
        }

        // Handle case where no valid jobs were found
        if (worstBufferBefore === Infinity) worstBufferBefore = 0;
        if (worstBufferAfter === Infinity) worstBufferAfter = 0;

        // Determine risk level based on buffer days after push
        let riskLevel: 'safe' | 'moderate' | 'risky';
        let riskExplanation: string;

        if (worstBufferAfter >= 5) {
            riskLevel = 'safe';
            riskExplanation = `Your customer's order will still ship on time — it finishes ${worstBufferAfter} days early even after the push.`;
        } else if (worstBufferAfter >= 0) {
            riskLevel = 'moderate';
            riskExplanation = `Your customer's order will be tight — it finishes just ${worstBufferAfter} day${worstBufferAfter !== 1 ? 's' : ''} before the new due date. Any hiccup could make it late.`;
        } else {
            riskLevel = 'risky';
            riskExplanation = `Your customer's order would ship ${Math.abs(worstBufferAfter)} days late, even with the extended due date. This trade will upset that customer.`;
        }

        return {
            bufferDaysBeforePush: worstBufferBefore,
            bufferDaysAfterPush: worstBufferAfter,
            latestDeptEnd: worstLatestEnd,
            riskLevel,
            riskExplanation,
        };
    };

    // ═══════════════════════════════════════════════════════════
    // HELPER: Find the bottleneck department for the new quote
    // by examining the trade estimate's timeline
    // ═══════════════════════════════════════════════════════════
    const findQuoteBottleneck = (
        tradeEstimate: QuoteEstimate,
        baseEstimate: QuoteEstimate
    ): TradeReasoning['quoteBottleneck'] => {
        // Find the department with the largest capacity delay in the trade estimate
        let worstDept: Department | null = null;
        let worstDelay = 0;

        for (const tl of tradeEstimate.timeline) {
            const delayDays = tl.capacityDelayDays ?? 0;
            if (delayDays > worstDelay) {
                worstDelay = delayDays;
                worstDept = tl.department;
            }
        }

        if (!worstDept || worstDelay === 0) return null;

        // Check if this department was also the bottleneck in the baseline
        const baselineDept = baseEstimate.timeline.find(t => t.department === worstDept);
        const baseDelay = baselineDept?.capacityDelayDays || 0;

        const reason = baseDelay > 0 && worstDelay >= baseDelay
            ? `${worstDept} is at capacity — this trade didn't free enough capacity there (${worstDelay}d delay remains, was ${baseDelay}d before)`
            : `${worstDept} has a ${worstDelay}-day capacity delay that limits how much this trade can help`;

        return {
            department: worstDept,
            delayDays: worstDelay,
            reason,
        };
    };

    // ═══════════════════════════════════════════════════════════
    // HELPER: Build the human-readable summary for a scenario
    // Keep it SIMPLE — salespeople need plain English.
    // ═══════════════════════════════════════════════════════════
    const buildSummary = (
        candidate: RepTradeCandidate | null, // null for "push all"
        pushWeeks: number,
        improvementDays: number,
        capacityImpact: CapacityDelta[],
        bottleneck: TradeReasoning['quoteBottleneck'],
        safety: TradeReasoning['safetyDetail']
    ): string => {
        const weekLabel = pushWeeks === 1 ? '1 week' : `${pushWeeks} weeks`;
        const soLabel = candidate
            ? `SO ${candidate.salesOrder}`
            : `all ${candidates.length} sales orders`;

        if (improvementDays === 0) {
            // No improvement — explain why in plain English
            if (bottleneck) {
                return `Pushing ${soLabel} back ${weekLabel} doesn't help your new quote. The shop is backed up in ${bottleneck.department}, and this trade doesn't free up room there.`;
            }
            const freedDepts = [...new Set(capacityImpact.filter(d => d.pointsFreed > 0).map(d => d.department))];
            if (freedDepts.length > 0) {
                return `Pushing ${soLabel} back ${weekLabel} frees up room in ${freedDepts.join(' and ')}, but the new quote is held up somewhere else — so it doesn't help.`;
            }
            return `Pushing ${soLabel} back ${weekLabel} doesn't help — those jobs aren't competing with your new quote for shop time.`;
        }

        // There IS improvement — keep it simple
        let summary = `Pushing ${soLabel} back ${weekLabel} gets your new quote done ${improvementDays} day${improvementDays !== 1 ? 's' : ''} sooner.`;

        // Mention which dept it helps (just the first one, keep it simple)
        const helpedDepts = capacityImpact
            .filter(d => d.pointsFreed > 0 && d.wasBottleneck)
            .map(d => d.department);
        const uniqueHelped = [...new Set(helpedDepts)];
        if (uniqueHelped.length > 0) {
            summary += ` It frees up room in ${uniqueHelped.slice(0, 2).join(' and ')}, which is where the shop was backed up.`;
        }

        if (bottleneck && bottleneck.delayDays > 0) {
            summary += ` Heads up: ${bottleneck.department} is still busy, so there's a limit to how much this can help.`;
        }

        return summary;
    };

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Simulate individual SO trades at each push tier
    // ═══════════════════════════════════════════════════════════
    const scenarios: RepTradeScenario[] = [];

    for (const candidate of candidates) {
        const candidateJobIds = new Set(candidate.jobs.map((j) => j.id));

        for (const weeks of PUSH_TIERS) {
            const pushDays = weeks * 5;

            // Build modified job list with pushed SO
            const modifiedJobs = existingJobs.map((j) => {
                if (!candidateJobIds.has(j.id)) return j;
                return pushJobForward(j, pushDays);
            });

            // Re-simulate the new quote against modified capacity
            const tradeEstimate = await simulateQuoteSchedule(quoteInput, modifiedJobs);
            const newCompletion = tradeEstimate.estimatedCompletion;
            const improvementDays = Math.max(0, differenceInDays(baselineCompletion, newCompletion));

            // Compute capacity deltas (what actually changed in the capacity map)
            const afterCapacityMap = buildCapacityMap(modifiedJobs);
            const capacityImpact = computeCapacityDeltas(baselineCapacityMap, afterCapacityMap);

            // Analyze safety (buffer days, risk level)
            const safetyDetail = analyzeSafety(candidateJobIds, pushDays, afterCapacityMap);

            // Find the bottleneck for the new quote
            const quoteBottleneck = findQuoteBottleneck(tradeEstimate, baselineEstimate);

            // Build summary
            const summary = buildSummary(candidate, weeks, improvementDays, capacityImpact, quoteBottleneck, safetyDetail);

            scenarios.push({
                candidate,
                pushWeeks: weeks,
                newDueDate: addWorkDays(candidate.currentDueDate, pushDays),
                newCompletion,
                improvementDays,
                safeToMove: safetyDetail.riskLevel !== 'risky',
                reasoning: {
                    summary,
                    capacityImpact,
                    quoteBottleneck,
                    safetyDetail,
                },
            });
        }
    }

    // Sort: 1-week scenarios first within each SO, then by improvement
    scenarios.sort((a, b) => {
        if (a.candidate.salesOrder !== b.candidate.salesOrder) {
            return b.improvementDays - a.improvementDays;
        }
        return a.pushWeeks - b.pushWeeks;
    });

    // ═══════════════════════════════════════════════════════════
    // STEP 6: "Push all" scenarios at each tier
    // ═══════════════════════════════════════════════════════════
    const pushAllScenarios: RepTradeResult['pushAllScenarios'] = [];
    if (candidates.length > 0) {
        const allCandidateJobIds = new Set(candidates.flatMap((c) => c.jobs.map((j) => j.id)));

        for (const weeks of PUSH_TIERS) {
            const pushDays = weeks * 5;

            const modifiedJobs = existingJobs.map((j) => {
                if (!allCandidateJobIds.has(j.id)) return j;
                return pushJobForward(j, pushDays);
            });

            const allTradeEstimate = await simulateQuoteSchedule(quoteInput, modifiedJobs);
            const allNewCompletion = allTradeEstimate.estimatedCompletion;
            const allImprovementDays = Math.max(0, differenceInDays(baselineCompletion, allNewCompletion));

            // Compute capacity deltas for "push all"
            const afterCapacityMap = buildCapacityMap(modifiedJobs);
            const capacityImpact = computeCapacityDeltas(baselineCapacityMap, afterCapacityMap);

            // Analyze safety for all pushed jobs
            const safetyDetail = analyzeSafety(allCandidateJobIds, pushDays, afterCapacityMap);

            // Find bottleneck
            const quoteBottleneck = findQuoteBottleneck(allTradeEstimate, baselineEstimate);

            // Build summary
            const summary = buildSummary(null, weeks, allImprovementDays, capacityImpact, quoteBottleneck, safetyDetail);

            pushAllScenarios.push({
                pushWeeks: weeks,
                newCompletion: allNewCompletion,
                improvementDays: allImprovementDays,
                allSafe: safetyDetail.riskLevel !== 'risky',
                reasoning: {
                    summary,
                    capacityImpact,
                    quoteBottleneck,
                    safetyDetail,
                },
            });
        }
    }

    return {
        repCode,
        candidates,
        baselineCompletion,
        scenarios,
        pushAllScenarios,
    };
}
