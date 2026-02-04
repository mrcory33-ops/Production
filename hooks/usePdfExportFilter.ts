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
        const grouped: Record<string, Job[]> = {};
        filters.departments.forEach(dept => {
            grouped[dept] = [];
        });

        // Distribute jobs to departments based on filters
        // Logic: A job belongs to a department schedule if it has a schedule entry for that department?
        // OR: requirements say "iterate through user's selected departments and create isolated sections for each".
        // "Table contains only Welding tasks for those dates."
        // A job might pass through multiple departments.
        // If the export is "Schedule", it likely implies "what is happening in this department in this date range".
        // HOWEVER, the standard Job object implies a linear flow or a "currentDepartment".
        // But for a schedule view, we might want to know if the job *is scheduled* in that department during that window.
        // `job.departmentSchedule` contains `{ [deptName]: { start, end } }`.

        filtered.forEach(job => {
            // For each selected department, check if this job is relevant
            filters.departments.forEach(dept => {
                // If we strictly follow "Due Date" filtering (as requested in Req 1: "Date Selection"),
                // it implies we list jobs *due* in that range.
                // Or does it mean "scheduled to be worked on"?
                // Req 2 says: "If the user selects Welding... Table contains only Welding tasks for those dates."
                // "Welding tasks for those dates" implies interaction with `departmentSchedule`.

                // Let's look at `job.departmentSchedule`.
                // If `job.departmentSchedule[dept]` exists, and its range overlaps with our filter range?
                // OR simplicity: List jobs that are DUE in the range, and show them in the department sections if they pass through that department.
                // Given "Requirement 1: Date Selection... Validation constraint: Max 30 days", and "Requirement 3: Columns... Due Date",
                // simpler interpretation: Filter by Job Due Date, then list in every relevant department?
                // PROBABLY simpler: Filter by Job Due Date. 
                // Then place job in every department selected? 
                // Or place job in "Current Department"?
                // The prompt says: "create isolated sections ... Table contains only Welding tasks".
                // Usually "Welding Schedule" means "What does the Welding department need to do".
                // If a job is past Welding (e.g. in Assembly), it shouldn't appear in Welding schedule even if due date matches?
                // Let's assume: A job appears in a Department section if:
                // 1. It is currently IN that department OR scheduled for it?
                // Given the fields `currentDepartment` and `departmentSchedule`.

                // Let's look at the `types/index.ts` again.
                // `currentDepartment` is where it is now.
                // `departmentSchedule` is calculated schedule.

                // DECISION: To be robust and professional, "Welding Schedule" should list jobs that are either:
                // - Typically: Currently IN Welding or Coming to Welding.
                // BUT, simplest implementation first:
                // If the user filters by a Date Range (Due Date), we list jobs due then.
                // If a job goes through Welding, it appears in Welding list.
                // Check if `DEPT_ORDER` includes the dept? All jobs go through most depts?
                // No, `calculateDepartmentSegments` logic in `CustomGanttTable` suggests flow.
                // `job.weldingPoints > 0` implies it hits Welding.
                // Let's rely on points or "relevant to department".
                // In `DEPARTMENT_CONFIG`, there are pools logic.
                // Let's assume if it has points/work for that department, it belongs there.
                // OR simpler: Just categorize by `currentDepartment`? No, that would miss upcoming work.

                // COMPROMISE for "Export Schedule":
                // List jobs due in range.
                // Include in Department Section if:
                // - It has non-zero points/duration for that department?
                // OR
                // - It is simply filtered by the Global filters. 
                // The logical "split" is just presenting the SAME list of jobs under different headers? 
                // That seems redundant if it's the specific "Welding Tasks".
                // Re-reading Req 2: "Table contains *only* Welding tasks".
                // Maybe it means "the portion of the schedule relevant to Welding"?
                // But the columns (Job #, Name, Desc, Due Date, Point Value) are job-level.
                // Point Value is generic in the column list "e.g., Welding Points".

                // REFINED LOGIC:
                // 1. Filter jobs by Due Date (global filter).
                // 2. For "Welding Section", show jobs that have > 0 Welding Points. Show "Welding Points" in the Points column.
                // 3. For "Assembly Section", show jobs that go through Assembly. Show "Assembly Points"? (Assembly usually calc'd by points too, or fixed).
                // 4. If a job skips a dept, it shouldn't appear there.

                // Let's implement helper `hasWorkForDept(job, dept)`.
                if (hasWorkForDept(job, dept)) {
                    grouped[dept].push(job);
                }
            });
        });

        // 3. Sorting
        Object.keys(grouped).forEach(dept => {
            grouped[dept].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        });

        return grouped;
    }, [jobs, filters]);
}

function hasWorkForDept(job: Job, dept: Department): boolean {
    // Logic derived from how PlanningBoard filters/shows segments
    // Simplest proxy: does it have points?
    // Welding: weldingPoints > 0
    // Others: usually implied by product type or points, but let's look at `job` fields.
    // `job.weldingPoints` is explicit.
    // Other depts might not have explicit point fields in `Job` interface.
    // `Job` interface: `weldingPoints: number;`
    // It doesn't seem to store points for other departments explicitly in the top-level `Job`.
    // However, `departmentSchedule` might exist.

    // Fallback: If `departmentSchedule` has an entry for this dept, it's relevant.
    if (job.departmentSchedule && job.departmentSchedule[dept]) {
        return true;
    }

    // If no schedule yet (active/pending?), check points for Welding specifically.
    if (dept === 'Welding') return (job.weldingPoints || 0) > 0;

    // For others, assume all jobs go through Engineering, Shipping?
    // Let's assume defaults for now if schedule missing.
    // Ideally, we rely on `departmentSchedule` presence.
    // If `departmentSchedule` is missing, maybe checking `currentDepartment` or just include all?
    // Let's use: if `departmentSchedule` exists, use it.
    // Else, use a simple `true` for now (catch-all) or check Product Type applicability.

    // Safe bet: Include all filtered jobs in all selected sections if we can't determine exclusion.
    // Better: Welding is critical, so use weldingPoints.

    return true;
}
