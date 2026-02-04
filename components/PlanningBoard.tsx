'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, limit, doc, updateDoc, deleteDoc, writeBatch, onSnapshot, Timestamp, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Job, Department } from '@/types';
import { applyRemainingSchedule, scheduleJobs, scheduleAllJobs } from '@/lib/scheduler';
import { calculateDailyLoads, detectBottlenecks } from '@/lib/analytics';
import { DEPARTMENT_CONFIG, PRODUCT_TYPE_ICONS, DEPT_ORDER } from '@/lib/departmentConfig';
import { addDays, differenceInCalendarDays, differenceInCalendarMonths, format, startOfDay } from 'date-fns';
import { AlertTriangle, Calendar, Filter, Maximize, Minimize, Activity, Upload, Zap, Trash2, FileDown } from 'lucide-react';
import CustomGanttTable from './CustomGanttTable';
import DepartmentAnalyticsPanel from './DepartmentAnalyticsPanel';
import ExportModal from './export/ExportModal';



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
    const [selectedProductTypes, setSelectedProductTypes] = useState<Set<string>>(new Set(['FAB', 'DOORS', 'HARMONIC']));
    const [minPoints, setMinPoints] = useState<number>(1);
    const [maxPoints, setMaxPoints] = useState<number>(0); // 0 = no max
    const [dueStart, setDueStart] = useState<string>('');
    const [dueEnd, setDueEnd] = useState<string>('');
    const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(true);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

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

            const normalizedStart = startOfDay(newStart);
            const normalizedEnd = startOfDay(newEnd);

            // Update both departmentSchedule and remainingDepartmentSchedule
            const updatedDepartmentSchedule = {
                ...(job.departmentSchedule || {}),
                [department]: {
                    start: normalizedStart.toISOString(),
                    end: normalizedEnd.toISOString()
                }
            };

            const baseRemainingSchedule = (() => {
                if (job.remainingDepartmentSchedule && Object.keys(job.remainingDepartmentSchedule).length > 0) {
                    return job.remainingDepartmentSchedule;
                }
                if (job.status === 'IN_PROGRESS') {
                    const computed = applyRemainingSchedule(job, today).remainingDepartmentSchedule;
                    if (computed && Object.keys(computed).length > 0) return computed;
                }
                return job.departmentSchedule || {};
            })();

            const updatedRemainingSchedule = {
                ...baseRemainingSchedule,
                [department]: {
                    start: normalizedStart.toISOString(),
                    end: normalizedEnd.toISOString()
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

    const handleJobShiftUpdate = async (jobId: string, deltaDays: number) => {
        try {
            const job = jobs.find(j => j.id === jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            const shiftSchedule = (schedule?: Record<string, { start: string; end: string }>) => {
                if (!schedule) return undefined;
                const updated: Record<string, { start: string; end: string }> = {};
                Object.entries(schedule).forEach(([dept, dates]) => {
                    const start = startOfDay(addDays(new Date(dates.start), deltaDays));
                    const end = startOfDay(addDays(new Date(dates.end), deltaDays));
                    updated[dept] = { start: start.toISOString(), end: end.toISOString() };
                });
                return updated;
            };

            const updatedDepartmentSchedule = shiftSchedule(job.departmentSchedule);
            const updatedRemainingSchedule = shiftSchedule(job.remainingDepartmentSchedule);

            const allStarts = [
                ...(updatedDepartmentSchedule ? Object.values(updatedDepartmentSchedule) : []),
                ...(updatedRemainingSchedule ? Object.values(updatedRemainingSchedule) : [])
            ].map(d => new Date(d.start));

            const newScheduledStartDate = allStarts.length
                ? new Date(Math.min(...allStarts.map(d => d.getTime())))
                : job.scheduledStartDate;

            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, {
                departmentSchedule: updatedDepartmentSchedule || job.departmentSchedule,
                remainingDepartmentSchedule: updatedRemainingSchedule || job.remainingDepartmentSchedule,
                scheduledStartDate: newScheduledStartDate || null,
                updatedAt: new Date()
            });

            setJobs(prevJobs =>
                prevJobs.map(j =>
                    j.id === jobId
                        ? {
                            ...j,
                            departmentSchedule: updatedDepartmentSchedule || j.departmentSchedule,
                            remainingDepartmentSchedule: updatedRemainingSchedule || j.remainingDepartmentSchedule,
                            scheduledStartDate: newScheduledStartDate || j.scheduledStartDate
                        }
                        : j
                )
            );
        } catch (error) {
            console.error('Error shifting job schedule:', error);
            alert('Failed to shift schedule. Please try again.');
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
        if (!confirm('This will reschedule ALL jobs using the capacity-aware algorithm (300pt/day limit). Continue?')) return;

        setLoading(true);
        try {
            // Use the new capacity-aware Two-Pass scheduler (no existing jobs to preserve)
            const scheduled = scheduleAllJobs(jobs, []);

            // Update in Firebase with all new scheduling fields
            await Promise.all(scheduled.map(job => {
                const jobRef = doc(db, 'jobs', job.id);
                return updateDoc(jobRef, {
                    departmentSchedule: job.departmentSchedule,
                    // Clear old legacy schedule fields that might interfere
                    remainingDepartmentSchedule: deleteField(),
                    scheduledStartDate: job.scheduledStartDate,
                    scheduledDepartmentByDate: job.scheduledDepartmentByDate || null,
                    schedulingConflict: job.schedulingConflict || false,
                    progressStatus: job.progressStatus || 'ON_TRACK',
                    isOverdue: job.isOverdue || false,
                    updatedAt: new Date()
                });
            }));

            setJobs(scheduled);

            // DEBUG: Log a sample HECTOR job to see what data we're setting
            const hectorSample = scheduled.find(j => j.name.includes('HECTOR'));
            if (hectorSample) {
                console.log('📊 HECTOR Job Data After Scheduling:', {
                    name: hectorSample.name,
                    dueDate: hectorSample.dueDate,
                    scheduledStartDate: hectorSample.scheduledStartDate,
                    departmentSchedule: hectorSample.departmentSchedule
                });
            }
            // Check for conflicts
            const conflicts = scheduled.filter(j => j.schedulingConflict).length;
            alert(`✅ Schedule Optimized!
            
Algorithm: Backward from Due Date
• Assembly finishes ON due date
• Each dept works backwards respecting capacity
• Bigger jobs scheduled first (priority)

Results:
• ${scheduled.length} jobs scheduled
• ${conflicts} conflicts (capacity exceeded)

Check the Gantt chart - jobs should now finish near their due dates!`);
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

        // Filter by welding points range
        filtered = filtered.filter(j => {
            const pts = j.weldingPoints || 0;
            if (pts < minPoints) return false;
            if (maxPoints > 0 && pts > maxPoints) return false;
            return true;
        });

        // Filter by due date range (if set)
        if (dueStart || dueEnd) {
            const start = dueStart ? startOfDay(new Date(dueStart)) : null;
            const end = dueEnd ? startOfDay(new Date(dueEnd)) : null;
            filtered = filtered.filter(j => {
                const d = startOfDay(new Date(j.dueDate));
                if (start && d < start) return false;
                if (end && d > end) return false;
                return true;
            });
        }

        // Filter by product type tabs
        if (selectedProductTypes.size > 0) {
            filtered = filtered.filter(j => selectedProductTypes.has(j.productType));
        }

        // Filter by visible departments (REMOVED: Now handled by components for Pipeline View)
        // filtered = filtered.filter(job => {
        //     if (visibleDepartments.size === DEPT_ORDER.length) return true;
        //     return visibleDepartments.has(job.currentDepartment);
        // });

        return filtered
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
            .map(job => {
                if (job.remainingDepartmentSchedule) {
                    return job;
                }
                if (job.status === 'IN_PROGRESS') {
                    return applyRemainingSchedule(job, today);
                }
                return {
                    ...job,
                    forecastStartDate: job.scheduledStartDate ?? job.dueDate,
                    forecastDueDate: job.dueDate,
                    remainingDepartmentSchedule: job.departmentSchedule
                };
            });
    }, [jobs, showSmallRocks, today, selectedProductTypes, minPoints, maxPoints, dueStart, dueEnd]); // Removed visibleDepartments dependency

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

    // Empty state check - if no displayJobs, we'll show empty message inside the full UI layout
    const hasJobs = displayJobs.length > 0;

    return (
        <div ref={containerRef} className="h-screen flex flex-col bg-slate-100 overflow-hidden text-slate-900">
            {/* Header Toolbar */}
            <header className="h-16 border-b border-slate-300 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 z-20">
                <div className="flex items-center gap-6">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-cyan-700">
                        Planning Board
                    </h1>

                    {/* Department Toggles */}
                    <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-1 border border-slate-200 shadow-sm">
                        <span className="text-[10px] text-slate-400 font-bold px-2 uppercase tracking-wider">Departments:</span>
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
                                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${isVisible
                                        ? `bg-blue-600 text-white shadow-sm ring-1 ring-blue-700`
                                        : 'text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200'
                                        }`}
                                >
                                    {dept}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* Product Type Tabs */}
                    <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-1 border border-slate-200 shadow-sm">
                        <span className="text-[10px] text-slate-400 font-bold px-2 uppercase tracking-wider">Types:</span>
                        {[
                            { key: 'FAB', label: 'FAB', color: 'blue', text: 'text-blue-700', bg: 'bg-blue-50', active: 'bg-blue-600 text-white' },
                            { key: 'DOORS', label: 'Doors', color: 'emerald', text: 'text-emerald-700', bg: 'bg-emerald-50', active: 'bg-emerald-600 text-white' },
                            { key: 'HARMONIC', label: 'Harmonic', color: 'violet', text: 'text-violet-700', bg: 'bg-violet-50', active: 'bg-violet-600 text-white' }
                        ].map(t => {
                            const isSelected = selectedProductTypes.has(t.key);
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => {
                                        const next = new Set(selectedProductTypes);
                                        if (next.has(t.key)) next.delete(t.key);
                                        else next.add(t.key);
                                        if (next.size === 0) {
                                            setSelectedProductTypes(new Set(['FAB', 'DOORS', 'HARMONIC']));
                                        } else {
                                            setSelectedProductTypes(next);
                                        }
                                    }}
                                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${isSelected
                                        ? `${t.active} shadow-sm`
                                        : `${t.text} ${t.bg} opacity-50 hover:opacity-100`
                                        }`}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Active/All Toggle */}
                    <div className="flex bg-slate-50 rounded-lg p-1 border border-slate-200 shadow-sm">
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
                            ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}
                        title="Split capacity view by product type"
                    >
                        <Activity className="w-3.5 h-3.5" />
                        Product Split
                    </button>

                    {/* Welding Points Filter */}
                    <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-sm">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Points</span>
                        <input
                            type="number"
                            min={1}
                            value={minPoints}
                            onChange={(e) => setMinPoints(Math.max(1, Number(e.target.value) || 1))}
                            className="w-16 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700"
                            title="Minimum welding points"
                        />
                        <span className="text-xs text-slate-400">-</span>
                        <input
                            type="number"
                            min={0}
                            value={maxPoints}
                            onChange={(e) => setMaxPoints(Math.max(0, Number(e.target.value) || 0))}
                            className="w-16 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700"
                            title="Maximum welding points (0 = no max)"
                        />
                    </div>

                    {/* Due Date Filter */}
                    <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-sm">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Due</span>
                        <input
                            type="date"
                            value={dueStart}
                            onChange={(e) => setDueStart(e.target.value)}
                            className="w-[120px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700"
                            title="Due date start"
                        />
                        <span className="text-xs text-slate-400">-</span>
                        <input
                            type="date"
                            value={dueEnd}
                            onChange={(e) => setDueEnd(e.target.value)}
                            className="w-[120px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700"
                            title="Due date end"
                        />
                    </div>

                </div>
            </header>

            {/* Action Bar */}
            <div className="flex items-center gap-3 px-6 py-2 border-b border-slate-200 bg-white/90 backdrop-blur-md shrink-0">
                <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                    title="Import schedule from CSV"
                >
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV
                </button>

                <button
                    onClick={() => setIsExportModalOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
                    title="Export schedule to PDF"
                >
                    <FileDown className="w-3.5 h-3.5" />
                    Export
                </button>

                <div className="h-6 w-px bg-slate-200 mx-2" />

                {/* Zoom Control */}
                <div className="flex items-center gap-3 bg-white rounded-lg px-3 py-1.5 border border-slate-200 shadow-sm">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Zoom</span>
                    <input
                        type="range"
                        min="20"
                        max="100"
                        value={columnWidth}
                        onChange={(e) => setColumnWidth(Number(e.target.value))}
                        className="w-24 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
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
                    className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm transition-colors"
                    title="Clear All Jobs"
                >
                    <Trash2 size={14} />
                    <span>Clear</span>
                </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative">

                {/* Left Panel: Gantt Chart */}
                <div className="h-full overflow-hidden flex flex-col relative">
                    {hasJobs ? (
                        <CustomGanttTable
                            jobs={displayJobs}
                            startDate={chartDateRange.startDate}
                            endDate={chartDateRange.endDate}
                            columnWidth={columnWidth}
                            onJobClick={setSelectedJob}
                            selectedJob={selectedJob}
                            today={today}
                            onSegmentUpdate={handleSegmentUpdate}
                            onJobShiftUpdate={handleJobShiftUpdate}
                            visibleDepartments={visibleDepartments}
                            showActiveOnly={showActiveOnly}
                            selectedDates={selectedDates}
                            onDateSelect={setSelectedDates}
                        />
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="text-center p-8">
                                <div className="text-6xl mb-4">📋</div>
                                <h2 className="text-xl font-semibold text-slate-700 mb-2">No Jobs Scheduled</h2>
                                <p className="text-slate-500 mb-6 max-w-md">
                                    Import a CSV file to load jobs into the production scheduler.
                                </p>
                                <a
                                    href="/upload"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
                                >
                                    <Upload className="w-4 h-4" />
                                    Import Jobs
                                </a>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel: Analytics (Slide-Out) */}
                <aside
                    className={`absolute top-0 right-0 z-[9999] h-full w-[320px] border-l border-slate-300 transition-transform duration-300 ${isAnalyticsOpen ? 'translate-x-0 bg-white opacity-100' : 'translate-x-[320px] bg-slate-100 opacity-100'}`}
                    style={{ isolation: 'isolate' }}
                >
                    <div className="relative h-full overflow-hidden bg-white">
                        <div className="absolute inset-0 bg-white z-40" />
                        <div className="relative z-50 h-full">
                            <DepartmentAnalyticsPanel
                                jobs={displayJobs}
                                selectedDates={selectedDates}
                                splitByProductType={splitByProductType}
                                visibleDepartments={visibleDepartments}
                            />
                        </div>
                    </div>
                </aside>

                {/* Slide-Out Tab */}
                <button
                    onClick={() => setIsAnalyticsOpen(!isAnalyticsOpen)}
                    className={`absolute top-1/2 -translate-y-1/2 right-0 z-[10000] h-28 w-8 rounded-l-lg border border-slate-300 bg-white text-slate-500 hover:text-blue-600 transition-all shadow-md ${isAnalyticsOpen ? 'translate-x-0' : '-translate-x-8'}`}
                    title={isAnalyticsOpen ? 'Hide Analytics' : 'Show Analytics'}
                >
                    <span className="block text-[10px] font-semibold tracking-widest rotate-90">
                        ANALYTICS
                    </span>
                </button>
            </div>

            <style jsx global>{`
                .gantt .grid-header { fill: transparent; stroke: rgba(148, 163, 184, 0.3); stroke-width: 1; }
                .gantt .grid-row { fill: transparent; stroke: rgba(148, 163, 184, 0.2); stroke-width: 1; }
                .gantt .row-line { stroke: rgba(148, 163, 184, 0.2); }
                .gantt .tick { stroke: rgba(148, 163, 184, 0.2); }
                .gantt text { fill: #475569; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
                .gantt-target { background: #f8fafc; }
                .gantt-target svg { width: auto !important; min-width: 100%; }
                .gantt .bar-label { fill: #1e293b; font-size: 12px; font-weight: 500; letter-spacing: 0.2px; }
                .gantt .bar-wrapper:hover .bar-label { fill: #000; }
                .gantt .bar-label.big { display: none; }
                .gantt-performance .bar-label { display: none; }
                .gantml-performance .gantt .bar-wrapper:hover .bar-label { display: none; }
                
                /* Department Colors for Multi-Segment Bars - PRESERVED */
                .gantt .bar-wrapper.dept-engineering .bar { fill: #3b82f6; }
                .gantt .bar-wrapper.dept-laser .bar { fill: #f97316; }
                .gantt .bar-wrapper.dept-press-brake .bar { fill: #eab308; }
                .gantt .bar-wrapper.dept-welding .bar { 
                    fill: #ef4444; 
                    stroke: #dc2626; 
                    stroke-width: 2;
                    filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.2));
                }
                .gantt .bar-wrapper.dept-polishing .bar { fill: #14b8a6; }
                .gantt .bar-wrapper.dept-assembly .bar { fill: #8b5cf6; }
                .gantt .bar-wrapper.dept-shipping .bar { fill: #6b7280; }

                /* Welding heartbeat highlight - Light Mode */
                .gantt .grid-row[data-dept="Welding"] { fill: rgba(239, 68, 68, 0.02); }
                
                .gantt-container .popup-wrapper { 
                    z-index: 9999 !important; 
                    background: white !important; 
                    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important; 
                    border: 1px solid #e2e8f0 !important; 
                    padding: 0 !important;
                }

                .custom-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; border: 2px solid #f1f5f9; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .custom-scrollbar::-webkit-scrollbar-corner { background: #f1f5f9; }
            `}</style>
            {isExportModalOpen && (
                <ExportModal
                    jobs={jobs}
                    onClose={() => setIsExportModalOpen(false)}
                />
            )}
        </div>
    );
}
