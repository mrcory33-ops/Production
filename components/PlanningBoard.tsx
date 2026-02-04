'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, limit, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Job, Department } from '@/types';
import { applyRemainingSchedule, scheduleJobs } from '@/lib/scheduler';
import { calculateDailyLoads, detectBottlenecks } from '@/lib/analytics';
import { DEPARTMENT_CONFIG, PRODUCT_TYPE_ICONS, DEPT_ORDER } from '@/lib/departmentConfig';
import { addDays, differenceInCalendarDays, differenceInCalendarMonths, format, startOfDay } from 'date-fns';
import { AlertTriangle, Calendar, Filter, Maximize, Minimize, Activity, Upload, Zap, Trash2 } from 'lucide-react';
import CustomGanttTable from './CustomGanttTable';
import DepartmentAnalyticsPanel from './DepartmentAnalyticsPanel';



const toDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
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
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [columnWidth, setColumnWidth] = useState(40);
    const [showSmallRocks, setShowSmallRocks] = useState(true);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [capacityAlerts, setCapacityAlerts] = useState<any[]>([]);
    const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
    const [today] = useState(() => startOfDay(new Date()));
    const [visibleDepartments, setVisibleDepartments] = useState<Set<Department>>(new Set(DEPT_ORDER));
    const [splitByProductType, setSplitByProductType] = useState(false);
    const [selectedDates, setSelectedDates] = useState<Date[]>([]);
    const [showActiveOnly, setShowActiveOnly] = useState(false);

    // Handle segment date updates
    const handleSegmentUpdate = async (
        jobId: string,
        department: Department,
        newStart: Date,
        newEnd: Date
    ) => {
        try {
            // Find the job
            const job = jobs.find(j => j.id === jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            // Update both departmentSchedule and remainingDepartmentSchedule
            const updatedDepartmentSchedule = {
                ...(job.departmentSchedule || {}),
                [department]: {
                    start: newStart.toISOString(),
                    end: newEnd.toISOString()
                }
            };

            const updatedRemainingSchedule = {
                ...(job.remainingDepartmentSchedule || {}),
                [department]: {
                    start: newStart.toISOString(),
                    end: newEnd.toISOString()
                }
            };

            // Update in Firebase
            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, {
                departmentSchedule: updatedDepartmentSchedule,
                remainingDepartmentSchedule: updatedRemainingSchedule,
                updatedAt: new Date()
            });

            // Update local state
            setJobs(prevJobs =>
                prevJobs.map(j =>
                    j.id === jobId
                        ? {
                            ...j,
                            departmentSchedule: updatedDepartmentSchedule,
                            remainingDepartmentSchedule: updatedRemainingSchedule
                        }
                        : j
                )
            );

            console.log(`✅ Updated ${department} schedule for ${job.name}: ${format(newStart, 'M/d')} - ${format(newEnd, 'M/d')}`);
        } catch (error) {
            console.error('Error updating segment:', error);
            alert('Failed to update schedule. Please try again.');
        }
    };

    useEffect(() => {
        const handleFullScreenChange = () => {
            const isActive = document.fullscreenElement === containerRef.current;
            setIsFullScreen(isActive);
        };

        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
    }, []);

    const handleAutoSchedule = async () => {
        if (!confirm('This will reschedule ALL jobs based on the Welding-centric logic. This will overwrite manual department schedules. Continue?')) return;

        setLoading(true);
        try {
            const scheduled = scheduleJobs(jobs);

            // Update in Firebase
            await Promise.all(scheduled.map(job => {
                const jobRef = doc(db, 'jobs', job.id);
                return updateDoc(jobRef, {
                    departmentSchedule: job.departmentSchedule,
                    scheduledStartDate: job.scheduledStartDate,
                    updatedAt: new Date()
                });
            }));

            setJobs(scheduled);
            // alert('Schedule optimized successfully!'); // Optional: keep silent or subtle toast
        } catch (error) {
            console.error('Auto-schedule failed:', error);
            alert('Failed to optimize schedule.');
        } finally {
            setLoading(false);
        }
    };

    const handleClearAll = async () => {
        if (!confirm('Are you sure you want to DELETE ALL displayed jobs? This cannot be undone.')) return;

        setLoading(true);
        try {
            const batch = writeBatch(db);
            let count = 0;

            jobs.forEach(job => {
                // Safety check: only delete jobs we have IDs for
                if (job.id) {
                    const ref = doc(db, 'jobs', job.id);
                    batch.delete(ref);
                    count++;
                }
            });

            if (count > 0) {
                await batch.commit();
                setJobs([]);
                alert(`Successfully deleted ${count} jobs.`);
            }
        } catch (error) {
            console.error('Failed to clear jobs:', error);
            alert('Failed to delete jobs. See console for details.');
        } finally {
            setLoading(false);
        }
    };

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
            : jobs.filter(j => j.isPriority || (j.weldingPoints || 0) >= 60);

        // Filter by visible departments (REMOVED: Now handled by components for Pipeline View)
        // filtered = filtered.filter(job => {
        //     if (visibleDepartments.size === DEPT_ORDER.length) return true;
        //     return visibleDepartments.has(job.currentDepartment);
        // });

        return filtered.map(job => {
            if (job.remainingDepartmentSchedule && job.forecastDueDate && job.forecastStartDate) {
                return job;
            }
            return applyRemainingSchedule(job, today);
        });
    }, [jobs, showSmallRocks, today]); // Removed visibleDepartments dependency

    // ...

    {/* Right Panel: Analytics */ }
    <aside className="h-full overflow-hidden bg-slate-900/50">
        <DepartmentAnalyticsPanel
            jobs={displayJobs}
            selectedDates={selectedDates}
            splitByProductType={splitByProductType}
            visibleDepartments={visibleDepartments}
        />
    </aside>

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

    // Calculate date range for chart
    const chartDateRange = useMemo(() => {
        if (!displayJobs.length) {
            return {
                startDate: today,
                endDate: addDays(today, 30)
            };
        }

        let earliest = today;
        let latest = addDays(today, 30);

        displayJobs.forEach(job => {
            const jobStart = job.forecastStartDate || job.scheduledStartDate || job.dueDate;
            const jobEnd = job.forecastDueDate || job.dueDate;

            if (jobStart < earliest) earliest = jobStart;
            if (jobEnd > latest) latest = jobEnd;
        });

        // Add buffer
        return {
            startDate: addDays(earliest, -3),
            endDate: addDays(latest, 7)
        };
    }, [displayJobs, today]);

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
        <div ref={containerRef} className="h-screen flex flex-col bg-slate-950 overflow-hidden text-slate-100">
            {/* Header Toolbar */}
            <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center gap-6">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-400">
                        Planning Board
                    </h1>

                    {/* Department Toggles */}
                    <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                        <span className="text-[10px] text-slate-500 font-bold px-2 uppercase tracking-wider">Departments:</span>
                        <button
                            onClick={() => setVisibleDepartments(new Set(DEPT_ORDER))}
                            className={`px-3 py-1 rounded text-xs font-medium transition-all ${visibleDepartments.size === DEPT_ORDER.length
                                ? 'bg-slate-700 text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            All
                        </button>
                        {DEPT_ORDER.map(dept => {
                            const config = DEPARTMENT_CONFIG[dept];
                            const isVisible = visibleDepartments.has(dept);
                            return (
                                <button
                                    key={dept}
                                    onClick={() => {
                                        const newSet = new Set(visibleDepartments);
                                        if (newSet.has(dept)) newSet.delete(dept);
                                        else newSet.add(dept);
                                        setVisibleDepartments(newSet);
                                    }}
                                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${isVisible
                                        ? `bg-${config.color}-500/20 text-${config.color}-300 border border-${config.color}-500/30`
                                        : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                >
                                    {dept}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Active/All Toggle */}
                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                        <button
                            onClick={() => setShowActiveOnly(false)}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-medium transition-all ${!showActiveOnly ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            <Calendar className="w-3.5 h-3.5" />
                            All Jobs
                        </button>
                        <button
                            onClick={() => setShowActiveOnly(true)}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-medium transition-all ${showActiveOnly ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            <Filter className="w-3.5 h-3.5" />
                            Active
                        </button>
                    </div>

                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 ml-2">
                        <button
                            onClick={() => setShowSmallRocks(false)}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-medium transition-all ${!showSmallRocks ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                                }`}
                            title="Show only jobs with > 60 points"
                        >
                            Big Rocks
                        </button>
                        <button
                            onClick={() => setShowSmallRocks(true)}
                            className={`px-3 py-1.5 rounded flex items-center gap-2 text-xs font-medium transition-all ${showSmallRocks ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            All
                        </button>
                    </div>

                    {/* Product Split Toggle */}
                    <button
                        onClick={() => setSplitByProductType(!splitByProductType)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium border transition-all ${splitByProductType
                            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                            }`}
                        title="Split capacity view by product type"
                    >
                        <Activity className="w-3.5 h-3.5" />
                        Product Split
                    </button>

                    <button
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-all shadow-sm"
                        title="Import schedule from CSV"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        Import CSV
                    </button>

                    <div className="h-6 w-px bg-slate-800 mx-2" />

                    {/* Zoom Control */}
                    <div className="flex items-center gap-3 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Zoom</span>
                        <input
                            type="range"
                            min="20"
                            max="100"
                            value={columnWidth}
                            onChange={(e) => setColumnWidth(Number(e.target.value))}
                            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                    <button
                        onClick={handleAutoSchedule}
                        className="flex items-center gap-2 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-md text-sm transition-colors"
                        title="Optimize Schedule (Welding-Centric)"
                    >
                        <Zap size={14} />
                        <span>Optimize</span>
                    </button>

                    <button
                        onClick={handleClearAll}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm transition-colors ml-2"
                        title="Clear All Jobs"
                    >
                        <Trash2 size={14} />
                        <span>Clear</span>
                    </button>
                </div>
            </header>

            {/* Main Content Grid */}
            <div className="flex-1 overflow-hidden grid grid-cols-[1fr_320px]">

                {/* Left Panel: Gantt Chart */}
                <div className="h-full overflow-hidden flex flex-col relative border-r border-slate-800">
                    <CustomGanttTable
                        jobs={displayJobs}
                        startDate={chartDateRange.startDate}
                        endDate={chartDateRange.endDate}
                        columnWidth={columnWidth}
                        onJobClick={setSelectedJob}
                        selectedJob={selectedJob}
                        today={today}
                        onSegmentUpdate={handleSegmentUpdate}
                        visibleDepartments={visibleDepartments}
                        showActiveOnly={showActiveOnly}
                        selectedDates={selectedDates}
                        onDateSelect={setSelectedDates}
                    />
                </div>

                {/* Right Panel: Analytics */}
                <aside className="h-full overflow-hidden bg-slate-900/50">
                    <DepartmentAnalyticsPanel
                        jobs={displayJobs}
                        selectedDates={selectedDates}
                        splitByProductType={splitByProductType}
                        visibleDepartments={visibleDepartments}
                    />
                </aside>
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
            `}</style>
        </div>
    );
}
