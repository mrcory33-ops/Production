'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore - Frappe Gantt has no types
import Gantt from 'frappe-gantt';
import { collection, query, where, getDocs, limit, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Job, Department } from '@/types';
import { applyRemainingSchedule } from '@/lib/scheduler';
import { calculateDailyLoads, detectBottlenecks } from '@/lib/analytics';
import { DEPARTMENT_CONFIG, PRODUCT_TYPE_ICONS } from '@/lib/departmentConfig';
import { addDays, differenceInCalendarDays, differenceInCalendarMonths, format, startOfDay } from 'date-fns';
import { AlertTriangle, Calendar, Filter, Maximize, Minimize, Activity } from 'lucide-react';

const DEPT_ORDER: Department[] = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

const getRowSizing = (rowCount: number, isFullScreen: boolean, viewportHeight: number) => {
    const base = { barHeight: 20, padding: 8 };
    if (!isFullScreen || !viewportHeight || rowCount === 0) return base;

    const headerAllowance = 56;
    const available = Math.max(viewportHeight - headerAllowance, 0);
    const idealRowHeight = Math.floor(available / rowCount);

    if (idealRowHeight <= 26) return base;

    const rowHeight = Math.min(idealRowHeight, 56);
    const barHeight = Math.max(18, Math.min(rowHeight - 6, 48));
    const padding = Math.max(4, rowHeight - barHeight);

    return { barHeight, padding };
};

const getDurationUnits = (start: Date, end: Date, viewMode: string) => {
    if (viewMode === 'Month') {
        const months = differenceInCalendarMonths(end, start);
        return Math.max(1, months + 1);
    }

    const days = Math.max(1, differenceInCalendarDays(end, start) || 1);
    if (viewMode === 'Week') {
        return Math.max(1, Math.ceil(days / 7));
    }

    return days;
};

const getLabelForZoom = (
    job: Job,
    start: Date,
    end: Date,
    viewMode: string,
    columnWidth: number
) => {
    const durationUnits = getDurationUnits(start, end, viewMode);
    const barWidth = Math.max(durationUnits * columnWidth, columnWidth);
    const maxChars = Math.max(0, Math.floor((barWidth - 10) / 7));

    if (maxChars <= 2) {
        return job.id ? job.id.slice(-maxChars) : '';
    }
    if (maxChars <= 4) {
        return job.id ? job.id.slice(-maxChars) : '';
    }

    const baseLabel = job.name || job.id;
    if (baseLabel.length <= maxChars) return baseLabel;
    if (maxChars <= 3) return baseLabel.slice(0, maxChars);
    return `${baseLabel.slice(0, Math.max(maxChars - 3, 1)).trimEnd()}...`;
};

const toDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
};

const getProgress = (dept: Department) => {
    const index = DEPT_ORDER.indexOf(dept);
    if (index < 0) return dept === 'Shipping' ? 100 : 0;
    return Math.round((index / DEPT_ORDER.length) * 100);
};

const scaleSchedule = (
    schedule: Record<string, { start: string; end: string }>,
    newStart: Date,
    newEnd: Date
) => {
    const entries = Object.entries(schedule)
        .map(([dept, dates]) => ({
            dept,
            start: new Date(dates.start),
            end: new Date(dates.end)
        }))
        .filter(entry => !isNaN(entry.start.getTime()) && !isNaN(entry.end.getTime()));

    if (!entries.length) return {};

    const oldStart = entries.reduce((min, entry) => (entry.start < min ? entry.start : min), entries[0].start);
    const oldEnd = entries.reduce((max, entry) => (entry.end > max ? entry.end : max), entries[0].end);
    const oldLength = Math.max(oldEnd.getTime() - oldStart.getTime(), 1);
    const newLength = Math.max(newEnd.getTime() - newStart.getTime(), 1);
    const scale = newLength / oldLength;

    const updated: Record<string, { start: string; end: string }> = {};

    entries.forEach(entry => {
        const offset = entry.start.getTime() - oldStart.getTime();
        const duration = entry.end.getTime() - entry.start.getTime();
        const nextStart = new Date(newStart.getTime() + offset * scale);
        const nextEnd = new Date(nextStart.getTime() + duration * scale);
        updated[entry.dept] = { start: nextStart.toISOString(), end: nextEnd.toISOString() };
    });

    return updated;
};

export default function PlanningBoard() {
    const containerRef = useRef<HTMLDivElement>(null);
    const ganttRef = useRef<HTMLDivElement>(null);
    const ganttInstanceRef = useRef<any>(null);
    const lastScrollLeftRef = useRef(0);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode] = useState('Day');
    const [columnWidth, setColumnWidth] = useState(40);
    const [showSmallRocks, setShowSmallRocks] = useState(true);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [performanceMode, setPerformanceMode] = useState(false);
    const [ganttViewportHeight, setGanttViewportHeight] = useState(0);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [capacityAlerts, setCapacityAlerts] = useState<any[]>([]);
    const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
    const [today] = useState(() => startOfDay(new Date()));
    const [visibleDepartments, setVisibleDepartments] = useState<Set<Department>>(new Set(DEPT_ORDER));
    const [splitByProductType, setSplitByProductType] = useState(false);

    const renderPopup = (ctx: any) => {
        const job = ctx.task._job as Job;
        if (!job) return '';

        return `
            <div class="p-3 bg-slate-900 border border-cyan-500/30 shadow-xl rounded-lg min-w-[220px]">
                <div class="font-bold text-white mb-1 border-b border-slate-700 pb-1">${job.name}</div>
                <div class="text-xs text-slate-300 mb-2">Points: ${job.weldingPoints?.toFixed(1) || 0}</div>
                <div class="text-xs text-slate-400">Dept: <span class="text-cyan-400">${job.currentDepartment}</span></div>
                <div class="text-xs text-slate-400 mt-1">Due: <span class="text-emerald-400">${format(new Date(job.dueDate), 'MMM d')}</span></div>
                <div class="text-xs text-slate-400 mt-1">Forecast: <span class="text-yellow-400">${job.forecastDueDate ? format(new Date(job.forecastDueDate), 'MMM d') : 'TBD'}</span></div>
            </div>
        `;
    };

    useEffect(() => {
        const handleFullScreenChange = () => {
            const isActive = document.fullscreenElement === containerRef.current;
            setIsFullScreen(isActive);
        };

        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
    }, []);

    useEffect(() => {
        const target = ganttRef.current;
        if (!target || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            setGanttViewportHeight(Math.round(entry.contentRect.height));
        });

        observer.observe(target);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const q = query(
                    collection(db, 'jobs'),
                    where('status', 'in', ['PENDING', 'IN_PROGRESS']),
                    limit(200)
                );

                const snapshot = await getDocs(q);
                const fetched: Job[] = [];

                snapshot.forEach(docSnap => {
                    const data = docSnap.data() as Job;
                    fetched.push({
                        ...data,
                        dueDate: toDate(data.dueDate) || new Date(),
                        scheduledStartDate: toDate(data.scheduledStartDate),
                        forecastStartDate: toDate(data.forecastStartDate),
                        forecastDueDate: toDate(data.forecastDueDate)
                    });
                });

                setJobs(fetched);
            } catch (err) {
                console.error('Failed to fetch jobs for planning', err);
            } finally {
                setLoading(false);
            }
        };

        fetchJobs();
    }, []);

    const displayJobs = useMemo(() => {
        let filtered = showSmallRocks
            ? jobs
            : jobs.filter(j => j.isPriority || (j.weldingPoints || 0) >= 70);

        // Filter by visible departments
        filtered = filtered.filter(job => {
            // If all departments are visible, show all jobs
            if (visibleDepartments.size === DEPT_ORDER.length) return true;

            // Otherwise, only show jobs in visible departments
            return visibleDepartments.has(job.currentDepartment);
        });

        return filtered.map(job => {
            if (job.remainingDepartmentSchedule && job.forecastDueDate && job.forecastStartDate) {
                return job;
            }
            return applyRemainingSchedule(job, today);
        });
    }, [jobs, showSmallRocks, today, visibleDepartments]);

    useEffect(() => {
        if (!selectedJob) return;
        const updated = jobs.find(job => job.id === selectedJob.id);
        if (updated && updated !== selectedJob) {
            setSelectedJob(updated);
        }
    }, [jobs, selectedJob?.id]);

    useEffect(() => {
        if (!displayJobs.length) {
            setCapacityAlerts([]);
            return;
        }

        const jobsForLoad = displayJobs.map(job => ({
            ...job,
            departmentSchedule: job.remainingDepartmentSchedule || job.departmentSchedule
        }));

        const rangeStart = today;
        const rangeEnd = addDays(rangeStart, 21);
        const loads = calculateDailyLoads(jobsForLoad, rangeStart, rangeEnd);
        const alerts = detectBottlenecks(loads, splitByProductType);

        setCapacityAlerts(alerts);
    }, [displayJobs, today]);

    useEffect(() => {
        if (!ganttRef.current || loading || displayJobs.length === 0) return;

        const { barHeight, padding } = getRowSizing(displayJobs.length, isFullScreen, ganttViewportHeight);

        // Create one task per job, colored by current department
        const tasks = displayJobs.map(job => {
            const deptSchedule = job.remainingDepartmentSchedule || job.departmentSchedule;
            const currentDept = job.currentDepartment;
            const config = DEPARTMENT_CONFIG[currentDept];
            const productIcon = PRODUCT_TYPE_ICONS[job.productType || 'FAB'] || '';

            // Use overall job start/end dates
            const startDate = job.forecastStartDate || job.scheduledStartDate || job.dueDate;
            const endDate = job.forecastDueDate || job.dueDate;
            const safeStart = startDate && endDate && startDate > endDate ? endDate : startDate;
            const safeEnd = startDate && endDate && startDate > endDate ? startDate : endDate;
            const displayEnd = safeEnd ? addDays(safeEnd, 1) : today;

            // Create label with product icon and job info
            const label = `${productIcon} ${getLabelForZoom(job, safeStart || today, displayEnd, viewMode, columnWidth)}`;

            return {
                id: job.id,
                name: label,
                start: format(safeStart || today, 'yyyy-MM-dd'),
                end: format(displayEnd, 'yyyy-MM-dd'),
                progress: getProgress(job.currentDepartment),
                dependencies: '',
                custom_class: config.colorClass,
                _job: job,
                _dept: currentDept
            };
        });

        try {
            if (!ganttInstanceRef.current) {
                ganttRef.current.innerHTML = '';
                ganttInstanceRef.current = new Gantt(ganttRef.current, tasks, {
                    view_mode: viewMode,
                    date_format: 'YYYY-MM-DD',
                    column_width: columnWidth,
                    snap_at: '1d',
                    auto_move_label: true,
                    popup_on: performanceMode ? 'click' : 'hover',
                    readonly_progress: true,
                    infinite_padding: true,
                    bar_height: barHeight,
                    padding,
                    popup: performanceMode ? false : renderPopup,
                    on_click: (task: any) => {
                        setSelectedJob(task._job || null);
                    },
                    on_date_change: async (task: any, start: Date, end: Date) => {
                        const job = task._job as Job;
                        if (!job) return;

                        const normalizedToday = today;
                        const normalizedStart = startOfDay(start);
                        const normalizedEndDate = startOfDay(end);
                        const durationMs = Math.max(addDays(normalizedEndDate, 1).getTime() - normalizedStart.getTime(), 0);

                        let newStart = normalizedStart;
                        let newEndDate = normalizedEndDate;

                        if (newStart < normalizedToday) {
                            newStart = normalizedToday;
                            const newEndExclusive = new Date(newStart.getTime() + durationMs);
                            newEndDate = addDays(startOfDay(newEndExclusive), -1);
                        }

                        const baseSchedule = job.remainingDepartmentSchedule || job.departmentSchedule;
                        const newEndExclusive = addDays(newEndDate, 1);
                        const updatedSchedule = baseSchedule && Object.keys(baseSchedule).length
                            ? scaleSchedule(baseSchedule, newStart, newEndExclusive)
                            : applyRemainingSchedule(job, newStart).remainingDepartmentSchedule || {};

                        const updatePayload = {
                            forecastStartDate: newStart,
                            forecastDueDate: newEndDate,
                            remainingDepartmentSchedule: updatedSchedule,
                            updatedAt: new Date()
                        };

                        setUpdatingJobId(job.id);
                        try {
                            await updateDoc(doc(db, 'jobs', job.id), updatePayload);
                            setJobs(prev => prev.map(item => item.id === job.id ? { ...item, ...updatePayload } : item));
                        } catch (err) {
                            console.error('Failed to update schedule', err);
                        } finally {
                            setUpdatingJobId(null);
                        }
                    }
                });
            } else {
                const container = ganttInstanceRef.current.$container;
                if (container) {
                    lastScrollLeftRef.current = container.scrollLeft;
                }

                ganttInstanceRef.current.options.column_width = columnWidth;
                ganttInstanceRef.current.options.bar_height = barHeight;
                ganttInstanceRef.current.options.padding = padding;
                ganttInstanceRef.current.options.auto_move_label = !performanceMode;
                ganttInstanceRef.current.options.popup_on = performanceMode ? 'click' : 'hover';
                ganttInstanceRef.current.options.popup = performanceMode ? false : renderPopup;
                ganttInstanceRef.current.options.scroll_to = null;
                ganttInstanceRef.current.refresh(tasks);

                if (container) {
                    container.scrollLeft = lastScrollLeftRef.current;
                }
            }
        } catch (err) {
            console.error('Planning Gantt init failed', err);
        }
    }, [displayJobs, loading, viewMode, columnWidth, isFullScreen, ganttViewportHeight, today, performanceMode, visibleDepartments]);

    useEffect(() => {
        if (ganttInstanceRef.current) {
            ganttInstanceRef.current.options.column_width = columnWidth;
            ganttInstanceRef.current.change_view_mode(viewMode, true);
        }
    }, [viewMode, columnWidth]);

    const handleToggleFullScreen = async () => {
        const container = containerRef.current;
        if (!container) return;

        const nextFullScreen = !isFullScreen;
        setIsFullScreen(nextFullScreen);

        if (nextFullScreen) {
            if (container.requestFullscreen) {
                try {
                    await container.requestFullscreen();
                } catch (err) {
                    console.warn('Fullscreen request failed', err);
                }
            }
        } else if (document.fullscreenElement) {
            try {
                await document.exitFullscreen();
            } catch (err) {
                console.warn('Exit fullscreen failed', err);
            }
        }
    };

    if (loading) {
        return <div className="text-cyan-500 animate-pulse">Loading Planning Board...</div>;
    }

    if (!displayJobs.length) {
        return <div className="text-slate-400">No scheduled jobs found.</div>;
    }

    return (
        <div
            ref={containerRef}
            className={`w-full transition-all duration-300 ${isFullScreen ? 'gantt-fullscreen fixed inset-0 z-50 bg-slate-950 p-4 h-screen overflow-hidden flex flex-col' : ''} ${performanceMode ? 'gantt-performance' : ''}`}
        >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-8 bg-cyan-500 rounded-full inline-block"></span>
                        Planning Board
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">Remaining schedule bars reflect current department progress.</p>
                </div>

                <div className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-lg border border-slate-800">
                    <button
                        onClick={handleToggleFullScreen}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        title="Toggle Full Screen"
                    >
                        {isFullScreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>

                    <div className="w-px h-6 bg-slate-700"></div>

                    <button
                        onClick={() => setShowSmallRocks(!showSmallRocks)}
                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-medium border transition-all ${showSmallRocks
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]'
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                            }`}
                    >
                        <Filter className="w-3 h-3" />
                        {showSmallRocks ? 'All Jobs' : 'Big Rocks Only'}
                    </button>

                    <div className="w-px h-6 bg-slate-700"></div>

                    <button
                        onClick={() => setPerformanceMode(!performanceMode)}
                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-medium border transition-all ${performanceMode
                            ? 'bg-amber-500/20 text-amber-200 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                            }`}
                        title="Reduce visual effects for smoother dragging"
                    >
                        Performance
                    </button>

                    <div className="w-px h-6 bg-slate-700"></div>

                    <button
                        onClick={() => setSplitByProductType(!splitByProductType)}
                        className={`flex items-center gap-2 px-3 py-1 rounded text-xs font-medium border transition-all ${splitByProductType
                            ? 'bg-purple-500/20 text-purple-200 border-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.25)]'
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                            }`}
                        title="Split capacity by product type (Welding/Polishing)"
                    >
                        <Activity className="w-3 h-3" />
                        Product Split
                    </button>

                    <div className="w-px h-6 bg-slate-700"></div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Zoom</span>
                        <input
                            type="range"
                            min="5"
                            max="60"
                            value={columnWidth}
                            onChange={(e) => setColumnWidth(Number(e.target.value))}
                            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>
                </div>
            </div>

            {/* Department Filter Pills */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold mr-2">Departments:</span>
                {DEPT_ORDER.map(dept => {
                    const isVisible = visibleDepartments.has(dept);
                    const isWelding = dept === 'Welding';
                    return (
                        <button
                            key={dept}
                            onClick={() => {
                                setVisibleDepartments(prev => {
                                    const next = new Set(prev);
                                    if (next.has(dept)) next.delete(dept);
                                    else next.add(dept);
                                    return next;
                                });
                            }}
                            className={`px-3 py-1 rounded text-xs font-medium transition-all border ${isVisible
                                ? isWelding
                                    ? 'bg-red-500/20 text-red-200 border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                                : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
                                }`}
                        >
                            {isWelding && isVisible && '❤️ '}{dept}
                        </button>
                    );
                })}
            </div>

            {/* Department Color Legend */}
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-slate-800">
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold mr-1">Color Key:</span>
                {DEPT_ORDER.map(dept => {
                    const config = DEPARTMENT_CONFIG[dept];
                    const isWelding = dept === 'Welding';
                    return (
                        <div key={dept} className="flex items-center gap-1.5">
                            <div
                                className="w-3 h-3 rounded-sm"
                                style={{
                                    backgroundColor: config.color,
                                    boxShadow: isWelding ? '0 0 6px rgba(239, 68, 68, 0.5)' : 'none'
                                }}
                            ></div>
                            <span className="text-xs text-slate-400">{dept}</span>
                        </div>
                    );
                })}
            </div>

            <div className={`${isFullScreen ? 'flex-1 min-h-0' : ''} grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4`}>
                <div
                    className={`gantt-target glass-panel rounded-xl min-w-[800px] overflow-auto custom-scrollbar ${isFullScreen ? 'flex-1 min-h-0 h-full w-full rounded-none border-none p-2' : 'p-4 h-[calc(100vh-260px)]'}`}
                    ref={ganttRef}
                ></div>

                {!isFullScreen && (
                    <aside className="space-y-4">
                        <div className="glass-panel p-4 rounded-xl">
                            <h3 className="text-sm font-semibold text-white mb-3">Selected Job</h3>
                            {selectedJob ? (
                                <div className="space-y-2 text-xs text-slate-300">
                                    <div className="text-white font-semibold text-sm">{selectedJob.name}</div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">WO</span>
                                        <span className="font-mono text-cyan-400">{selectedJob.id}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Dept</span>
                                        <span>{selectedJob.currentDepartment}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Due</span>
                                        <span>{format(new Date(selectedJob.dueDate), 'M/d/yy')}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Forecast</span>
                                        <span className="text-yellow-300">
                                            {selectedJob.forecastDueDate ? format(new Date(selectedJob.forecastDueDate), 'M/d/yy') : 'TBD'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Points</span>
                                        <span>{Math.round(selectedJob.weldingPoints || 0)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Status</span>
                                        <span>{selectedJob.status}</span>
                                    </div>
                                    {updatingJobId === selectedJob.id && (
                                        <div className="text-xs text-cyan-400 mt-3">Saving schedule update...</div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs text-slate-500">Click a bar to view details.</div>
                            )}
                        </div>

                        <div className="glass-panel p-4 rounded-xl border border-red-500/20 bg-red-950/10">
                            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                                <AlertTriangle className="w-4 h-4 text-red-400" />
                                Capacity Alerts
                            </h3>
                            {capacityAlerts.length === 0 ? (
                                <div className="text-xs text-emerald-400 flex items-center gap-2">
                                    <Calendar className="w-3 h-3" />
                                    No overloads in the next 3 weeks.
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                                    {capacityAlerts.slice(0, 8).map((alert, idx) => (
                                        <div key={`${alert.department}-${idx}`} className="bg-slate-900/80 p-2 rounded border border-red-500/30">
                                            <div className="flex items-center justify-between text-xs text-slate-300">
                                                <span className="text-red-200 font-semibold">{alert.department}</span>
                                                <span className="font-mono text-red-400">{format(alert.date, 'M/d')}</span>
                                            </div>
                                            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                                                <span>Overload</span>
                                                <span className="text-red-300 font-semibold">+{Math.round(alert.overload)} pts</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </aside>
                )}
            </div>

            <style jsx global>{`
                .gantt .grid-header { fill: transparent; stroke: rgba(51, 65, 85, 0.5); stroke-width: 1; }
                .gantt .grid-row { fill: transparent; stroke: rgba(51, 65, 85, 0.35); stroke-width: 1; }
                .gantt .row-line { stroke: rgba(51, 65, 85, 0.4); }
                .gantt .tick { stroke: rgba(51, 65, 85, 0.4); }
                .gantt text { fill: #94a3b8; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
                .gantt-target { background: #020617; }
                .gantt-target svg { width: auto !important; min-width: 100%; }
                .gantt .bar-label { fill: #e2e8f0; font-size: 12px; font-weight: 500; letter-spacing: 0.2px; }
                .gantt .bar-wrapper:hover .bar-label { fill: #fff; }
                .gantt .bar-label.big { display: none; }
                .gantt-performance .bar-label { display: none; }
                .gantml-performance .gantt .bar-wrapper:hover .bar-label { display: none; }
                
                /* Department Colors for Multi-Segment Bars */
                .gantt .bar-wrapper.dept-engineering .bar { fill: #3b82f6; }
                .gantt .bar-wrapper.dept-laser .bar { fill: #f97316; }
                .gantt .bar-wrapper.dept-press-brake .bar { fill: #eab308; }
                .gantt .bar-wrapper.dept-welding .bar { 
                    fill: #ef4444; 
                    stroke: #dc2626; 
                    stroke-width: 2;
                    filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.4));
                }
                .gantt .bar-wrapper.dept-polishing .bar { fill: #14b8a6; }
                .gantt .bar-wrapper.dept-assembly .bar { fill: #8b5cf6; }
                .gantt .bar-wrapper.dept-shipping .bar { fill: #6b7280; }

                /* Welding heartbeat highlight */
                .gantt .grid-row[data-dept="Welding"] { fill: rgba(239, 68, 68, 0.05); }
                .gantt .bar-wrapper[data-dept="Welding"] .bar { 
                    stroke: #ef4444; 
                    stroke-width: 2;
                    filter: drop-shadow(0 0 4px rgba(239, 68, 68, 0.4));
                }

                .gantt-container .popup-wrapper { 
                    z-index: 9999 !important; 
                    background: transparent !important; 
                    box-shadow: none !important; 
                    border: none !important; 
                    padding: 0 !important;
                }

                .custom-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 6px; border: 2px solid #0f172a; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
                .custom-scrollbar::-webkit-scrollbar-corner { background: #0f172a; }

                .gantt-fullscreen .gantt-container { height: 100%; }
                .gantt-fullscreen .gantt { height: 100%; }
                .gantt-fullscreen svg { height: 100% !important; }
            `}</style>
        </div>
    );
}
