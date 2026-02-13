import { Job, Department, ProductType } from '@/types';
import { DEPARTMENT_CONFIG, DEPT_ORDER } from './departmentConfig';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type HealthStatus = 'HEALTHY' | 'LOW' | 'STARVED' | 'OVERLOADED';

export interface DepartmentQueueHealth {
    department: Department;
    pointsOnHand: number;       // Welding pts of jobs physically IN this department right now
    pointsByProductType: Record<ProductType, number>; // FAB/DOORS/HARMONIC breakdown
    jobsInQueue: number;        // Count of jobs physically in this department
    daysOfWork: number;         // pointsOnHand ÷ daily capacity
    weeklyCapacity: number;     // Weekly target from DEPARTMENT_CONFIG
    dailyCapacity: number;      // Daily capacity from DEPARTMENT_CONFIG
    utilizationPct: number;     // daysOfWork / 5 (work week) as a percentage
    health: HealthStatus;
    otUseful: boolean;          // True if OVERLOADED (OT would help absorb backlog)
    color: string;              // Department color from config
}

// ─────────────────────────────────────────────────────────────
// Health Thresholds (user-approved)
// ─────────────────────────────────────────────────────────────

const HEALTH_THRESHOLDS = {
    STARVED_MAX: 1,     // 0–1 days → STARVED
    LOW_MAX: 3,         // 1–3 days → LOW
    HEALTHY_MAX: 5,     // 3–5 days → HEALTHY
    // 5+ days → OVERLOADED
} as const;

// ─────────────────────────────────────────────────────────────
// Core Logic
// ─────────────────────────────────────────────────────────────

/**
 * Determine the health status based on days of work queued
 */
const getHealthStatus = (daysOfWork: number): HealthStatus => {
    if (daysOfWork <= HEALTH_THRESHOLDS.STARVED_MAX) return 'STARVED';
    if (daysOfWork <= HEALTH_THRESHOLDS.LOW_MAX) return 'LOW';
    if (daysOfWork <= HEALTH_THRESHOLDS.HEALTHY_MAX) return 'HEALTHY';
    return 'OVERLOADED';
};

/**
 * Calculate queue health metrics for all departments.
 *
 * "Points on hand" = jobs whose currentDepartment IS this department.
 * These are jobs physically IN the department, ready to be worked on.
 * This is determined by the job's `currentDepartment` field, which is
 * calculated from the DEPTxDONE columns in the XLSX import.
 */
export const calculateQueueHealth = (jobs: Job[]): DepartmentQueueHealth[] => {
    return DEPT_ORDER.map((dept) => {
        const config = DEPARTMENT_CONFIG[dept];
        const dailyCap = config.dailyCapacity;
        const weeklyCap = config.weeklyTarget.max;

        // Only count jobs physically IN this department right now
        // For Engineering: exclude readyToNest jobs (shown in Nesting card instead)
        const jobsInDept = jobs.filter(
            (job) => job.currentDepartment === dept && job.weldingPoints > 0
                && !(dept === 'Engineering' && job.readyToNest)
        );

        const pointsOnHand = jobsInDept.reduce(
            (sum, job) => sum + (job.weldingPoints || 0),
            0
        );

        // FAB / DOORS / HARMONIC breakdown
        const pointsByProductType: Record<ProductType, number> = { FAB: 0, DOORS: 0, HARMONIC: 0 };
        for (const job of jobsInDept) {
            const pt = job.productType || 'FAB';
            pointsByProductType[pt] += job.weldingPoints || 0;
        }

        const jobsInQueue = jobsInDept.length;

        const daysOfWork = dailyCap > 0 ? pointsOnHand / dailyCap : 0;
        const utilizationPct = Math.round((daysOfWork / 5) * 100); // % of a work week
        const health = getHealthStatus(daysOfWork);

        return {
            department: dept,
            pointsOnHand: Math.round(pointsOnHand),
            pointsByProductType: {
                FAB: Math.round(pointsByProductType.FAB),
                DOORS: Math.round(pointsByProductType.DOORS),
                HARMONIC: Math.round(pointsByProductType.HARMONIC),
            },
            jobsInQueue,
            daysOfWork: Math.round(daysOfWork * 10) / 10, // 1 decimal
            weeklyCapacity: weeklyCap,
            dailyCapacity: dailyCap,
            utilizationPct,
            health,
            otUseful: health === 'OVERLOADED',
            color: config.color,
        };
    });
};

/**
 * Get health status color for UI rendering
 */
export const getHealthColor = (health: HealthStatus): string => {
    switch (health) {
        case 'HEALTHY': return '#22c55e';    // green-500
        case 'LOW': return '#eab308';        // yellow-500
        case 'STARVED': return '#ef4444';    // red-500
        case 'OVERLOADED': return '#f97316'; // orange-500
    }
};

/**
 * Get health status label for display
 */
export const getHealthLabel = (health: HealthStatus): string => {
    switch (health) {
        case 'HEALTHY': return 'Healthy';
        case 'LOW': return 'Low';
        case 'STARVED': return 'Starved';
        case 'OVERLOADED': return 'Overloaded';
    }
};
