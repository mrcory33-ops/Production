'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { addDays, differenceInDays, format, startOfDay, isSameDay } from 'date-fns';
import { Job, Department } from '@/types';
import { DEPARTMENT_CONFIG, DEPT_ORDER } from '@/lib/departmentConfig';
import SegmentEditPopover from './SegmentEditPopover';

interface DepartmentSegment {
    department: Department;
    startCol: number;
    duration: number;
    color: string;
    startDate: Date;
    endDate: Date;
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
    visibleDepartments?: Set<Department>;
    showActiveOnly?: boolean;
    selectedDates?: Date[];
    onDateSelect?: (dates: Date[]) => void;
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
    visibleDepartments,
    showActiveOnly = false,
    selectedDates = [],
    onDateSelect
}: CustomGanttTableProps) {
    const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
    const [editingSegment, setEditingSegment] = useState<{
        job: Job;
        segment: DepartmentSegment;
        segmentIndex: number;
    } | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Generate date columns
    const dateColumns = useMemo(() => {
        const dates: Date[] = [];
        let current = startOfDay(startDate);
        const end = startOfDay(endDate);

        while (current <= end) {
            dates.push(current);
            current = addDays(current, 1);
        }

        return dates;
    }, [startDate, endDate]);

    // Group dates by week for header
    const weekGroups = useMemo(() => {
        const groups: { weekLabel: string; startIndex: number; span: number }[] = [];
        let currentWeek = -1;
        let weekStart = 0;

        dateColumns.forEach((date, index) => {
            const weekNum = Math.floor(differenceInDays(date, startDate) / 7);

            if (weekNum !== currentWeek) {
                if (currentWeek !== -1) {
                    groups.push({
                        weekLabel: `WEEK${currentWeek + 1}`,
                        startIndex: weekStart,
                        span: index - weekStart
                    });
                }
                currentWeek = weekNum;
                weekStart = index;
            }
        });

        // Add final week
        if (currentWeek !== -1) {
            groups.push({
                weekLabel: `WEEK${currentWeek + 1}`,
                startIndex: weekStart,
                span: dateColumns.length - weekStart
            });
        }

        return groups;
    }, [dateColumns, startDate]);

    // Calculate bar position for a job
    const calculateBarPosition = (job: Job) => {
        const jobStart = startOfDay(job.forecastStartDate || job.scheduledStartDate || job.dueDate);
        const jobEnd = startOfDay(job.forecastDueDate || job.dueDate);

        const startCol = differenceInDays(jobStart, startDate);
        const endCol = differenceInDays(jobEnd, startDate);
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
            if (visibleDepartments && !visibleDepartments.has(dept as Department)) {
                return; // Skip this department
            }

            const segmentStart = startOfDay(new Date(dates.start));
            const segmentEnd = startOfDay(new Date(dates.end));

            const startCol = differenceInDays(segmentStart, startDate);
            const endCol = differenceInDays(segmentEnd, startDate);
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

        // Sort by start date to ensure chronological order
        return segments.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
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
        edge?: 'start' | 'end';
        originalWidth: number;
    } | null>(null);

    const requestRef = useRef<number | null>(null);
    const ignoreClickRef = useRef(false);

    // Clean up animation frame on unmount
    useEffect(() => {
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
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
        if (!onSegmentUpdate || e.button !== 0) return;

        e.preventDefault();
        e.stopPropagation();

        const target = e.currentTarget as HTMLElement;
        let element = target;
        if (mode === 'resize') {
            element = target.closest('.job-bar-segment') as HTMLElement;
        }

        if (!element) return;

        // Capture initial state
        const rect = element.getBoundingClientRect();

        dragStateRef.current = {
            jobId: job.id,
            segmentIndex: index,
            initialX: e.clientX,
            initialStartDate: segment.startDate,
            initialEndDate: segment.endDate,
            element,
            mode,
            edge,
            originalWidth: rect.width
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
            const deltaDays = Math.round(deltaX / columnWidth); // Snap to days

            // Revert styles (React will take over on re-render)
            // But we must wait for state update to complete? 
            // Better to keep them until React updates?
            // If we remove transform now, valid position might jump back before React updates.
            // But we can't easily wait for React. 
            // Solution: We optimistically assume onSegmentUpdate triggers a prop update.
            // For now, clear styles.
            state.element.style.transition = '';
            state.element.style.zIndex = '';
            state.element.style.willChange = '';
            state.element.style.transform = '';
            state.element.style.width = ''; // revert to prop-driven width
            state.element.classList.remove('dragging');

            setIsDragging(false);
            dragStateRef.current = null;

            if (deltaDays !== 0) {
                if (state.mode === 'resize') {
                    let newStart = state.initialStartDate;
                    let newEnd = state.initialEndDate;

                    if (state.edge === 'start') {
                        newStart = addDays(state.initialStartDate, deltaDays);
                    } else if (state.edge === 'end') {
                        newEnd = addDays(state.initialEndDate, deltaDays);
                    }

                    if (differenceInDays(newEnd, newStart) >= 0) { // Allow 1 day (start=end)
                        await onSegmentUpdate(state.jobId, segment.department, newStart, newEnd);
                    }
                } else {
                    // Move
                    const newStart = addDays(state.initialStartDate, deltaDays);
                    const newEnd = addDays(state.initialEndDate, deltaDays);
                    await onSegmentUpdate(state.jobId, segment.department, newStart, newEnd);
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
                                    className={`date-header ${hoveredCell?.col === colIndex ? 'col-hover' : ''} ${isToday ? 'today-column' : ''} ${isSelected ? 'bg-indigo-500/20 text-indigo-200 border-b-indigo-500' : ''}`}
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
                                        <div className={`day-number ${isSelected ? 'text-indigo-300' : ''}`}>{format(date, 'd')}</div>
                                        <div className="day-name">{format(date, 'EEE').slice(0, 1)}</div>
                                    </div>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody onMouseLeave={() => setHoveredCell(null)}>
                    {jobs
                        .filter(job => {
                            if (!visibleDepartments || visibleDepartments.size === 0) return true;

                            const jobDeptIndex = DEPT_ORDER.indexOf(job.currentDepartment);

                            // Find the furthest downstream department selected
                            // (e.g. if Laser selected, index is 1. We want 0 and 1)
                            const visibleIndices = Array.from(visibleDepartments).map(d => DEPT_ORDER.indexOf(d));
                            const maxVisibleIndex = Math.max(...visibleIndices);

                            // Active Only (ON): Show jobs currently IN selected depts OR scheduled for today in them
                            if (showActiveOnly) {
                                const isCurrent = visibleDepartments.has(job.currentDepartment);

                                // Also check if scheduled for today in any visible department
                                const normalizedToday = startOfDay(today);
                                const isScheduledToday = Array.from(visibleDepartments).some(dept => {
                                    const schedule = job.departmentSchedule?.[dept] || job.remainingDepartmentSchedule?.[dept];
                                    if (!schedule) return false;

                                    // Normalize all dates to start of day for accurate comparison
                                    const start = startOfDay(new Date(schedule.start));
                                    const end = startOfDay(new Date(schedule.end));

                                    return normalizedToday >= start && normalizedToday <= end;
                                });

                                return isCurrent || isScheduledToday;
                            }

                            // All Jobs (OFF): Pipeline View (Upstream + Current)
                            // Show if job is in selected department OR upstream of it
                            return jobDeptIndex <= maxVisibleIndex;
                        })
                        .map((job, rowIndex) => {
                            const segments = calculateDepartmentSegments(job);
                            const isSelected = selectedJob?.id === job.id;

                            return (
                                <tr
                                    key={job.id}
                                    className={`job-row ${hoveredCell?.row === rowIndex ? 'row-hover' : ''} ${isSelected ? 'row-selected' : ''}`}
                                >
                                    <td
                                        className="sticky-job-cell"
                                        onClick={() => onJobClick?.(job)}
                                    >
                                        <div className="job-cell-content">
                                            <div className="job-name">{job.name}</div>
                                            <div className="job-id">{job.id}</div>
                                            <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                                                {job.description || 'No description'}
                                            </div>
                                            <div className="flex justify-between items-center mt-1.5 text-[9px] text-slate-400 font-mono">
                                                <span className={differenceInDays(job.dueDate, today) < 0 ? "text-red-400 font-bold" : ""}>
                                                    Due: {format(job.dueDate, 'M/d')}
                                                </span>
                                                <span className="bg-slate-800 px-1 py-px rounded text-slate-300">
                                                    {Math.round(job.weldingPoints || 0)} pts
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    {dateColumns.map((date, colIndex) => {
                                        const isToday = isSameDay(date, today);

                                        return (
                                            <td
                                                key={colIndex}
                                                className={`date-cell ${hoveredCell?.col === colIndex ? 'col-hover' : ''} ${isToday ? 'today-column' : ''}`}
                                                style={{ minWidth: `${columnWidth}px`, width: `${columnWidth}px` }}
                                                onMouseEnter={() => setHoveredCell({ row: rowIndex, col: colIndex })}
                                            >
                                                {segments.map((segment, segIndex) => {
                                                    // Standard rendering without react-state drag offset
                                                    const visualOffset = 0;
                                                    // Note: We no longer shift based on state, but transform directly in DOM.

                                                    if (colIndex === segment.startCol) {
                                                        return (
                                                            <div
                                                                key={segIndex}
                                                                className="job-bar-segment"
                                                                style={{
                                                                    width: `${segment.duration * columnWidth - 4}px`,
                                                                    backgroundColor: segment.color,
                                                                    borderColor: segment.color,
                                                                    left: `${2}px`,
                                                                    zIndex: segIndex,
                                                                    cursor: 'grab', // Always grab, changes to grabbing via class
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
                                                    }
                                                    return null;
                                                })}

                                                {/* Job label overlay - spans all segments */}
                                                {segments.length > 0 && colIndex === segments[0].startCol && (
                                                    <div
                                                        className="job-label-overlay"
                                                        style={{
                                                            width: `${segments.reduce((sum, seg) => sum + seg.duration, 0) * columnWidth - 4}px`,
                                                            left: '2px'
                                                        }}
                                                    >
                                                        <span className="bar-label">
                                                            {job.name}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
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
