import React, { useMemo, useState } from 'react';
import { Department, Job } from '@/types';
import {
    Eye, Loader2, Search, X, ArrowDownToLine,
} from 'lucide-react';

const PULL_REASONS = [
    'Job arrived early',
    'Customer priority change',
    'Material available ahead of schedule',
    'Capacity available now',
    'Other',
] as const;

export default function FutureWorkView({
    jobs,
    department,
    onPullToQueue,
}: {
    jobs: Job[];
    department: Department;
    onPullToQueue: (jobId: string, reason: string) => Promise<void> | void;
}) {
    const nowMs = new Date().getTime();
    const [searchTerm, setSearchTerm] = useState('');
    const [pullingJobId, setPullingJobId] = useState<string | null>(null);
    const [selectedReason, setSelectedReason] = useState<string>(PULL_REASONS[0]);
    const [customReason, setCustomReason] = useState('');
    const [isPulling, setIsPulling] = useState(false);

    const filtered = useMemo(() => {
        if (!searchTerm.trim()) return jobs;
        const q = searchTerm.toLowerCase();
        return jobs.filter(j =>
            j.id.toLowerCase().includes(q) ||
            j.name.toLowerCase().includes(q) ||
            (j.description || '').toLowerCase().includes(q)
        );
    }, [jobs, searchTerm]);

    const handlePull = async () => {
        if (!pullingJobId) return;
        const reason = selectedReason === 'Other' ? customReason.trim() || 'Other' : selectedReason;
        setIsPulling(true);
        try {
            await onPullToQueue(pullingJobId, reason);
            setPullingJobId(null);
            setSelectedReason(PULL_REASONS[0]);
            setCustomReason('');
        } finally {
            setIsPulling(false);
        }
    };

    return (
        <div className="p-6 overflow-y-auto h-full space-y-4 max-w-4xl mx-auto">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]" />
                <input
                    type="text"
                    placeholder="Search by WO#, job name, or description..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-[#1a1a1a] border border-[#333] rounded-lg text-sm text-slate-200 placeholder-[#555] focus:outline-none focus:border-sky-600/50 focus:ring-1 focus:ring-sky-600/20 transition-all font-mono"
                />
                {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-slate-300 transition-colors">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-[#555]">
                    <Eye className="w-12 h-12 mb-4 opacity-30" />
                    {searchTerm ? (
                        <p className="text-sm font-mono uppercase tracking-wider">No jobs matching &quot;{searchTerm}&quot;</p>
                    ) : (
                        <>
                            <p className="text-sm font-mono uppercase tracking-wider">No upcoming jobs for {department}</p>
                            <p className="text-xs text-[#444] mt-2">Jobs will appear here once scheduled for this department</p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <p className="text-[11px] text-[#666] font-mono uppercase tracking-wider">
                        {filtered.length} upcoming job{filtered.length !== 1 ? 's' : ''} heading to {department}
                        {searchTerm && <span className="text-sky-500"> - filtered</span>}
                    </p>
                    {filtered.map(job => {
                        const schedule = job.departmentSchedule || job.remainingDepartmentSchedule;
                        const arrivalDate = schedule?.[department]?.start ? new Date(schedule[department].start) : null;
                        const daysUntil = arrivalDate ? Math.ceil((arrivalDate.getTime() - nowMs) / 86400000) : null;
                        const showingPull = pullingJobId === job.id;
                        return (
                            <div key={job.id} className={`bg-gradient-to-b border rounded-lg overflow-hidden transition-colors ${showingPull ? 'border-amber-600/60 from-[#222] to-[#1c1c1c]' : job.currentDepartment === department ? 'border-emerald-400 ring-2 ring-emerald-400/40 shadow-[0_0_20px_rgba(52,211,153,0.3)] from-emerald-950/30 to-[#1c1c1c]' : 'border-[#333] hover:border-[#555] from-[#222] to-[#1c1c1c]'}`}>
                                <div className="h-1 w-full" style={{ backgroundColor: job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6' }} />
                                <div className="p-4 flex items-center gap-4">
                                    <div className="shrink-0 w-14 h-14 rounded bg-[#111] border border-[#333] flex flex-col items-center justify-center shadow-inner">
                                        {daysUntil !== null ? (
                                            <><span className={`text-lg font-mono font-bold ${daysUntil <= 3 ? 'text-sky-400' : 'text-slate-400'}`}>{daysUntil}</span><span className="text-[8px] text-[#666] uppercase">days</span></>
                                        ) : <span className="text-[10px] text-[#555]">TBD</span>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-[10px] font-mono font-bold text-[#666]">{job.id}</span>
                                            {job.currentDepartment === department ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 font-bold shadow-[0_0_8px_rgba(52,211,153,0.25)]">🔄 IN DEPT — Swap Available</span>
                                            ) : (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#111] border border-[#333] text-[#888]">Now: {job.currentDepartment}</span>
                                            )}
                                        </div>
                                        <h4 className="font-bold text-slate-200 text-sm font-serif truncate">{job.name}</h4>
                                        <div className="flex gap-3 mt-1 text-[10px] text-[#666] font-mono">
                                            {arrivalDate && <span>Arrives: {arrivalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                                            <span>Due: {new Date(job.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                    </div>
                                    <div className="shrink-0 flex items-center gap-3">
                                        <div className="px-2 py-1 rounded bg-[#111] border border-[#333] shadow-inner">
                                            <span className="text-sky-400 text-sm font-mono font-bold">{job.weldingPoints}</span>
                                            <span className="text-[8px] text-[#666] ml-0.5">pt</span>
                                        </div>
                                        <button
                                            onClick={() => setPullingJobId(showingPull ? null : job.id)}
                                            title="Pull to today's queue"
                                            className={`p-2 rounded-lg border transition-all text-xs font-bold ${showingPull ? 'bg-amber-600/20 border-amber-600/50 text-amber-400' : 'border-[#444] text-[#666] hover:text-amber-400 hover:border-amber-600/40 hover:bg-amber-900/20'}`}
                                        >
                                            <ArrowDownToLine className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {showingPull && (
                                    <div className="px-4 pb-4 pt-1 border-t border-amber-800/30 bg-amber-950/20">
                                        <div className="flex items-center gap-2 mb-2">
                                            <ArrowDownToLine className="w-3.5 h-3.5 text-amber-400" />
                                            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Pull to {department} Queue</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap gap-1.5">
                                                {PULL_REASONS.map(reason => (
                                                    <button
                                                        key={reason}
                                                        onClick={() => { setSelectedReason(reason); if (reason !== 'Other') setCustomReason(''); }}
                                                        className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all ${selectedReason === reason ? 'bg-amber-600/30 text-amber-300 border-amber-600/50' : 'bg-[#111] text-[#888] border-[#333] hover:border-[#555] hover:text-slate-200'}`}
                                                    >
                                                        {reason}
                                                    </button>
                                                ))}
                                            </div>
                                            {selectedReason === 'Other' && (
                                                <input
                                                    type="text"
                                                    placeholder="Describe reason..."
                                                    value={customReason}
                                                    onChange={e => setCustomReason(e.target.value)}
                                                    className="w-full px-3 py-1.5 bg-[#111] border border-[#333] rounded text-[11px] text-slate-200 placeholder-[#555] focus:outline-none focus:border-amber-600/50"
                                                    autoFocus
                                                />
                                            )}
                                            <div className="flex gap-2 pt-1">
                                                <button
                                                    onClick={handlePull}
                                                    disabled={isPulling || (selectedReason === 'Other' && !customReason.trim())}
                                                    className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                                >
                                                    {isPulling ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                                                    {isPulling ? 'Pulling...' : 'Confirm Pull'}
                                                </button>
                                                <button
                                                    onClick={() => setPullingJobId(null)}
                                                    className="px-3 py-1.5 rounded border border-[#444] text-[#888] text-[10px] font-bold uppercase hover:text-slate-200 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}
