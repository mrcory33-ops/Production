import { Job } from '@/types';
import { addDays, isSaturday, isSunday, subDays, startOfDay, isBefore } from 'date-fns';

// Configuration Constants
const DAILY_CAPACITY = 200; // Points per day
const BUFFER_DAYS = 2; // Days before due date to finish

const DEPARTMENTS = [
    'Engineering',
    'Laser',
    'Press Brake',
    'Welding',
    'Polishing',
    'Assembly'
] as const;

export type DepartmentName = typeof DEPARTMENTS[number];

/**
 * Calculates the number of work days needed for a job in a specific department.
 * - Assembly: 1.5x Multiplier
 * - Others: 1.0x Multiplier (relative to Welding Points)
 */
export const calculateDuration = (points: number, dept: DepartmentName): number => {
    // If points are 0 or invalid, assume 0 days (or minimum 1?)
    // Let's assume minimum 0.5 days if points > 0
    if (!points) return 0;

    let multiplier = 1.0;
    if (dept === 'Assembly') multiplier = 1.5;

    // Duration in Days = (Points / DAILY_CAPACITY) * Multiplier
    const rawDays = (points / DAILY_CAPACITY) * multiplier;

    // Round up to nearest 0.5 day for scheduling blocks? Or keep partial?
    // Let's keep partial for calculation, but maybe snap to grid later.
    // implementation_plan says "Duration = WeldingPoints / 200".

    return Math.ceil(rawDays * 10) / 10; // Round to 1 decimal
};

/**
 * Subtracts work days from a date, skipping weekends.
 */
export const subtractWorkDays = (date: Date, days: number): Date => {
    let remaining = days;
    let current = new Date(date);

    while (remaining > 0) {
        current = subDays(current, 1);
        // If it's a weekend, don't count it as a "work day subtracted"
        // BUT we are moving BACKWARDS in time.
        // So if we land on Sunday, we just keep moving.
        // Wait, "subtract work days" means we need X *work* days of production.
        if (!isSaturday(current) && !isSunday(current)) {
            remaining -= 1; // Used 1 work day
        }
    }
    return current;
};

/**
 * Main Scheduling Function
 * Pass 1: "Big Rocks" (Large/Priority Jobs)
 * Pass 2: "Sand" (Small Jobs)
 */
export const scheduleJobs = (jobs: Job[]) => {
    // 1. Separate Big Rocks vs Small Rocks
    const bigRocks = jobs.filter(j => j.isPriority || j.weldingPoints >= 70);
    const smallRocks = jobs.filter(j => !j.isPriority && j.weldingPoints < 70);

    // Sort Big Rocks by Due Date ASC (Earliest due date gets priority)
    bigRocks.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    const scheduledJobs: Job[] = [];

    // Pass 1: Schedule Big Rocks
    bigRocks.forEach(job => {
        const schedule = backwardScheduleJob(job);
        scheduledJobs.push(schedule);
    });

    // Pass 2: Schedule Small Rocks (Fill in the gaps)
    // Currently using the same backward logic for simplicity.
    // Future optimization: forward schedule into gaps if needed.
    smallRocks.forEach(job => {
        const schedule = backwardScheduleJob(job);
        scheduledJobs.push(schedule);
    });

    return scheduledJobs;
};

/**
 * Backward Schedules a single job from its Due Date.
 */
const backwardScheduleJob = (job: Job): Job => {
    if (!job.dueDate) return job; // Cannot schedule without due date

    // Start with Due Date - Buffer
    let cursorDate = subDays(new Date(job.dueDate), BUFFER_DAYS);

    // We work backwards: Assembly -> Polishing -> Welding -> Press -> Laser -> Engineering
    // Reverse array of departments
    const reverseDepts = [...DEPARTMENTS].reverse();

    const deptSchedules: Record<string, { start: Date; end: Date }> = {};
    let isOverdue = false;

    for (const dept of reverseDepts) {
        const duration = calculateDuration(job.weldingPoints, dept);

        // End Date for this dept is the current cursor
        // (Ensure cursor is a work day? Yes)
        // Actually, if cursor lands on Sunday, end date is Friday?
        // Let's assume production finishes on cursor.

        const endDate = new Date(cursorDate);

        // Start Date = End Date - Duration (Work Days)
        // Note: Logic here is simplified. If duration is 2 days:
        // Mon (End) -> Fri (Start)?

        const startDate = subtractWorkDays(endDate, duration);

        deptSchedules[dept] = { start: startDate, end: endDate };

        // Move cursor for next department to be the START of this one
        cursorDate = new Date(startDate);
    }

    // Check if start date is in past (Overdue)
    if (isBefore(cursorDate, startOfDay(new Date()))) {
        isOverdue = true;
    }

    // Convert dates to ISO strings for storage
    const formattedSchedule: Record<string, { start: string; end: string }> = {};
    Object.entries(deptSchedules).forEach(([dept, dates]) => {
        formattedSchedule[dept] = {
            start: dates.start.toISOString(),
            end: dates.end.toISOString()
        };
    });

    return {
        ...job,
        scheduledStartDate: cursorDate,
        isOverdue,
        departmentSchedule: formattedSchedule
    };
};
