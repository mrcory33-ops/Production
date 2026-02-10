import { useMemo } from 'react';
import { Job, Department, ProductType } from '@/types';
import { getDepartmentWindowForExport, isDepartmentScheduledInDateRange } from '@/lib/exportSchedule';

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
                if (isDepartmentScheduledInDateRange(job, dept, filters.dateRange)) {
                    grouped[dept].push(job);
                }
            });
        });

        // 3. Sorting
        filters.departments.forEach(dept => {
            grouped[dept].sort((a, b) => {
                const aWindow = getDepartmentWindowForExport(a, dept);
                const bWindow = getDepartmentWindowForExport(b, dept);
                const aStart = aWindow ? aWindow.start.getTime() : Number.MAX_SAFE_INTEGER;
                const bStart = bWindow ? bWindow.start.getTime() : Number.MAX_SAFE_INTEGER;

                if (aStart !== bStart) return aStart - bStart;
                return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
            });
        });

        return grouped;
    }, [jobs, filters]);
}
