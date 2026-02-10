import { Department, Job } from '@/types';
import { addDays, endOfDay, isSaturday, isSunday, startOfDay } from 'date-fns';

const DEPARTMENT_SEQUENCE: Department[] = [
    'Engineering',
    'Laser',
    'Press Brake',
    'Welding',
    'Polishing',
    'Assembly',
];

export interface ExportDateRange {
    start: Date | null;
    end: Date | null;
}

const EXPORT_BUFFER_WORKDAYS = 1;

const normalizeDepartment = (value: string | undefined): Department | null => {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return DEPARTMENT_SEQUENCE.find((dept) => dept.toLowerCase() === normalized) || null;
};

const getDepartmentWindow = (
    schedule: Job['departmentSchedule'] | Job['remainingDepartmentSchedule'] | undefined,
    dept: Department
): { start: string; end: string } | null => {
    if (!schedule) return null;

    const direct = schedule[dept];
    if (direct) return direct;

    for (const [key, value] of Object.entries(schedule)) {
        if (normalizeDepartment(key) === dept) {
            return value;
        }
    }

    return null;
};

const getFallbackWindow = (
    job: Job,
    dept: Department
): { start: string; end: string } | null => {
    if (normalizeDepartment(job.currentDepartment) !== dept) {
        return null;
    }

    // Match CustomGanttTable fallback exactly so export and Gantt stay aligned.
    const startCandidate = job.forecastStartDate || job.scheduledStartDate || job.dueDate;
    const endCandidate = job.forecastDueDate || job.dueDate;

    const start = new Date(startCandidate);
    const end = new Date(endCandidate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    return { start: start.toISOString(), end: end.toISOString() };
};

const subtractShopWorkDays = (date: Date, days: number): Date => {
    let remaining = Math.max(0, days);
    let current = new Date(date);

    while (remaining > 0) {
        current = addDays(current, -1);
        if (!isSunday(current) && !isSaturday(current)) {
            remaining -= 1;
        }
    }

    return current;
};

export const getDepartmentWindowForExport = (
    job: Job,
    dept: Department
): { start: Date; end: Date } | null => {
    const normalizedCurrentDept = normalizeDepartment(job.currentDepartment);
    const currentDeptIndex = normalizedCurrentDept ? DEPARTMENT_SEQUENCE.indexOf(normalizedCurrentDept) : -1;
    const targetDeptIndex = DEPARTMENT_SEQUENCE.indexOf(dept);

    // If the job has progressed beyond this department, this department is no longer active work.
    if (currentDeptIndex !== -1 && targetDeptIndex !== -1 && currentDeptIndex > targetDeptIndex) {
        return null;
    }

    // Match CustomGanttTable schedule precedence exactly.
    const schedule = job.remainingDepartmentSchedule || job.departmentSchedule;
    const window = getDepartmentWindow(schedule, dept) || getFallbackWindow(job, dept);

    if (!window) {
        return null;
    }

    // Match Gantt segment normalization exactly (startOfDay for both bounds).
    const start = startOfDay(new Date(window.start));
    const rawEnd = startOfDay(new Date(window.end));
    const endWithoutBuffer = subtractShopWorkDays(rawEnd, EXPORT_BUFFER_WORKDAYS);
    const end = endWithoutBuffer < start ? start : endWithoutBuffer;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    return { start, end };
};

export const isDepartmentScheduledInDateRange = (
    job: Job,
    dept: Department,
    dateRange: ExportDateRange
): boolean => {
    const window = getDepartmentWindowForExport(job, dept);
    if (!window) return false;

    const filterStart = dateRange.start ? startOfDay(dateRange.start) : null;
    const filterEnd = dateRange.end ? endOfDay(dateRange.end) : null;

    if (filterStart && window.end < filterStart) return false;
    if (filterEnd && window.start > filterEnd) return false;

    return true;
};
