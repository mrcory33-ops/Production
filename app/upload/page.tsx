'use client';

import { useState, useCallback } from 'react';
import { parseGlobalShopExport } from '@/lib/parser';
import { JCSJobSummary, Job, ScheduleInsights } from '@/types';
import { FileUp, AlertCircle, CheckCircle, ArrowLeft, Database, MessageSquareWarning } from 'lucide-react';
import Link from 'next/link';
import clsx from 'clsx';
import PaintingPrompt from '@/components/PaintingPrompt';
import ScheduleInsightsPanel from '@/components/ScheduleInsightsPanel';
import { ENABLE_JCS_INTEGRATION, ENABLE_JCS_STRICT_STALE_CLEANUP } from '@/lib/featureFlags';

export default function UploadPage() {
    const [dragActive, setDragActive] = useState(false);
    const [parsedJobs, setParsedJobs] = useState<Job[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showPaintingPrompt, setShowPaintingPrompt] = useState(false);
    const [jobsRequiringPainting, setJobsRequiringPainting] = useState<Set<string>>(new Set());
    const [scheduleInsights, setScheduleInsights] = useState<ScheduleInsights | null>(null);
    const [showInsights, setShowInsights] = useState(false);
    const [jcsSummaries, setJcsSummaries] = useState<JCSJobSummary[]>([]);
    const [jcsError, setJcsError] = useState<string | null>(null);
    const [jcsFileName, setJcsFileName] = useState('');
    const [jcsSyncing, setJcsSyncing] = useState(false);
    const [jcsLastSyncMessage, setJcsLastSyncMessage] = useState<string | null>(null);

    const handleFile = useCallback(async (file: File) => {
        setLoading(true);
        setError(null);
        try {
            const buffer = await file.arrayBuffer();
            const jobs = await parseGlobalShopExport(buffer);
            setParsedJobs(jobs);

            // Check if there are any HARMONIC jobs
            const harmonicJobs = jobs.filter(j => j.productType === 'HARMONIC');
            if (harmonicJobs.length > 0) {
                setShowPaintingPrompt(true);
            }
        } catch (metricErr) {
            console.error(metricErr);
            setError("Failed to parse file. Please ensure it's a valid Global Shop export.");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleConfirm = async () => {
        if (!parsedJobs.length) return;
        setLoading(true);
        try {
            // Apply painting flags to jobs
            const jobsWithPaintingFlags = parsedJobs.map(job => ({
                ...job,
                requiresPainting: jobsRequiringPainting.has(job.id)
            }));

            // Dynamically import to ensure client-side execution if needed
            const { syncJobsInput } = await import('@/lib/jobs');
            const stats = await syncJobsInput(jobsWithPaintingFlags);

            // Show detailed summary
            const summaryLines = [
                `✅ Sync Complete!`,
                ``,
                `📊 Job Summary:`,
                `  • ${stats.added} new jobs scheduled`,
                `  • ${stats.updated} existing jobs updated`,
                `  • ${stats.completed} jobs marked complete`,
            ];

            // Add painting info
            if (jobsRequiringPainting.size > 0) {
                summaryLines.push(``);
                summaryLines.push(`🎨 Painting Flagged (${jobsRequiringPainting.size} jobs):`);
                summaryLines.push(`  • +8-9 days added to Assembly time`);
            }

            // Add due date change alerts
            if (stats.dueDateChanged.length > 0) {
                summaryLines.push(``);
                summaryLines.push(`📅 Due Date Changes (${stats.dueDateChanged.length} jobs):`);
                stats.dueDateChanged.slice(0, 5).forEach(job => {
                    const prev = job.previousDueDate ? new Date(job.previousDueDate).toLocaleDateString() : '?';
                    const curr = new Date(job.dueDate).toLocaleDateString();
                    summaryLines.push(`  ⚠️ ${job.id}: ${prev} → ${curr}`);
                });
                if (stats.dueDateChanged.length > 5) {
                    summaryLines.push(`  ... and ${stats.dueDateChanged.length - 5} more`);
                }
                summaryLines.push(`  → Go to Planning Board to reschedule these jobs`);
            }

            // Add ahead of schedule alerts
            if (stats.ahead.length > 0) {
                summaryLines.push(``);
                summaryLines.push(`🚀 Ahead of Schedule (${stats.ahead.length} jobs):`);
                stats.ahead.slice(0, 5).forEach(job => {
                    summaryLines.push(`  ✨ ${job.id} (now in ${job.currentDepartment})`);
                });
                if (stats.ahead.length > 5) {
                    summaryLines.push(`  ... and ${stats.ahead.length - 5} more`);
                }
            }

            alert(summaryLines.join('\n'));

            // Show insights panel if there are issues
            if (stats.insights) {
                setScheduleInsights(stats.insights);
                const hasIssues = stats.insights.lateJobs.length > 0 || stats.insights.overloadedWeeks.length > 0;
                if (hasIssues) {
                    setShowInsights(true);
                }
            }

            setParsedJobs([]); // Clear after save
            setJobsRequiringPainting(new Set()); // Clear painting flags
        } catch (err) {
            console.error(err);
            setError("Failed to save to database. Check console details.");
        } finally {
            setLoading(false);
        }
    };

    const handleJcsFile = useCallback(async (file: File) => {
        setJcsError(null);
        setJcsLastSyncMessage(null);
        setJcsSyncing(true);
        try {
            const buffer = await file.arrayBuffer();
            const { parseJobComponentStatus } = await import('@/lib/parseJobComponentStatus');
            const summaries = await parseJobComponentStatus(buffer);
            if (!summaries.length) {
                throw new Error('No JCS rows with job + PO data were found in this file.');
            }
            setJcsSummaries(summaries);
            setJcsFileName(file.name);
        } catch (err) {
            console.error(err);
            setJcsError("Failed to parse JCS file. Please upload a valid #9's report.");
            setJcsSummaries([]);
            setJcsFileName('');
        } finally {
            setJcsSyncing(false);
        }
    }, []);

    const handleJcsSync = useCallback(async () => {
        if (!jcsSummaries.length) return;
        setJcsError(null);
        setJcsLastSyncMessage(null);
        setJcsSyncing(true);
        try {
            const { syncJCSData } = await import('@/lib/jobs');
            const result = await syncJCSData(jcsSummaries, {
                allowAutoClearStale: ENABLE_JCS_STRICT_STALE_CLEANUP,
            });
            const message = [
                `JCS Sync Complete`,
                `Import ID: ${result.importId}`,
                `Upserted: ${result.upsertedJobs}`,
                `Stale docs marked: ${result.staleDocsMarked}`,
                `Jobs marked stale: ${result.jobsMarkedStale}`,
                `Jobs auto-cleared: ${result.jobsAutoCleared}`,
                `Unmatched jobs: ${result.unmatchedJobIds.length}`,
            ].join(' | ');
            setJcsLastSyncMessage(message);
            alert(message);
            setJcsSummaries([]);
            setJcsFileName('');
        } catch (err) {
            console.error(err);
            setJcsError('Failed to sync JCS data to database. Check console details.');
        } finally {
            setJcsSyncing(false);
        }
    }, [jcsSummaries]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-700 bg-grid bg-fixed p-8 relative">
            {/* Schedule Insights Panel */}
            {showInsights && scheduleInsights && (
                <ScheduleInsightsPanel
                    insights={scheduleInsights}
                    onClose={() => setShowInsights(false)}
                />
            )}

            {/* Insights Trigger Button (floating) */}
            {scheduleInsights && !showInsights && (
                <button
                    onClick={() => setShowInsights(true)}
                    className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95 ${(scheduleInsights.lateJobs.length > 0 || scheduleInsights.overloadedWeeks.length > 0)
                        ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/30 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30 text-white'
                        }`}
                >
                    <MessageSquareWarning className="w-5 h-5" />
                    <span className="text-sm font-bold">Schedule Insights</span>
                    {scheduleInsights.summary.lateJobCount > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                            {scheduleInsights.summary.lateJobCount}
                        </span>
                    )}
                </button>
            )}

            {/* Background Gradient */}
            <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Painting Prompt Modal */}
            {showPaintingPrompt && (
                <PaintingPrompt
                    harmonicJobs={parsedJobs.filter(j => j.productType === 'HARMONIC')}
                    onConfirm={(selectedJobs) => {
                        setJobsRequiringPainting(selectedJobs);
                        setShowPaintingPrompt(false);
                    }}
                    onSkip={() => setShowPaintingPrompt(false)}
                />
            )}

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white tracking-tight">Import Data</h1>
                            <p className="text-slate-400 text-sm">Synchronize Global Shop exports with Scheduler</p>
                        </div>
                    </div>
                </div>

                {/* Loading Overlay */}
                {loading && (
                    <div className="fixed inset-0 bg-slate-950/80 z-50 flex items-center justify-center backdrop-blur-sm">
                        <div className="text-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4 box-shadow-[0_0_20px_#00f3ff]"></div>
                            <p className="text-lg font-semibold text-cyan-400">Processing Data...</p>
                        </div>
                    </div>
                )}

                {/* Drop Zone */}
                {!parsedJobs.length && (
                    <div
                        className={clsx(
                            "glass-panel rounded-2xl p-20 text-center transition-all cursor-pointer mb-8 border-dashed border-2 group",
                            dragActive
                                ? "border-cyan-500 bg-cyan-950/20 shadow-[0_0_30px_rgba(0,243,255,0.1)]"
                                : "border-slate-700 hover:border-cyan-500/50 hover:bg-slate-900/60"
                        )}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => document.getElementById('file-upload')?.click()}
                    >
                        <input
                            type="file"
                            id="file-upload"
                            className="hidden"
                            accept=".csv,.xlsx,.xls"
                            onChange={(e) => e.target.files && handleFile(e.target.files[0])}
                        />
                        <div className="w-20 h-20 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300 group-hover:bg-cyan-950/30">
                            <Database className={clsx("h-10 w-10 transition-colors", dragActive ? "text-cyan-400" : "text-slate-400 group-hover:text-cyan-400")} />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">Drop Export File Here</h3>
                        <p className="text-slate-400">Supports .CSV, .XLSX from Global Shop</p>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="glass-panel border-l-4 border-l-red-500 p-4 mb-8 bg-red-950/10">
                        <div className="flex items-center">
                            <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
                            <p className="text-red-200">{error}</p>
                        </div>
                    </div>
                )}

                {/* Preview Table */}
                {parsedJobs.length > 0 && (
                    <div className="glass-panel rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="p-4 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/40">
                            <div>
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    Preview Data
                                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs">{parsedJobs.length} Items</span>
                                </h2>
                                <div className="text-xs text-slate-400 mt-2 flex gap-4 font-mono">
                                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 shadow-[0_0_5px_#10b981]"></span>Received</span>
                                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-yellow-500 mr-2 shadow-[0_0_5px_#eab308]"></span>Partial</span>
                                    <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-orange-500 mr-2 shadow-[0_0_5px_#f97316]"></span>Open</span>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setParsedJobs([])}
                                    className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded-lg flex items-center shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale"
                                    onClick={handleConfirm}
                                    disabled={loading}
                                >
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    {loading ? 'Syncing...' : 'Sync to Database'}
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-800">
                                <thead className="bg-slate-900/80">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">ID</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Job Details</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Type / Size</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Qty</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Points</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Dept</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Due</th>
                                        <th className="px-6 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Status Flags</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {parsedJobs.slice(0, 50).map((job) => (
                                        <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-cyan-400 font-mono">{job.id}</td>
                                            <td className="px-6 py-4 text-sm text-slate-300 max-w-xs">
                                                <div className="font-semibold truncate text-white" title={job.name}>{job.name}</div>
                                                <div className="text-xs text-slate-500 truncate">{job.partNumber}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex gap-2">
                                                    <span className={clsx(
                                                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border",
                                                        job.productType === 'FAB' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                            job.productType === 'DOORS' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                                    )}>
                                                        {job.productType}
                                                    </span>
                                                    <span className={clsx(
                                                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border",
                                                        job.sizeClass === 'LARGE' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.15)]' : 'bg-slate-800 text-slate-500 border-slate-700'
                                                    )}>
                                                        {job.sizeClass}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 font-mono">{job.quantity}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-white font-mono">{job.weldingPoints}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                                                    {job.currentDepartment}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 font-mono">{job.dueDate.toLocaleDateString()}</td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <div className="flex items-center gap-2">
                                                    {/* PO Status */}
                                                    {!job.openPOs && job.closedPOs && (
                                                        <span className="text-emerald-400 font-medium text-xs flex items-center"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>Received</span>
                                                    )}
                                                    {job.openPOs && job.closedPOs && (
                                                        <span className="text-yellow-400 font-medium text-xs flex items-center"><span className="w-1.5 h-1.5 bg-yellow-500 rounded-full mr-1.5"></span>Partial</span>
                                                    )}
                                                    {job.openPOs && !job.closedPOs && (
                                                        <span className="text-orange-400 font-medium text-xs flex items-center"><span className="w-1.5 h-1.5 bg-orange-500 rounded-full mr-1.5"></span>Open</span>
                                                    )}

                                                    {/* Ready Flag */}
                                                    {job.readyToNest && (
                                                        <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-lime-500/10 text-lime-400 border border-lime-500/20 tracking-wider">
                                                            Ready
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {parsedJobs.length > 50 && (
                                <div className="p-4 text-center text-slate-500 text-sm border-t border-slate-800 font-mono">
                                    ...and {parsedJobs.length - 50} more records
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {ENABLE_JCS_INTEGRATION && (
                    <div className="mt-8 glass-panel rounded-xl border border-sky-900/40 overflow-hidden">
                        <div className="p-4 border-b border-slate-700/50 bg-sky-950/20 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-bold text-white">JCS Component Report Import</h2>
                                <p className="text-xs text-slate-400 mt-1">Upload #9&apos;s.xlsx and sync PO truth data (components + PO summaries).</p>
                            </div>
                            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 cursor-pointer text-sm font-medium">
                                <FileUp className="w-4 h-4" />
                                Select JCS File
                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={(e) => e.target.files && handleJcsFile(e.target.files[0])}
                                />
                            </label>
                        </div>

                        <div className="p-4 space-y-4">
                            {jcsError && (
                                <div className="rounded-lg border border-rose-700/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
                                    {jcsError}
                                </div>
                            )}

                            {jcsLastSyncMessage && (
                                <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200 font-mono">
                                    {jcsLastSyncMessage}
                                </div>
                            )}

                            {jcsSummaries.length === 0 && !jcsSyncing && (
                                <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-slate-400">
                                    No parsed JCS file loaded.
                                </div>
                            )}

                            {(jcsSummaries.length > 0 || jcsSyncing) && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                        <div className="rounded border border-slate-700 bg-slate-900/50 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">File</p>
                                            <p className="text-xs text-slate-200 truncate" title={jcsFileName}>{jcsFileName || 'Parsing...'}</p>
                                        </div>
                                        <div className="rounded border border-slate-700 bg-slate-900/50 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Jobs</p>
                                            <p className="text-sm font-mono text-slate-200">{jcsSummaries.length}</p>
                                        </div>
                                        <div className="rounded border border-slate-700 bg-slate-900/50 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-slate-500">Total POs</p>
                                            <p className="text-sm font-mono text-slate-200">{jcsSummaries.reduce((sum, job) => sum + job.totalPOs, 0)}</p>
                                        </div>
                                        <div className="rounded border border-amber-700/30 bg-amber-950/20 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-amber-300/70">Open + Overdue</p>
                                            <p className="text-sm font-mono text-amber-300">{jcsSummaries.reduce((sum, job) => sum + job.openPOs, 0)}</p>
                                        </div>
                                        <div className="rounded border border-emerald-700/30 bg-emerald-950/20 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wider text-emerald-300/70">Received</p>
                                            <p className="text-sm font-mono text-emerald-300">{jcsSummaries.reduce((sum, job) => sum + job.receivedPOs, 0)}</p>
                                        </div>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                setJcsSummaries([]);
                                                setJcsFileName('');
                                                setJcsError(null);
                                            }}
                                            disabled={jcsSyncing}
                                            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium disabled:opacity-50"
                                        >
                                            Clear
                                        </button>
                                        <button
                                            onClick={handleJcsSync}
                                            disabled={jcsSyncing || jcsSummaries.length === 0}
                                            className="bg-sky-600 hover:bg-sky-500 text-white px-6 py-2 rounded-lg flex items-center shadow-lg shadow-sky-500/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale"
                                        >
                                            <CheckCircle className="h-4 w-4 mr-2" />
                                            {jcsSyncing ? 'Syncing JCS...' : 'Sync JCS to Database'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
