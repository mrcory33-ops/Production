import { useMemo } from 'react';
import { Job, Department, ProductType } from '@/types';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

export interface ExportFilters {
    dateRange: {
        start: Date | null;
        end: Date | null;
    };
    productTypes: Set<ProductType>;
    bigRocksOnly: boolean;
    departments: Set<Department>;
}

export function usePdfExportFilter(
    jobs: Job[],
    filters: ExportFilters
): Record<Department, Job[]> {
    return useMemo(() => {
        // 1. Initial Filtering
        const filtered = jobs.filter(job => {
            // Date Range Filter (based on Due Date)
            if (filters.dateRange.start && filters.dateRange.end) {
                const jobDate = startOfDay(new Date(job.dueDate));
                const start = startOfDay(filters.dateRange.start);
                const end = endOfDay(filters.dateRange.end);

                if (!isWithinInterval(jobDate, { start, end })) {
                    return false;
                }
            } else if (filters.dateRange.start) {
                // Open-ended start? Usually assume range is required.
                const jobDate = startOfDay(new Date(job.dueDate));
                if (jobDate < startOfDay(filters.dateRange.start)) return false;
            }

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
    // Prefer remaining schedule so completed departments are not exported as active work.
    const hasRemainingSchedule = !!job.remainingDepartmentSchedule && Object.keys(job.remainingDepartmentSchedule).length > 0;
    const schedule = hasRemainingSchedule ? job.remainingDepartmentSchedule : job.departmentSchedule;
    const deptWindow = schedule?.[dept];

    // If no schedule metadata exists, only include the job for its current department.
    if (!deptWindow) {
        return job.currentDepartment === dept;
    }

    const deptStart = startOfDay(new Date(deptWindow.start));
    const deptEnd = endOfDay(new Date(deptWindow.end));

    if (Number.isNaN(deptStart.getTime()) || Number.isNaN(deptEnd.getTime())) {
        return job.currentDepartment === dept;
    }

    const filterStart = dateRange.start ? startOfDay(dateRange.start) : null;
    const filterEnd = dateRange.end ? endOfDay(dateRange.end) : null;

    if (filterStart && deptEnd < filterStart) return false;
    if (filterEnd && deptStart > filterEnd) return false;

    return true;
}
