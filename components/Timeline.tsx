'use client';

import { useEffect, useRef, useState } from 'react';
// @ts-ignore - Frappe Gantt has no types
import Gantt from 'frappe-gantt';
import { Job } from '@/types';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { AlertCircle, Filter, Maximize, Minimize } from 'lucide-react';
import { format } from 'date-fns';

export default function Timeline() {
    const ganttRef = useRef<HTMLDivElement>(null);
    const ganttInstanceRef = useRef<any>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<string>('Day');
    const [columnWidth, setColumnWidth] = useState<number>(30);
    const [showSmallRocks, setShowSmallRocks] = useState(true);
    const [isFullScreen, setIsFullScreen] = useState(false);

    useEffect(() => {
        const fetchJobs = async () => {
            try {
                // Fetch active jobs with scheduled dates
                const q = query(
                    collection(db, 'jobs'),
                    where('status', 'in', ['PENDING', 'IN_PROGRESS']),
                    limit(100) // Limit for performance first
                );

                const snapshot = await getDocs(q);
                const fetchedJobs: Job[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data() as Job;
                    // Only include if scheduled
                    if (data.scheduledStartDate && data.dueDate) {
                        fetchedJobs.push({
                            ...data,
                            scheduledStartDate: (data.scheduledStartDate as any).toDate ? (data.scheduledStartDate as any).toDate() : new Date(data.scheduledStartDate),
                            dueDate: (data.dueDate as any).toDate ? (data.dueDate as any).toDate() : new Date(data.dueDate)
                        });
                    }
                });

                setJobs(fetchedJobs);
            } catch (err) {
                console.error("Failed to fetch jobs for Gantt", err);
            } finally {
                setLoading(false);
            }
        };

        fetchJobs();
    }, []);

    useEffect(() => {
        if (!ganttRef.current || loading || jobs.length === 0) return;

        // Transform to Frappe Format
        // Filter based on toggle
        const filteredJobs = showSmallRocks
            ? jobs
            : jobs.filter(j => j.isPriority || (j.weldingPoints || 0) >= 70);

        const tasks = filteredJobs.map(job => {
            let customClass = 'bar-fab';
            if (job.isPriority) customClass = 'bar-priority';
            else if (job.productType === 'DOORS') customClass = 'bar-doors';
            else if (job.productType === 'HARMONIC') customClass = 'bar-harmonic';

            return {
                id: job.id,
                name: `${job.name} (${job.weldingPoints?.toFixed(0) || 0} pts)`,
                start: job.scheduledStartDate ? format(job.scheduledStartDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
                end: job.dueDate ? format(job.dueDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
                progress: 0,
                dependencies: '',
                custom_class: customClass,
                // Attach raw data for popup
                _job: job
            };
        });

        // Initialize Gantt
        ganttRef.current.innerHTML = '';

        try {
            ganttInstanceRef.current = new Gantt(ganttRef.current, tasks, {
                view_mode: viewMode,
                date_format: 'YYYY-MM-DD',
                column_width: columnWidth,
                popup_on: 'hover',
                infinite_padding: false, // Fix: Disable wheel hijacking for date shifting // Valid values: 'click' or 'hover' (not 'mouseover')
                bar_height: 25,
                padding: 10,
                // The option is named 'popup', not 'custom_popup_html' in this version
                popup: (ctx: any) => {
                    // ctx contains { task, chart, ... }
                    const job = ctx.task._job as Job;
                    if (!job) return '';

                    const deptOrder = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

                    const deptRows = job.departmentSchedule
                        ? deptOrder.map(dept => {
                            const dates = job.departmentSchedule![dept];
                            if (!dates) return ''; // Skip if dept not in schedule (or show as pending?)

                            // Highlight current department
                            const isCurrent = job.currentDepartment === dept;
                            const deptClass = isCurrent ? "text-yellow-400 font-bold" : "text-slate-400";
                            const dateClass = isCurrent ? "text-yellow-400 font-bold" : "text-cyan-400";

                            return `
                                <div class="flex justify-between text-xs mt-1 ${isCurrent ? 'bg-white/5 rounded px-1 -mx-1 py-0.5' : ''}">
                                    <span class="${deptClass}">${dept}</span>
                                    <span class="${dateClass}">${format(new Date(dates.start), 'M/d')} - ${format(new Date(dates.end), 'M/d')}</span>
                                </div>`;
                        }).join('')
                        : '<div class="text-xs text-slate-500 italic">No detailed schedule</div>';

                    // We return the HTML string which frappe-gantt will inject into the popup container
                    return `
                        <div class="p-3 bg-slate-900 border border-cyan-500/30 shadow-xl rounded-lg min-w-[200px]">
                            <div class="font-bold text-white mb-1 border-b border-slate-700 pb-1">${job.name}</div>
                            <div class="text-xs text-slate-300 mb-2">Wait: ${job.weldingPoints?.toFixed(1) || 0} pts</div>
                            <div class="space-y-1">
                                ${deptRows}
                            </div>
                            <div class="mt-2 text-xs text-right text-emerald-400">Due: ${format(new Date(job.dueDate), 'MMM d')}</div>
                        </div>
                    `;
                },
                on_click: (task: any) => {
                    const job = task._job as Job;
                    alert(`Job Details:\nName: ${job.name}\nID: ${job.id}\nQty: ${job.quantity}\nPoints: ${job.weldingPoints}`);
                },
                on_date_change: (task: any, start: Date, end: Date) => {
                    console.log(task, start, end);
                    // TODO: Update Firestore on drag
                },
            });
        } catch (e) {
            console.error("Gantt Init Error", e);
        }

    }, [jobs, loading, showSmallRocks]); // Re-init when toggle changes

    // Handle View Mode & Zoom Change
    useEffect(() => {
        if (ganttInstanceRef.current) {
            // We use change_view_mode to update both mode and re-render with new column width
            // We temporarily override the internal config to force the column width
            ganttInstanceRef.current.options.column_width = columnWidth;
            ganttInstanceRef.current.change_view_mode(viewMode);
        }
    }, [viewMode, columnWidth]);

    if (loading) return <div className="text-cyan-500 animate-pulse">Loading Schedule...</div>;
    if (jobs.length === 0) return <div className="text-slate-400">No scheduled jobs found.</div>;

    return (
        <div className={`w-full pb-4 transition-all duration-300 ${isFullScreen ? 'fixed inset-0 z-50 bg-slate-950 p-4 h-screen overflow-hidden flex flex-col' : ''}`}>
            <div className="flex justify-between items-center mb-4 shrink-0">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-8 bg-cyan-500 rounded-full inline-block"></span>
                    Production Timeline
                </h2>

                <div className="flex items-center gap-6 bg-slate-900/50 p-2 rounded-lg border border-slate-800">

                    {/* Full Screen Toggle */}
                    <button
                        onClick={() => setIsFullScreen(!isFullScreen)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        title="Toggle Full Screen"
                    >
                        {isFullScreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>

                    <div className="w-px h-6 bg-slate-700"></div>

                    {/* Small Rocks Toggle */}
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

                    <div className="w-px h-6 bg-slate-700 mx-2"></div>

                    {/* View Mode Toggles */}
                    <div className="flex gap-1 bg-slate-800 rounded p-1">
                        {['Day', 'Week', 'Month'].map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`px-3 py-1 rounded text-xs transition-colors font-medium ${viewMode === mode
                                    ? 'bg-cyan-600 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-700'
                                    }`}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>

                    {/* Zoom Slider */}
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

            {/* Gantt Container */}
            <div
                className={`gantt-target glass-panel p-4 rounded-xl min-w-[800px] overflow-auto custom-scrollbar ${isFullScreen ? 'flex-1 rounded-none border-none' : 'h-[calc(100vh-240px)]'}`}
                ref={ganttRef}
            ></div>

            <style jsx global>{`
                /* Gantt Styles Overlay */
                .gantt .grid-header { fill: transparent; stroke: #334155; stroke-width: 1; }
                .gantt .grid-row { fill: transparent; stroke: #334155; stroke-width: 1; }
                .gantt .row-line { stroke: #334155; }
                .gantt .grid-row { fill: transparent; stroke: #334155; stroke-width: 1; }
                .gantt .row-line { stroke: #334155; }
                .gantt .tick { stroke: #334155; }
                .gantt text { fill: #94a3b8; font-family: 'JetBrains Mono', monospace; }
                
                /* Full Screen Fixes */
                .gantt-target { background: #020617; } /* Ensure dark background */
                
                /* FIX: Force SVG to take full width of content to trigger scrollbar */
                .gantt-target svg { width: auto !important; min-width: 100%; }
                
                .gantt .bar-label { fill: #fff; font-size: 14px; font-weight: 500; }
                .gantt .bar-wrapper.bar-priority .bar { fill: #f59e0b; }
                .gantt .bar-wrapper.bar-fab .bar { fill: #3b82f6; } /* Blue */
                .gantt .bar-wrapper.bar-doors .bar { fill: #10b981; } /* Emerald */
                .gantt .bar-wrapper.bar-harmonic .bar { fill: #8b5cf6; } /* Purple */
                
                /* Ensure popup is visible above everything */
                .gantt-container .popup-wrapper { 
                    z-index: 9999 !important; 
                    background: transparent !important; 
                    box-shadow: none !important; 
                    border: none !important; 
                    padding: 0 !important;
                }
                
                /* Scrollbar styling */
                .custom-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 6px; border: 2px solid #0f172a; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
                .custom-scrollbar::-webkit-scrollbar-corner { background: #0f172a; }
            `}</style>
        </div>
    );
}
