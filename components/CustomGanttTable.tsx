'use client';

import React from 'react';

import { useMemo, useState, useEffect, useRef } from 'react';
import { addDays, format, startOfDay, isSameDay, startOfWeek, isWeekend, isSunday, isSaturday, differenceInCalendarDays } from 'date-fns';
import { Job, Department, SupervisorAlert } from '@/types';
import { DEPARTMENT_CONFIG, DEPT_ORDER, calculateDoorWeldingSubStages } from '@/lib/departmentConfig';
import { getBatchKeyForJob, BATCH_COHORT_WINDOW_BUSINESS_DAYS } from '@/lib/scheduler';
import SegmentEditPopover from './SegmentEditPopover';
import JobStatusSymbols from './JobStatusSymbols';
import JobConfigPopover from './JobConfigPopover';

interface DepartmentSegment {
    department: Department;
    startCol: number;
    duration: number;
    color: string;
    startDate: Date;
    endDate: Date;
    subStageLabel?: string;   // "P", "R", "T", "W" for door welding sub-stages
    subStageColor?: string;   // Override color for sub-stage
}

interface CustomGanttTableProps {
    jobs: Job[];
    startDate: Date;
    endDate: Date;
    columnWidth?: number;
    onJobClick?: (job: Job) => void;
    selectedJob?: Job | null;
    today?: Date;
    onSegmentUpdate?: (jobId: string, department: Department, newStart: Date, newEnd: Date) => Promise<void>;
    onJobShiftUpdate?: (jobId: string, deltaDays: number) => Promise<void>;
    onJobRangeUpdate?: (jobId: string, newStart: Date, newEnd: Date) => Promise<void>;
    onPriorityUpdate?: (jobId: string, department: Department, value: number | null) => Promise<void>;
    onNoGapsToggle?: (jobId: string, noGaps: boolean) => Promise<void>;
    onSkipDepartments?: (jobId: string, skipped: Department[]) => Promise<void>;
    priorityDepartment?: Department;
    visibleDepartments?: Set<Department>;
    showActiveOnly?: boolean;
    selectedDates?: Date[];
    onDateSelect?: (dates: Date[]) => void;
    alertsByJobId?: Record<string, SupervisorAlert[]>;
    onRescheduleRequest?: (jobId: string) => void;
    onPoDetailRequest?: (jobId: string) => void;
}

export default function CustomGanttTable({
    jobs,
    startDate,
    endDate,
    columnWidth = 40,
    onJobClick,
    selectedJob,
    today = new Date(),
    onSegmentUpdate,
    onJobShiftUpdate,
    onJobRangeUpdate,
    onPriorityUpdate,
    onNoGapsToggle,
    onSkipDepartments,
    priorityDepartment,
    visibleDepartments,
    showActiveOnly = false,
    selectedDates = [],
    onDateSelect,
    alertsByJobId = {},
    onRescheduleRequest,
    onPoDetailRequest
}: CustomGanttTableProps) {
    const [editingSegment, setEditingSegment] = useState<{
        job: Job;
        segment: DepartmentSegment;
        segmentIndex: number;
    } | null>(null);
    const [editingJobRange, setEditingJobRange] = useState<{
        job: Job;
        startValue: string;
        endValue: string;
    } | null>(null);
    const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
    const [isDragging, setIsDragging] = useState(false);
    const [openJobAlertInfoId, setOpenJobAlertInfoId] = useState<string | null>(null);
    const [openConfigJobId, setOpenConfigJobId] = useState<string | null>(null);
    const configButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const addVisibleDays = (date: Date, delta: number) => {
        if (delta === 0) return startOfDay(date);
        let remaining = delta;
        let cursor = startOfDay(date);
        const step = remaining > 0 ? 1 : -1;

        while (remaining !== 0) {
            cursor = addDays(cursor, step);
            if (!isSunday(cursor)) {
                remaining -= step;
            }
        }

        return cursor;
    };

    // Generate date columns
    const dateColumns = useMemo(() => {
        const dates: Date[] = [];
        let current = startOfDay(startDate);
        const end = startOfDay(endDate);

        while (current <= end) {
            if (!isSunday(current)) {
                dates.push(current);
            }
            current = addDays(current, 1);
        }

        return dates;
    }, [startDate, endDate]);

    const dateColumnKeys = useMemo(
        () => dateColumns.map((date) => date.toISOString().split('T')[0]),
        [dateColumns]
    );

    const dateIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        dateColumns.forEach((date, index) => {
            map.set(format(date, 'yyyy-MM-dd'), index);
        });
        return map;
    }, [dateColumns]);

    const getColIndex = (date: Date, direction: 'next' | 'prev') => {
        const normalized = startOfDay(date);
        const key = format(normalized, 'yyyy-MM-dd');
        if (dateIndexMap.has(key)) return dateIndexMap.get(key)!;

        let cursor = normalized;
        for (let i = 0; i < 7; i += 1) {
            cursor = addDays(cursor, direction === 'next' ? 1 : -1);
            const cursorKey = format(cursor, 'yyyy-MM-dd');
            if (dateIndexMap.has(cursorKey)) return dateIndexMap.get(cursorKey)!;
        }
        return null;
    };

    const earliestJobDate = useMemo(() => {
        if (!jobs.length) return startOfDay(startDate);
        return jobs.reduce((min, job) => {
            const raw = job.forecastStartDate || job.scheduledStartDate || job.dueDate;
            const normalized = startOfDay(raw);
            return normalized < min ? normalized : min;
        }, startOfDay(startDate));
    }, [jobs, startDate]);

    // Group dates by week for header
    const weekGroups = useMemo(() => {
        const groups: {
            weekLabel: string;
            startIndex: number;
            span: number;
            workdayDates: Date[];
        }[] = [];

        const weekMap = new Map<string, { startIndex: number; endIndex: number; dates: Date[] }>();

        dateColumns.forEach((date, index) => {
            const weekStart = startOfWeek(date, { weekStartsOn: 1 });
            const key = weekStart.toISOString();
            if (!weekMap.has(key)) {
                weekMap.set(key, { startIndex: index, endIndex: index, dates: [date] });
            } else {
                const entry = weekMap.get(key)!;
                entry.endIndex = index;
                entry.dates.push(date);
            }
        });

        Array.from(weekMap.entries())
            .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
            .forEach(([_, entry], idx) => {
                const span = entry.endIndex - entry.startIndex + 1;
                const workdayDates = entry.dates.filter(d => !isWeekend(d));
                const labelStart = entry.dates[0];
                const labelEnd = entry.dates[entry.dates.length - 1];
                let weekLabel = `${format(labelStart, 'MMM d')}–${format(labelEnd, 'MMM d')}`;
                if (labelEnd < earliestJobDate) {
                    weekLabel = '';
                } else if (labelStart < earliestJobDate) {
                    weekLabel = `${format(earliestJobDate, 'MMM d')}–${format(labelEnd, 'MMM d')}`;
                }
                groups.push({
                    weekLabel,
                    startIndex: entry.startIndex,
                    span,
                    workdayDates
                });
            });

        return groups;
    }, [dateColumns, earliestJobDate]);

    // Calculate bar position for a job
    const calculateBarPosition = (job: Job) => {
        const jobStart = startOfDay(job.forecastStartDate || job.scheduledStartDate || job.dueDate);
        const jobEnd = startOfDay(job.forecastDueDate || job.dueDate);

        const startCol = getColIndex(jobStart, 'next');
        const endCol = getColIndex(jobEnd, 'prev');
        if (startCol === null || endCol === null) {
            return { startCol: 0, duration: 0, isVisible: false };
        }
        const duration = endCol - startCol + 1;

        // Clamp to visible range
        const visibleStartCol = Math.max(0, startCol);
        const visibleEndCol = Math.min(dateColumns.length - 1, endCol);
        const visibleDuration = visibleEndCol - visibleStartCol + 1;

        return {
            startCol: visibleStartCol,
            duration: visibleDuration,
            isVisible: visibleDuration > 0 && visibleStartCol < dateColumns.length
        };
    };

    const getDepartmentColor = (dept: Department) => {
        return DEPARTMENT_CONFIG[dept]?.color || '#6b7280';
    };

    const getJobRange = (job: Job) => {
        const schedule = job.remainingDepartmentSchedule || job.departmentSchedule;
        if (schedule && Object.keys(schedule).length > 0) {
            const entries = Object.values(schedule)
                .map(d => ({
                    start: new Date(d.start),
                    end: new Date(d.end)
                }))
                .filter(d => !isNaN(d.start.getTime()) && !isNaN(d.end.getTime()));

            if (entries.length > 0) {
                const minStart = entries.reduce((min, d) => (d.start < min ? d.start : min), entries[0].start);
                const maxEnd = entries.reduce((max, d) => (d.end > max ? d.end : max), entries[0].end);
                return { start: startOfDay(minStart), end: startOfDay(maxEnd) };
            }
        }

        const fallbackStart = startOfDay(job.forecastStartDate || job.scheduledStartDate || job.dueDate);
        const fallbackEnd = startOfDay(job.forecastDueDate || job.dueDate);
        return { start: fallbackStart, end: fallbackEnd };
    };

    // Calculate department segments for multi-colored bars
    const calculateDepartmentSegments = (job: Job): DepartmentSegment[] => {
        const schedule = job.remainingDepartmentSchedule || job.departmentSchedule;

        // Fallback: if no schedule data, show single segment for current department
        if (!schedule || Object.keys(schedule).length === 0) {
            const barPosition = calculateBarPosition(job);
            if (!barPosition.isVisible) return [];

            return [{
                department: job.currentDepartment,
                startCol: barPosition.startCol,
                duration: barPosition.duration,
                color: getDepartmentColor(job.currentDepartment),
                startDate: job.forecastStartDate || job.scheduledStartDate || job.dueDate,
                endDate: job.forecastDueDate || job.dueDate
            }];
        }

        const segments: DepartmentSegment[] = [];

        Object.entries(schedule).forEach(([dept, dates]) => {
            // Filter by visible departments if specified
            if (visibleDepartments && visibleDepartments.size > 0 && !visibleDepartments.has(dept as Department)) {
                return; // Skip this department
            }

            const segmentStart = startOfDay(new Date(dates.start));
            const segmentEnd = startOfDay(new Date(dates.end));

            if (isNaN(segmentStart.getTime()) || isNaN(segmentEnd.getTime())) {
                return;
            }

            let startCol = getColIndex(segmentStart, 'next') ?? -1;
            let endCol = getColIndex(segmentEnd, 'prev') ?? -1;

            // Handle out of bounds
            if (startCol === -1) {
                // If start is before view, clamp to 0
                if (segmentStart < startDate) startCol = 0;
                else startCol = -1; // actually not found?
            }
            if (endCol === -1) {
                // If end is after view... wait, getColIndex implementation matters.
                // Assuming getColIndex returns -1 if not found.
                if (segmentEnd > endDate) endCol = dateColumns.length - 1;
                else endCol = -1;
            }

            // If completely out of range
            if (segmentEnd < startDate || segmentStart > endDate) {
                return;
            }

            // Re-calculate visible columns if needed (simple fallback)
            if (startCol === -1) startCol = 0;
            if (endCol === -1) endCol = dateColumns.length - 1;

            const duration = endCol - startCol + 1;

            // Clamp to visible range
            const visibleStartCol = Math.max(0, startCol);
            const visibleEndCol = Math.min(dateColumns.length - 1, endCol);
            const visibleDuration = visibleEndCol - visibleStartCol + 1;

            if (visibleDuration > 0 && visibleStartCol < dateColumns.length) {
                segments.push({
                    department: dept as Department,
                    startCol: visibleStartCol,
                    duration: visibleDuration,
                    color: getDepartmentColor(dept as Department),
                    startDate: segmentStart,
                    endDate: segmentEnd
                });
            }
        });

        // =====================================================================
        // DOOR WELDING SUB-PIPELINE — Split Welding segment into sub-stages
        // =====================================================================
        // Compute sub-stages at render time from job data (not stored on job)
        let subStages = job.weldingSubStages;
        const isFrame = job.productType === 'DOORS' && /\b(frame|fr|borrowed\s*light)/i.test(job.description || '');
        if (!subStages && job.productType === 'DOORS' && !isFrame && job.quantity && job.quantity > 0 && job.weldingPoints) {
            const pointsPerDoor = job.weldingPoints / job.quantity;
            const result = calculateDoorWeldingSubStages(job.quantity, pointsPerDoor, job.description || '', job.name || '');
            if (result) {
                subStages = result.stages;
            }
        }
        if (subStages && subStages.length > 0) {
            const weldingIdx = segments.findIndex(s => s.department === 'Welding');
            if (weldingIdx !== -1) {
                const weldingSeg = segments[weldingIdx];
                const totalSubDays = subStages.reduce((sum, s) => sum + s.durationDays, 0);
                const totalCols = weldingSeg.duration;

                // Only split if there are enough columns to display
                if (totalCols >= subStages.length) {
                    const subSegments: DepartmentSegment[] = [];
                    let colOffset = 0;

                    subStages.forEach((subStage, i) => {
                        const proportion = subStage.durationDays / totalSubDays;
                        // Last sub-stage gets remaining columns to avoid rounding gaps
                        const subCols = i === subStages!.length - 1
                            ? totalCols - colOffset
                            : Math.max(1, Math.round(totalCols * proportion));

                        subSegments.push({
                            department: 'Welding' as Department,
                            startCol: weldingSeg.startCol + colOffset,
                            duration: subCols,
                            color: subStage.color,
                            startDate: weldingSeg.startDate, // Approximate; stages share the welding window
                            endDate: weldingSeg.endDate,
                            subStageLabel: subStage.label,
                            subStageColor: subStage.color,
                        });

                        colOffset += subCols;
                    });

                    // Replace the single Welding segment with sub-segments
                    segments.splice(weldingIdx, 1, ...subSegments);
                }
            }
        }

        // Sort by start date to ensure chronological order
        return segments.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    };

    const buildDailyDeptMap = (job: Job) => {
        const schedule = job.remainingDepartmentSchedule || job.departmentSchedule;
        const map = new Map<string, Department[]>();
        if (!schedule) return map;

        Object.entries(schedule).forEach(([dept, dates]) => {
            // Respect isolated department view for overlap overlays.
            if (visibleDepartments && visibleDepartments.size > 0 && !visibleDepartments.has(dept as Department)) {
                return;
            }

            const start = startOfDay(new Date(dates.start));
            const end = startOfDay(new Date(dates.end));
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

            let cursor = new Date(start);
            while (cursor <= end) {
                const key = cursor.toISOString().split('T')[0];
                const list = map.get(key) || [];
                if (!list.includes(dept as Department)) list.push(dept as Department);
                map.set(key, list);
                cursor = addDays(cursor, 1);
            }
        });

        // Keep department order consistent
        map.forEach((list, key) => {
            list.sort((a, b) => DEPT_ORDER.indexOf(a) - DEPT_ORDER.indexOf(b));
            map.set(key, list);
        });

        return map;
    };

    const isJobScheduledInDepartmentOnDate = (job: Job, dept: Department, date: Date): boolean => {
        const schedule = job.remainingDepartmentSchedule?.[dept] || job.departmentSchedule?.[dept];
        if (!schedule) return false;

        const start = startOfDay(new Date(schedule.start));
        const end = startOfDay(new Date(schedule.end));
        const target = startOfDay(date);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;

        return target >= start && target <= end;
    };

    // Refs for High-Performance Animation Loop

    // Refs for High-Performance Animation Loop
    const dragStateRef = useRef<{
        jobId: string;
        segmentIndex: number;
        initialX: number;
        initialStartDate: Date;
        initialEndDate: Date;
        element: HTMLElement;
        mode: 'move' | 'resize';
        moveAll: boolean;
        edge?: 'start' | 'end';
        originalWidth: number;
        originalInlineWidth: string;
        originalInlineTransform: string;
        originalInlineTransition: string;
        originalInlineZIndex: string;
        originalInlineWillChange: string;
    } | null>(null);

    const requestRef = useRef<number | null>(null);
    const ignoreClickRef = useRef(false);

    // Clean up animation frame on unmount
    useEffect(() => {
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-alert-popover-root="true"]')) return;
            setOpenJobAlertInfoId(null);
        };

        const closeOnScroll = () => setOpenJobAlertInfoId(null);

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('scroll', closeOnScroll, true);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('scroll', closeOnScroll, true);
        };
    }, []);

    // Animation Loop
    const animate = () => {
        if (!dragStateRef.current) return;

        // We don't need to do anything here if we updated the DOM in mouseMove
        // But typically we batch DOM reads/writes here.
        // For simplicity in this case, direct DOM updates in mouseMove are often fast enough for this scale,
        // BUT requestAnimationFrame is safer for vsync.

        // Actually, let's keep it simple: handleMouseMove updates a ref "targetDelta", 
        // and animate applies it? 
        // Or just let mouseMove trigger simple transforms. 
        // Next.js/React overhead is the issue, so avoiding setState is key. 
        // Direct DOM manipulation in mouseMove is fine if lightweight.
    };

    const onMouseDown = (e: React.MouseEvent, job: Job, segment: DepartmentSegment, index: number, mode: 'move' | 'resize', edge?: 'start' | 'end') => {
        if ((!onSegmentUpdate && !onJobShiftUpdate) || e.button !== 0) return;

        e.preventDefault();
        e.stopPropagation();

        const moveAll = mode === 'move' && e.shiftKey && !!onJobShiftUpdate;

        const target = e.currentTarget as HTMLElement;
        let element = target;
        if (mode === 'resize') {
            element = target.closest('.job-bar-segment') as HTMLElement;
        }

        if (!element) return;

        // Capture initial state
        const rect = element.getBoundingClientRect();

        const inlineStyle = element.style;

        dragStateRef.current = {
            jobId: job.id,
            segmentIndex: index,
            initialX: e.clientX,
            initialStartDate: segment.startDate,
            initialEndDate: segment.endDate,
            element,
            mode,
            moveAll,
            edge,
            originalWidth: rect.width,
            originalInlineWidth: inlineStyle.width,
            originalInlineTransform: inlineStyle.transform,
            originalInlineTransition: inlineStyle.transition,
            originalInlineZIndex: inlineStyle.zIndex,
            originalInlineWillChange: inlineStyle.willChange
        };

        // Prepare element for hardware accelerated drag
        element.style.transition = 'none';
        element.style.zIndex = '1000';
        element.style.willChange = 'transform, width';
        element.classList.add('dragging');

        // Reset click ignore flag
        ignoreClickRef.current = false;

        setIsDragging(true);

        const handleMouseMove = (ev: MouseEvent) => {
            if (!dragStateRef.current) return;

            const state = dragStateRef.current;
            const deltaX = ev.clientX - state.initialX;

            // Only consider it a drag if moved more than 3px (prevents jitter)
            if (Math.abs(deltaX) > 3) {
                ignoreClickRef.current = true;
            }

            // Snap to column width for logic, but visual can be smooth or snapped
            // Let's do smooth visual for "premium" feel, but snap logic on release

            if (state.mode === 'move') {
                state.element.style.transform = `translate3d(${deltaX}px, 0, 0)`;
            } else {
                // Resize
                if (state.edge === 'end') {
                    state.element.style.width = `${state.originalWidth + deltaX}px`;
                } else if (state.edge === 'start') {
                    state.element.style.transform = `translate3d(${deltaX}px, 0, 0)`;
                    state.element.style.width = `${state.originalWidth - deltaX}px`;
                }
            }
        };

        const handleMouseUp = async (ev: MouseEvent) => {
            if (!dragStateRef.current) return;
            const state = dragStateRef.current;

            // Cleanup listeners
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            const deltaX = ev.clientX - state.initialX;
            const deltaDays = Math.round(deltaX / columnWidth); // Snap to visible days

            // Restore inline styles to pre-drag values.
            state.element.style.transition = state.originalInlineTransition;
            state.element.style.zIndex = state.originalInlineZIndex;
            state.element.style.willChange = state.originalInlineWillChange;
            state.element.style.transform = state.originalInlineTransform;
            state.element.style.width = state.originalInlineWidth;
            state.element.classList.remove('dragging');

            setIsDragging(false);
            dragStateRef.current = null;

            if (deltaDays !== 0 && ignoreClickRef.current) {
                const moveAll = state.moveAll || (state.mode === 'move' && ev.shiftKey && !!onJobShiftUpdate);
                if (moveAll) {
                    const shiftedStart = addVisibleDays(state.initialStartDate, deltaDays);
                    const calendarDelta = differenceInCalendarDays(shiftedStart, state.initialStartDate);
                    await onJobShiftUpdate?.(state.jobId, calendarDelta);
                } else if (state.mode === 'resize') {
                    let newStart = state.initialStartDate;
                    let newEnd = state.initialEndDate;

                    if (state.edge === 'start') {
                        newStart = addVisibleDays(state.initialStartDate, deltaDays);
                    } else if (state.edge === 'end') {
                        newEnd = addVisibleDays(state.initialEndDate, deltaDays);
                    }

                    if (differenceInCalendarDays(newEnd, newStart) >= 0) { // Allow 1 day (start=end)
                        await onSegmentUpdate?.(state.jobId, segment.department, newStart, newEnd);
                    }
                } else {
                    // Move
                    const newStart = addVisibleDays(state.initialStartDate, deltaDays);
                    const newEnd = addVisibleDays(state.initialEndDate, deltaDays);
                    await onSegmentUpdate?.(state.jobId, segment.department, newStart, newEnd);
                }
            }
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div className="custom-gantt-container">
            <table className="gantt-table">
                <thead>
                    {/* Week header row */}
                    <tr className="week-header-row">
                        <th className="sticky-corner" rowSpan={2}>
                            <div className="corner-content">
                                <div className="text-xs font-semibold">Job / Project</div>
                            </div>
                        </th>
                        {weekGroups.map((week, idx) => (
                            <th
                                key={idx}
                                colSpan={week.span}
                                className="week-header"
                                style={{ cursor: onDateSelect ? 'pointer' : 'default' }}
                                onClick={() => {
                                    if (!onDateSelect) return;
                                    const weekDates = week.workdayDates;
                                    if (weekDates.length === 0) return;

                                    const isSelected = weekDates.every(d =>
                                        selectedDates.some(s => isSameDay(s, d))
                                    );

                                    if (isSelected) {
                                        const remaining = selectedDates.filter(
                                            s => !weekDates.some(d => isSameDay(d, s))
                                        );
                                        onDateSelect(remaining);
                                    } else {
                                        const merged = [...selectedDates];
                                        weekDates.forEach(d => {
                                            if (!merged.some(s => isSameDay(s, d))) merged.push(d);
                                        });
                                        merged.sort((a, b) => a.getTime() - b.getTime());
                                        onDateSelect(merged);
                                    }
                                }}
                            >
                                {week.weekLabel}
                            </th>
                        ))}
                    </tr>
                    {/* Day header row */}
                    <tr className="day-header-row">
                        {dateColumns.map((date, colIndex) => {
                            const isToday = isSameDay(date, today);
                            const isSelected = selectedDates.some(d => isSameDay(d, date));
                            return (
                                <th
                                    key={colIndex}
                                    className={`date-header ${isSelected ? 'selected' : ''} ${isToday ? 'today-column' : ''} ${isSaturday(date) ? 'saturday-column' : ''}`}
                                    style={{
                                        minWidth: `${columnWidth}px`,
                                        width: `${columnWidth}px`,
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => {
                                        if (onDateSelect) {
                                            const shiftKey = (window.event as MouseEvent)?.shiftKey;
                                            let newDates: Date[];

                                            if (isSelected) {
                                                newDates = selectedDates.filter(d => !isSameDay(d, date));
                                            } else {
                                                newDates = [...selectedDates, date];
                                            }

                                            // Sort dates for better UX
                                            newDates.sort((a, b) => a.getTime() - b.getTime());
                                            onDateSelect(newDates);
                                        }
                                    }}
                                >
                                    <div className="date-content">
                                        {date < earliestJobDate ? (
                                            <div className="day-number opacity-0">0</div>
                                        ) : (
                                            <>
                                                <div className={`day-number ${isSelected ? 'text-indigo-300' : ''}`}>{format(date, 'd')}</div>
                                                <div className="day-name">{format(date, 'EEE').slice(0, 1)}</div>
                                            </>
                                        )}
                                    </div>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {(() => {
                        // Batch key: only the 8 defined categories are eligible for batching
                        // Key is category-only — all items of the same type batch together
                        // (the scheduler engine handles fine-grained gauge/material splitting internally)
                        // NOTE: This now uses the same composite key as the scheduler.
                        const getGanttBatchKey = (j: Job): string | null => getBatchKeyForJob(j);
                        const getGanttCohortKey = (j: Job): string | null => {
                            const key = getGanttBatchKey(j);
                            if (!key) return null;
                            return `${key}|DEPT:${j.currentDepartment || 'UNKNOWN'}`;
                        };

                        // Calculate 12 business days ahead from today
                        const addBusinessDays = (from: Date, days: number): Date => {
                            const result = new Date(from);
                            let count = 0;
                            while (count < days) {
                                result.setDate(result.getDate() + 1);
                                const dow = result.getDay();
                                if (dow !== 0 && dow !== 6) count++;
                            }
                            return result;
                        };
                        const batchWindowEnd = addBusinessDays(startOfDay(today), BATCH_COHORT_WINDOW_BUSINESS_DAYS);
                        const isolatedDepartment = visibleDepartments && visibleDepartments.size === 1
                            ? Array.from(visibleDepartments)[0]
                            : null;

                        // Filter jobs first
                        const filteredJobs = jobs.filter(job => {
                            if (!visibleDepartments || visibleDepartments.size === 0) return true;
                            const jobDeptIndex = DEPT_ORDER.indexOf(job.currentDepartment);
                            const visibleIndices = Array.from(visibleDepartments).map(d => DEPT_ORDER.indexOf(d));
                            const maxVisibleIndex = Math.max(...visibleIndices);

                            if (showActiveOnly) {
                                const isScheduledToday = Array.from(visibleDepartments).some(
                                    (dept) => isJobScheduledInDepartmentOnDate(job, dept, today)
                                );
                                const isCurrent = visibleDepartments.has(job.currentDepartment);
                                return isCurrent || isScheduledToday;
                            }
                            return jobDeptIndex <= maxVisibleIndex;
                        });

                        // Only batch jobs in Press Brake or earlier departments
                        const PRESS_BRAKE_INDEX = DEPT_ORDER.indexOf('Press Brake');
                        const isBatchEligible = (j: Job) => DEPT_ORDER.indexOf(j.currentDepartment) <= PRESS_BRAKE_INDEX;

                        // Count batches within 12-business-day window
                        const batchCounts: Record<string, number> = {};
                        filteredJobs.forEach(j => {
                            if (!isBatchEligible(j)) return;
                            const dueDate = new Date(j.dueDate);
                            if (dueDate > batchWindowEnd) return; // Outside 12 business day window
                            const key = getGanttCohortKey(j);
                            if (!key) return;
                            batchCounts[key] = (batchCounts[key] || 0) + 1;
                        });
                        // Build batch anchor dates: each batch group is positioned at
                        // its earliest member's due date so the group stays together
                        const batchAnchorDate: Record<string, number> = {};
                        filteredJobs.forEach(j => {
                            const key = getGanttCohortKey(j);
                            if (!key) return;
                            const count = batchCounts[key] || 0;
                            if (count < 2) return; // Not actually in a batch group
                            const due = new Date(j.dueDate).getTime();
                            if (!(key in batchAnchorDate) || due < batchAnchorDate[key]) {
                                batchAnchorDate[key] = due;
                            }
                        });

                        // Sort: batch groups anchored at earliest member's due date,
                        // then by individual due date within the group
                        const PRODUCT_TYPE_SORT: Record<string, number> = { DOORS: 0, FAB: 1, HARMONIC: 2 };
                        const sortedJobs = [...filteredJobs].sort((a, b) => {
                            // Primary: product type
                            const aType = PRODUCT_TYPE_SORT[a.productType || 'FAB'] ?? 1;
                            const bType = PRODUCT_TYPE_SORT[b.productType || 'FAB'] ?? 1;
                            if (aType !== bType) return aType - bType;

                            const aKey = getGanttCohortKey(a);
                            const bKey = getGanttCohortKey(b);
                            const aInBatch = aKey ? (batchCounts[aKey] || 0) >= 2 : false;
                            const bInBatch = bKey ? (batchCounts[bKey] || 0) >= 2 : false;

                            // Use anchor date for batched jobs, own due date for non-batch
                            const aAnchor = (aInBatch && aKey) ? batchAnchorDate[aKey] : new Date(a.dueDate).getTime();
                            const bAnchor = (bInBatch && bKey) ? batchAnchorDate[bKey] : new Date(b.dueDate).getTime();

                            // Different anchor dates (or different batch groups) → sort by anchor
                            if (aAnchor !== bAnchor) return aAnchor - bAnchor;

                            // Same batch group → keep together, sort by batch key then due date
                            if (aKey !== bKey) return (aKey || '').localeCompare(bKey || '');
                            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                        });

                        return sortedJobs.map((job, rowIndex) => {
                            const segments = calculateDepartmentSegments(job);
                            const segmentsByStartCol = new Map<number, Array<{ segment: DepartmentSegment; segIndex: number }>>();
                            segments.forEach((segment, segIndex) => {
                                const startSegments = segmentsByStartCol.get(segment.startCol);
                                if (startSegments) {
                                    startSegments.push({ segment, segIndex });
                                } else {
                                    segmentsByStartCol.set(segment.startCol, [{ segment, segIndex }]);
                                }
                            });
                            const dailyDeptMap = buildDailyDeptMap(job);
                            const isSelected = selectedJob?.id === job.id;
                            const jobAlerts = alertsByJobId[job.id] || [];

                            // Batch group detection — only for recognized categories in Press Brake or earlier
                            const batchKey = getGanttCohortKey(job);
                            const prevBatchKey = rowIndex > 0 ? getGanttCohortKey(sortedJobs[rowIndex - 1]) : null;
                            const jobEligible = isBatchEligible(job) && batchKey !== null;
                            const batchCount = (jobEligible && batchKey) ? (batchCounts[batchKey] || 0) : 0;
                            const inBatch = batchCount >= 2;
                            const isFirstInBatch = batchKey !== prevBatchKey && inBatch;
                            const productType = job.productType || 'FAB';
                            const batchAccent = productType === 'FAB' ? '#0ea5e9' : productType === 'DOORS' ? '#f59e0b' : '#8b5cf6';
                            const highlightActiveInIsolatedView = !!isolatedDepartment && !showActiveOnly;
                            const isCurrentInIsolatedDept = isolatedDepartment
                                ? job.currentDepartment === isolatedDepartment
                                : false;

                            return (
                                <React.Fragment key={job.id}>
                                    {isFirstInBatch && (
                                        <tr className="batch-header-row">
                                            <td
                                                colSpan={dateColumns.length + 1}
                                                style={{ borderLeft: `3px solid ${batchAccent}` }}
                                                className="px-3 py-1 bg-slate-100 border-b border-slate-300"
                                            >
                                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: batchAccent }}>
                                                    ⚙️ Batch: {job.description || productType} — {batchCount} items
                                                </span>
                                                <span className="text-[9px] text-slate-500 font-mono italic ml-2">· Run together</span>
                                            </td>
                                        </tr>
                                    )}
                                    <tr
                                        className={`job-row ${isSelected ? 'row-selected' : ''}`}
                                    >
                                        <td
                                            className="sticky-job-cell"
                                            onClick={() => onJobClick?.(job)}
                                            style={inBatch ? { borderRight: `3px solid ${batchAccent}` } : undefined}
                                        >
                                            <div className="job-cell-content">
                                                <div className="flex items-center gap-1.5 overflow-visible relative">
                                                    <div className="job-name flex-1 min-w-0 cursor-pointer text-black font-bold"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onJobClick?.(job);
                                                        }}
                                                    >
                                                        {job.name}
                                                    </div>
                                                    {jobAlerts.length > 0 && (
                                                        <div className="relative" data-alert-popover-root="true">
                                                            <button
                                                                ref={(el) => {
                                                                    if (el && openJobAlertInfoId === job.id) {
                                                                        const rect = el.getBoundingClientRect();
                                                                        const popoverEl = el.nextElementSibling as HTMLElement | null;
                                                                        if (popoverEl) {
                                                                            popoverEl.style.top = `${rect.bottom + 4}px`;
                                                                            popoverEl.style.left = `${Math.max(8, rect.right - 280)}px`;
                                                                        }
                                                                    }
                                                                }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setOpenJobAlertInfoId(prev => prev === job.id ? null : job.id);
                                                                }}
                                                                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-red-600 border border-red-700 text-white font-extrabold shadow-sm hover:bg-red-700 transition-colors"
                                                                title={`${jobAlerts.length} active supervisor alert${jobAlerts.length > 1 ? 's' : ''}`}
                                                            >
                                                                ! {jobAlerts.length}
                                                            </button>
                                                            {openJobAlertInfoId === job.id && (
                                                                <div
                                                                    className="fixed w-[280px] rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
                                                                    style={{ zIndex: 9999 }}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <div className="px-3 py-2 border-b border-slate-700 text-[11px] font-bold">
                                                                        Active Alerts ({jobAlerts.length})
                                                                    </div>
                                                                    <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-2">
                                                                        {jobAlerts.map((alertItem) => (
                                                                            <div key={alertItem.id} className="rounded border border-slate-700 bg-slate-800/70 p-2 text-[10px] leading-relaxed">
                                                                                <div className="text-red-300 font-semibold">
                                                                                    {alertItem.department} - resolve by {format(new Date(alertItem.estimatedResolutionDate), 'M/d')}
                                                                                </div>
                                                                                <div className="text-slate-200 mt-0.5">{alertItem.reason}</div>
                                                                                {alertItem.lastAdjustmentAt && (
                                                                                    <div className="text-indigo-200 mt-1">
                                                                                        Adjusted {format(new Date(alertItem.lastAdjustmentAt), 'M/d h:mm a')}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {/* Status Symbols — clickable with explanation popovers */}
                                                    <JobStatusSymbols
                                                        job={job}
                                                        alerts={jobAlerts}
                                                        onRescheduleRequest={onRescheduleRequest}
                                                        onPoDetailRequest={onPoDetailRequest}
                                                    />
                                                </div>
                                                <div
                                                    className="job-id font-extrabold tracking-wide opacity-100"
                                                    style={{ color: '#1f2937', fontSize: '12px', lineHeight: '1.1' }}
                                                >
                                                    {job.id}
                                                </div>
                                                <div className="text-[11px] text-black font-semibold mt-0.5 truncate leading-tight">
                                                    {job.description || 'No description'}
                                                </div>
                                                {job.customerPartAndName && job.customerPartAndName.length > 0 && (
                                                    <div className="text-[10px] text-slate-600 font-medium truncate leading-tight" title={`Item #: ${job.customerPartAndName.join(', ')}`}>
                                                        Item #: {job.customerPartAndName.join(', ')}
                                                    </div>
                                                )}
                                                <div className="flex justify-between items-center mt-1.5 text-[11px] text-black font-mono">
                                                    <span className={differenceInCalendarDays(job.dueDate, today) < 0 ? "text-red-600 font-bold" : ""}>
                                                        Due: {format(job.dueDate, 'M/d')}
                                                    </span>
                                                    <span className="bg-slate-300 border border-slate-400 px-1.5 py-0.5 rounded text-[11px] text-black font-bold">
                                                        {Math.round(job.weldingPoints || 0)} pts
                                                    </span>
                                                </div>
                                                {onNoGapsToggle && onSkipDepartments && (
                                                    <div className="mt-1.5 relative">
                                                        <button
                                                            ref={(el) => {
                                                                if (el) configButtonRefs.current.set(job.id, el);
                                                                else configButtonRefs.current.delete(job.id);
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setOpenConfigJobId(prev => prev === job.id ? null : job.id);
                                                            }}
                                                            className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${openConfigJobId === job.id
                                                                ? 'bg-blue-100 border-blue-300 text-blue-700 font-semibold'
                                                                : (job.noGaps || (job.skippedDepartments && job.skippedDepartments.length > 0))
                                                                    ? 'bg-blue-50 border-blue-200 text-blue-600 font-semibold'
                                                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                                                }`}
                                                            title="Schedule configuration"
                                                        >
                                                            ⚙ Config{job.noGaps ? ' · No Gaps' : ''}{job.skippedDepartments && job.skippedDepartments.length > 0 ? ` · ${job.skippedDepartments.length} skipped` : ''}
                                                        </button>
                                                        {openConfigJobId === job.id && (
                                                            <JobConfigPopover
                                                                job={job}
                                                                anchorRef={{ current: configButtonRefs.current.get(job.id) || null }}
                                                                onNoGapsToggle={onNoGapsToggle}
                                                                onSkipDepartments={onSkipDepartments}
                                                                onClose={() => setOpenConfigJobId(null)}
                                                            />
                                                        )}
                                                    </div>
                                                )}
                                                {showActiveOnly && priorityDepartment && onPriorityUpdate && (
                                                    <div className="mt-2 flex items-center gap-2">
                                                        <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">
                                                            Priority #
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            value={
                                                                priorityDrafts[job.id] ??
                                                                (job.priorityByDept?.[priorityDepartment]?.value?.toString() || '')
                                                            }
                                                            onChange={(e) => {
                                                                setPriorityDrafts(prev => ({ ...prev, [job.id]: e.target.value }));
                                                            }}
                                                            onBlur={async (e) => {
                                                                const raw = e.target.value.trim();
                                                                if (!raw) {
                                                                    await onPriorityUpdate(job.id, priorityDepartment, null);
                                                                    return;
                                                                }
                                                                const num = Number(raw);
                                                                if (!Number.isNaN(num)) {
                                                                    await onPriorityUpdate(job.id, priorityDepartment, num);
                                                                }
                                                            }}
                                                            className="w-16 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-700"
                                                            placeholder="-"
                                                        />
                                                    </div>
                                                )}
                                                {onJobRangeUpdate && (
                                                    <div className="mt-2">
                                                        {editingJobRange?.job.id === job.id ? (
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="date"
                                                                    value={editingJobRange.startValue}
                                                                    onChange={(e) => setEditingJobRange({ ...editingJobRange, startValue: e.target.value })}
                                                                    className="w-[110px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-700"
                                                                />
                                                                <span className="text-[10px] text-slate-400">-</span>
                                                                <input
                                                                    type="date"
                                                                    value={editingJobRange.endValue}
                                                                    onChange={(e) => setEditingJobRange({ ...editingJobRange, endValue: e.target.value })}
                                                                    className="w-[110px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-700"
                                                                />
                                                                <button
                                                                    className="px-2 py-0.5 rounded text-[10px] bg-blue-600 text-white hover:bg-blue-500"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        const start = new Date(editingJobRange.startValue);
                                                                        const end = new Date(editingJobRange.endValue);
                                                                        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && start <= end) {
                                                                            await onJobRangeUpdate(job.id, startOfDay(start), startOfDay(end));
                                                                        }
                                                                        setEditingJobRange(null);
                                                                    }}
                                                                >
                                                                    Save
                                                                </button>
                                                                <button
                                                                    className="px-2 py-0.5 rounded text-[10px] border border-slate-200 text-slate-600 hover:bg-slate-100"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingJobRange(null);
                                                                    }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                className="px-2 py-0.5 rounded text-[10px] border border-slate-200 text-slate-600 hover:bg-slate-100"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const range = getJobRange(job);
                                                                    setEditingJobRange({
                                                                        job,
                                                                        startValue: format(range.start, 'yyyy-MM-dd'),
                                                                        endValue: format(range.end, 'yyyy-MM-dd')
                                                                    });
                                                                }}
                                                            >
                                                                Set Start/End
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        {dateColumns.map((date, colIndex) => {
                                            const isToday = isSameDay(date, today);
                                            const startSegments = segmentsByStartCol.get(colIndex);
                                            const hasSegmentStart = !!startSegments;
                                            const dateKey = dateColumnKeys[colIndex];
                                            const dayDepts = dailyDeptMap.get(dateKey) || [];
                                            const hasOverlap = dayDepts.length > 1;

                                            return (
                                                <td
                                                    key={colIndex}
                                                    className={`date-cell ${hasSegmentStart ? 'has-segment' : ''} ${isToday ? 'today-column' : ''} ${isSaturday(date) ? 'saturday-column' : ''}`}
                                                    style={{ minWidth: `${columnWidth}px`, width: `${columnWidth}px` }}
                                                >
                                                    {hasOverlap && (
                                                        <div className="day-split-overlay">
                                                            {dayDepts.map((dept) => (
                                                                <div
                                                                    key={`${job.id}-${dateKey}-${dept}`}
                                                                    className="day-split-segment"
                                                                    style={{ backgroundColor: getDepartmentColor(dept) }}
                                                                />
                                                            ))}
                                                        </div>
                                                    )}
                                                    {startSegments?.map(({ segment, segIndex }) => {
                                                        const isActiveCurrentSegment =
                                                            highlightActiveInIsolatedView &&
                                                            isCurrentInIsolatedDept &&
                                                            segment.department === isolatedDepartment;

                                                        return (
                                                            <div
                                                                key={segIndex}
                                                                className={`job-bar-segment relative group/bar-tooltip ${isActiveCurrentSegment ? 'job-bar-segment-active-isolated' : ''}`}
                                                                style={{
                                                                    width: `${segment.duration * columnWidth - 4}px`,
                                                                    backgroundColor: segment.color,
                                                                    borderColor: segment.color,
                                                                    left: `${2}px`,
                                                                    zIndex: 20 + segIndex,
                                                                    cursor: onJobShiftUpdate ? 'grab' : 'default', // Shift+drag moves all
                                                                    transition: 'all 0.3s ease'
                                                                }}
                                                                onMouseDown={(e) => onMouseDown(e, job, segment, segIndex, 'move')}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (isDragging || ignoreClickRef.current) return;
                                                                    if (onSegmentUpdate) {
                                                                        setEditingSegment({ job, segment, segmentIndex: segIndex });
                                                                    } else {
                                                                        onJobClick?.(job);
                                                                    }
                                                                }}
                                                            >
                                                                {/* ── Sub-stage label (P/R/T/W) ── */}
                                                                {segment.subStageLabel && (
                                                                    <span className="absolute inset-0 flex items-center justify-center z-[2] text-[11px] font-black text-white pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                                                                        {segment.subStageLabel}
                                                                    </span>
                                                                )}
                                                                {/* ── Nesting-ready indicator (N) ── */}
                                                                {!segment.subStageLabel && job.readyToNest && segment.department === 'Engineering' && (
                                                                    <span className="absolute inset-0 flex items-center justify-center z-[2] text-[11px] font-black text-white pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">
                                                                        N
                                                                    </span>
                                                                )}

                                                                {/* ── Progress Overlay (supervisor-reported) ── */}
                                                                {(() => {
                                                                    // For welding sub-stages, read station-specific progress
                                                                    if (segment.subStageLabel && segment.department === 'Welding') {
                                                                        const stageKey = segment.subStageLabel === 'P' ? 'press' : segment.subStageLabel === 'R' ? 'robot' : null;
                                                                        const progress = stageKey ? (job.weldingStationProgress as any)?.[stageKey] : null;
                                                                        if (progress && progress > 0) {
                                                                            return (
                                                                                <div
                                                                                    className="absolute inset-0 z-[1] pointer-events-none overflow-hidden rounded-[inherit]"
                                                                                    style={{ width: `${Math.min(progress, 100)}%` }}
                                                                                >
                                                                                    <div className="absolute inset-0 bg-white/85" />
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }
                                                                    // Standard department progress
                                                                    const progress = job.departmentProgress?.[segment.department];
                                                                    if (progress && progress > 0 && job.currentDepartment === segment.department) {
                                                                        return (
                                                                            <div
                                                                                className="absolute inset-0 z-[1] pointer-events-none overflow-hidden rounded-[inherit]"
                                                                                style={{ width: `${Math.min(progress, 100)}%` }}
                                                                            >
                                                                                <div className="absolute inset-0 bg-white/85" />
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}
                                                                {/* ── Progress % label inside bar ── */}
                                                                {(() => {
                                                                    // Welding sub-stage: show station-specific progress
                                                                    if (segment.subStageLabel && segment.department === 'Welding') {
                                                                        const stageKey = segment.subStageLabel === 'P' ? 'press' : segment.subStageLabel === 'R' ? 'robot' : null;
                                                                        const progress = stageKey ? (job.weldingStationProgress as any)?.[stageKey] : null;
                                                                        if (progress && progress > 0) {
                                                                            return (
                                                                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 z-[3] text-[10px] font-black pointer-events-none whitespace-nowrap text-black">
                                                                                    {progress}%
                                                                                </span>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }
                                                                    // Standard department progress
                                                                    const progress = job.departmentProgress?.[segment.department];
                                                                    if (progress && progress > 0 && job.currentDepartment === segment.department) {
                                                                        return (
                                                                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 z-[3] text-[10px] font-black pointer-events-none whitespace-nowrap text-black">
                                                                                {progress}%
                                                                            </span>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}

                                                                {/* Bar Tooltip — department & dates */}
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/bar-tooltip:block pointer-events-none w-max">
                                                                    <div className="px-2.5 py-1.5 bg-slate-800 text-white rounded shadow-xl text-xs whitespace-nowrap">
                                                                        <span className="font-bold">{segment.subStageLabel ? `Welding: ${segment.subStageLabel === 'P' ? 'Press' : segment.subStageLabel === 'R' ? 'Robot' : segment.subStageLabel === 'T' ? 'Tube Frame' : 'Full Weld'}` : segment.department}</span>
                                                                        <span className="text-slate-400 ml-2">{format(segment.startDate, 'M/d')} – {format(segment.endDate, 'M/d')}</span>
                                                                        {segment.subStageLabel && job.quantity && (
                                                                            <span className="text-amber-300 ml-2 font-semibold">{job.quantity} doors</span>
                                                                        )}
                                                                        {/* Sub-stage station progress in tooltip */}
                                                                        {segment.subStageLabel && segment.department === 'Welding' && (() => {
                                                                            const stageKey = segment.subStageLabel === 'P' ? 'press' : segment.subStageLabel === 'R' ? 'robot' : null;
                                                                            const pct = stageKey ? (job.weldingStationProgress as any)?.[stageKey] : null;
                                                                            return pct != null ? <span className="text-emerald-300 ml-2 font-bold">{pct}% done</span> : null;
                                                                        })()}
                                                                        {/* Standard dept progress in tooltip */}
                                                                        {!segment.subStageLabel && job.departmentProgress?.[segment.department] != null && job.currentDepartment === segment.department && (
                                                                            <span className="text-emerald-300 ml-2 font-bold">{job.departmentProgress[segment.department]}% done</span>
                                                                        )}
                                                                        {job.readyToNest && segment.department === 'Engineering' && (
                                                                            <span className="text-lime-300 ml-2 font-bold">Nesting Ready</span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Resize handle - start */}
                                                                {onSegmentUpdate && (
                                                                    <div
                                                                        className="segment-resize-handle segment-resize-start"
                                                                        onMouseDown={(e) => onMouseDown(e, job, segment, segIndex, 'resize', 'start')}
                                                                        title="Drag to adjust start date"
                                                                    />
                                                                )}

                                                                {/* Resize handle - end */}
                                                                {onSegmentUpdate && (
                                                                    <div
                                                                        className="segment-resize-handle segment-resize-end"
                                                                        onMouseDown={(e) => onMouseDown(e, job, segment, segIndex, 'resize', 'end')}
                                                                        title="Drag to adjust end date"
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    })}

                                                    {/* Job name label - below the bars */}
                                                    {segments.length > 0 && colIndex === segments[0].startCol && (
                                                        <div className="bar-label-below">
                                                            {job.name}
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </React.Fragment>
                            );
                        });
                    })()}
                </tbody>
            </table>

            {/* Segment Edit Popover */}
            {editingSegment && onSegmentUpdate && (
                <div
                    className="popover-overlay"
                    onClick={() => setEditingSegment(null)}
                >
                    <div
                        className="popover-container"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <SegmentEditPopover
                            department={editingSegment.segment.department}
                            startDate={editingSegment.segment.startDate}
                            endDate={editingSegment.segment.endDate}
                            onSave={async (newStart, newEnd) => {
                                await onSegmentUpdate(
                                    editingSegment.job.id,
                                    editingSegment.segment.department,
                                    newStart,
                                    newEnd
                                );
                                setEditingSegment(null);
                            }}
                            onCancel={() => setEditingSegment(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

