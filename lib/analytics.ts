import { Job, Department } from '@/types';
import { eachDayOfInterval, isSameDay, format, startOfWeek, endOfWeek, addDays, startOfDay, isWeekend } from 'date-fns';

export interface DailyLoad {
    date: Date;
    departments: Record<Department, number>; // Points allocated
    totalPoints: number;
}

export interface WeeklyMix {
    weekStart: Date;
    fab: number;
    doors: number;
    harmonic: number;
}

const DEPARTMENTS: Department[] = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];
const DAILY_CAPACITY = 200; // Configurable later

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

                // Find matching day in our master range
                // We use string keys for simpler lookup than object ref
                // Need to find the key in loadMap that matches this day
                // (Optimization: standardize time to startOfDay)

                const normalizedDate = startOfDay(day);
                // Look for existing entry (inefficient loop, but safe or string key)
                // Let's rely on standard ISO string at midnight for key if possible, 
                // but Map iteration is fast enough for 30 days.

                // Better:
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

export const detectBottlenecks = (loads: DailyLoad[], capacity: number = DAILY_CAPACITY) => {
    const bottlenecks: { date: Date; department: Department; overload: number }[] = [];

    loads.forEach(day => {
        Object.entries(day.departments).forEach(([dept, points]) => {
            if (points > capacity) {
                bottlenecks.push({
                    date: day.date,
                    department: dept as Department,
                    overload: points - capacity
                });
            }
        });
    });

    return bottlenecks;
};
