import { useMemo } from 'react';
import { Job, Department, ProductType } from '@/types';
import { startOfDay, endOfDay } from 'date-fns';

export interface ExportFilters {
    dateRange: {
        start: Date | null;
        end: Date | null;
    };
    productTypes: Set<ProductType>;
    bigRocksOnly: boolean;
    departments: Set<Department>;
}

const DEPARTMENT_SEQUENCE: Department[] = [
    'Engineering',
    'Laser',
    'Press Brake',
    'Welding',
    'Polishing',
    'Assembly',
];

export function usePdfExportFilter(
    jobs: Job[],
    filters: ExportFilters
): Record<Department, Job[]> {
    return useMemo(() => {
        // 1. Initial Filtering
        const filtered = jobs.filter(job => {
            // Product Type Filter
            if (!filters.productTypes.has(job.productType)) {
                return false;
            }

            // Job Category (Big Rocks) Filter
            if (filters.bigRocksOnly) {
                const points = job.weldingPoints || 0;
                if (points < 60) return false; // Big Rocks threshold
            }

            return true;
        });

        // 2. Grouping by Department
        // We initialize with empty arrays for all selected departments to ensure they appear even if empty
        const grouped: Record<Department, Job[]> = {} as Record<Department, Job[]>;
        filters.departments.forEach(dept => {
            grouped[dept] = [];
        });

        filtered.forEach(job => {
            // For each selected department, check if this job is relevant
            filters.departments.forEach(dept => {
                if (hasWorkForDept(job, dept, filters.dateRange)) {
                    grouped[dept].push(job);
                }
            });
        });

        // 3. Sorting
        filters.departments.forEach(dept => {
            grouped[dept].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        });

        return grouped;
    }, [jobs, filters]);
}

function hasWorkForDept(
    job: Job,
    dept: Department,
    dateRange: { start: Date | null; end: Date | null }
): boolean {
    const normalizedCurrentDept = normalizeDepartment(job.currentDepartment);
    const currentDeptIndex = normalizedCurrentDept ? DEPARTMENT_SEQUENCE.indexOf(normalizedCurrentDept) : -1;
    const targetDeptIndex = DEPARTMENT_SEQUENCE.indexOf(dept);

    // If a job has already progressed beyond this department, it is not active work for that department.
    if (currentDeptIndex !== -1 && targetDeptIndex !== -1 && currentDeptIndex > targetDeptIndex) {
        return false;
    }

    // Prefer remaining schedule so completed departments are not exported as active work.
    const hasRemainingSchedule = !!job.remainingDepartmentSchedule && Object.keys(job.remainingDepartmentSchedule).length > 0;
    const schedule = hasRemainingSchedule
        ? job.remainingDepartmentSchedule
        : (job.departmentSchedule || job.remainingDepartmentSchedule);
    const deptWindow = getDepartmentWindow(schedule, dept) || getFallbackWindow(job, dept);

    if (!deptWindow) {
        return false;
    }

    const deptStart = startOfDay(new Date(deptWindow.start));
    const deptEnd = endOfDay(new Date(deptWindow.end));

    if (Number.isNaN(deptStart.getTime()) || Number.isNaN(deptEnd.getTime())) {
        return false;
    }

    const filterStart = dateRange.start ? startOfDay(dateRange.start) : null;
    const filterEnd = dateRange.end ? endOfDay(dateRange.end) : null;

    if (filterStart && deptEnd < filterStart) return false;
    if (filterEnd && deptStart > filterEnd) return false;

    return true;
}

function normalizeDepartment(value: string | undefined): Department | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    return DEPARTMENT_SEQUENCE.find((dept) => dept.toLowerCase() === normalized) || null;
}

function getDepartmentWindow(
    schedule: Job['departmentSchedule'] | Job['remainingDepartmentSchedule'] | undefined,
    dept: Department
): { start: string; end: string } | null {
    if (!schedule) return null;

    const direct = schedule[dept];
    if (direct) return direct;

    for (const [key, value] of Object.entries(schedule)) {
        if (normalizeDepartment(key) === dept) {
            return value;
        }
    }

    return null;
}

function getFallbackWindow(
    job: Job,
    dept: Department
): { start: string; end: string } | null {
    if (normalizeDepartment(job.currentDepartment) !== dept) {
        return null;
    }

    const startCandidate = job.scheduledStartDate || job.forecastStartDate || job.dueDate;
    const endCandidate = job.scheduledEndDate || job.forecastDueDate || job.dueDate;

    const start = new Date(startCandidate);
    const end = new Date(endCandidate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    return { start: start.toISOString(), end: end.toISOString() };
}
