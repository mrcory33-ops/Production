import { Job, Department, ProductType } from '@/types';
import { eachDayOfInterval, isSameDay, format, startOfWeek, endOfWeek, addDays, startOfDay, isWeekend } from 'date-fns';
import { DEPARTMENT_CONFIG, getPoolForJob } from './departmentConfig';

export interface DailyLoad {
    date: Date;
    departments: Record<Department, number>; // Points allocated
    totalPoints: number;
}

export interface DailyLoadByType {
    date: Date;
    departments: Record<Department, {
        total: number;
        byType: Record<ProductType, number>;
    }>;
}

export interface WeeklyMix {
    weekStart: Date;
    fab: number;
    doors: number;
    harmonic: number;
}

export interface WeeklyLoad {
    weekStart: Date;
    weekEnd: Date;
    departments: Record<Department, {
        totalPoints: number;
        targetMin: number;
        targetMax: number;
        status: 'under' | 'optimal' | 'over';
    }>;
}

export type BottleneckSeverity = 'warning' | 'critical';

export interface Bottleneck {
    date: Date;
    department: Department;
    overload: number;
    severity: BottleneckSeverity;
    productType?: ProductType; // If split by type
}

const DEPARTMENTS: Department[] = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

/**
 * Aggregates job schedules into daily departmental loads.
 * @param jobs Active jobs
 * @param rangeStart Assessment window start
 * @param rangeEnd Assessment window end
 */
export const calculateDailyLoads = (jobs: Job[], rangeStart: Date, rangeEnd: Date): DailyLoad[] => {
    // 1. Create array of all days in range
    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    // 2. Initialize map
    const loadMap = new Map<string, DailyLoad>();
    days.forEach(day => {
        if (isWeekend(day)) return; // Skip weekends for now

        loadMap.set(day.toISOString(), {
            date: day,
            departments: {
                'Engineering': 0,
                'Laser': 0,
                'Press Brake': 0,
                'Welding': 0,
                'Polishing': 0,
                'Assembly': 0,
                'Shipping': 0 // Usually 0 load, just a milestone
            },
            totalPoints: 0
        });
    });

    // 3. Iterate Jobs and Distribute Points
    jobs.forEach(job => {
        if (!job.departmentSchedule || !job.weldingPoints) return;

        Object.entries(job.departmentSchedule).forEach(([dept, interval]) => {
            if (!interval.start || !interval.end) return;

            const start = new Date(interval.start);
            const end = new Date(interval.end);

            // Calculate duration in days (inclusive)
            const durationDays = Math.max(1, eachDayOfInterval({ start, end }).filter(d => !isWeekend(d)).length);

            // Daily Load = Total Points / Duration
            // Note: This assumes linear distribution.
            const pointsPerDay = job.weldingPoints / durationDays;

            // Apply to each day in the job's interval
            const jobDays = eachDayOfInterval({ start, end });

            jobDays.forEach(day => {
                if (isWeekend(day)) return;

                const normalizedDate = startOfDay(day);
                const key = Array.from(loadMap.keys()).find(k => isSameDay(new Date(k), day));

                if (key) {
                    const entry = loadMap.get(key)!;
                    if (dept in entry.departments) {
                        entry.departments[dept as Department] += pointsPerDay;
                        entry.totalPoints += pointsPerDay;
                    }
                }
            });
        });
    });

    return Array.from(loadMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
};

/**
 * Detect bottlenecks using department-specific capacity thresholds
 */
export const detectBottlenecks = (
    loads: DailyLoad[],
    splitByType: boolean = false
): Bottleneck[] => {
    const bottlenecks: Bottleneck[] = [];

    loads.forEach(day => {
        Object.entries(day.departments).forEach(([dept, points]) => {
            const deptName = dept as Department;
            const config = DEPARTMENT_CONFIG[deptName];

            if (!config) return;

            const capacity = config.dailyCapacity;

            if (points > capacity) {
                const overload = points - capacity;
                const overloadPercent = (overload / capacity) * 100;

                bottlenecks.push({
                    date: day.date,
                    department: deptName,
                    overload,
                    severity: overloadPercent > 20 ? 'critical' : 'warning'
                });
            }
        });
    });

    return bottlenecks;
};

/**
 * Calculate weekly loads and compare against targets
 */
export const calculateWeeklyLoads = (jobs: Job[], rangeStart: Date, rangeEnd: Date): WeeklyLoad[] => {
    const dailyLoads = calculateDailyLoads(jobs, rangeStart, rangeEnd);
    const weeklyLoads: WeeklyLoad[] = [];

    // Group by week
    const weekMap = new Map<string, DailyLoad[]>();

    dailyLoads.forEach(day => {
        const weekStart = startOfWeek(day.date, { weekStartsOn: 1 }); // Monday
        const key = weekStart.toISOString();

        if (!weekMap.has(key)) {
            weekMap.set(key, []);
        }
        weekMap.get(key)!.push(day);
    });

    // Aggregate each week
    weekMap.forEach((days, weekStartKey) => {
        const weekStart = new Date(weekStartKey);
        const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

        const departments: Record<Department, {
            totalPoints: number;
            targetMin: number;
            targetMax: number;
            status: 'under' | 'optimal' | 'over';
        }> = {} as any;

        DEPARTMENTS.forEach(dept => {
            const config = DEPARTMENT_CONFIG[dept];
            const totalPoints = days.reduce((sum, day) => sum + (day.departments[dept] || 0), 0);
            const targetMin = config.weeklyTarget.min;
            const targetMax = config.weeklyTarget.max;

            let status: 'under' | 'optimal' | 'over' = 'optimal';
            if (totalPoints < targetMin * 0.8) status = 'under';
            if (totalPoints > targetMax) status = 'over';

            departments[dept] = {
                totalPoints,
                targetMin,
                targetMax,
                status
            };
        });

        weeklyLoads.push({
            weekStart,
            weekEnd,
            departments
        });
    });

    return weeklyLoads.sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
};

/**
 * Calculate total points per department for specific selected dates
 * Formula used: Sum of (Total Job Points / Total Job Days) for each day selected
 */
export const calculateDepartmentTotals = (jobs: Job[], selectedDates: Date[]): Record<Department, { total: number; byType: Record<ProductType, number> }> => {
    const totals: Record<Department, { total: number; byType: Record<ProductType, number> }> = {
        'Engineering': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Laser': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Press Brake': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Welding': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Polishing': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Assembly': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } },
        'Shipping': { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } }
    };

    if (selectedDates.length === 0) return totals;

    // Use daily loads to get precise allocation
    // We recreate daily loads internally or loop manually to capture Product Type
    // calculateDailyLoads aggregates points but doesn't preserve Job metadata per entry easily without modification
    // So better to iterate jobs directly here for the specific dates

    // Find relevant jobs for these dates
    const dateStrings = new Set(selectedDates.map(d => startOfDay(d).toISOString()));

    jobs.forEach(job => {
        if (!job.departmentSchedule || !job.weldingPoints) return;

        // Product Type
        const pType = job.productType || 'FAB'; // Default to FAB if missing

        Object.entries(job.departmentSchedule).forEach(([dept, interval]) => {
            const deptName = dept as Department;
            if (!totals[deptName]) return;

            const start = new Date(interval.start);
            const end = new Date(interval.end);

            // Calculate total duration (excluding weekends)
            const durationDays = Math.max(1, eachDayOfInterval({ start, end }).filter(d => !isWeekend(d)).length);
            const pointsPerDay = job.weldingPoints / durationDays;

            // Check overlap with selected dates
            eachDayOfInterval({ start, end }).forEach(day => {
                if (isWeekend(day)) return;

                const dayStr = startOfDay(day).toISOString();
                if (dateStrings.has(dayStr)) {
                    // Add to total
                    totals[deptName].total += pointsPerDay;
                    // Add to type
                    if (totals[deptName].byType[pType] !== undefined) {
                        totals[deptName].byType[pType] += pointsPerDay;
                    }
                }
            });
        });
    });

    return totals;
};

