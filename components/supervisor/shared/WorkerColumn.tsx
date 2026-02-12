'use client';

import React, { useState, useCallback } from 'react';
import { Department, Job } from '@/types';
import { WorkerProfile, PRODUCT_TYPE_COLORS } from '../types';
import { Loader2 } from 'lucide-react';

export default function WorkerColumn({ worker, jobs, department, onProgressUpdate, savingProgress }: {
    worker: WorkerProfile;
    jobs: Job[];
    department: Department;
    onProgressUpdate: (jobId: string, pct: number) => void;
    savingProgress: string | null;
}) {
    const [grouped, setGrouped] = useState(true);
    const initials = worker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const totalPoints = jobs.reduce((s, j) => s + (j.weldingPoints || 0), 0);

    // Compute the "effective" group progress — use the max progress across all assigned jobs
    const progressValues = jobs.map(j => j.departmentProgress?.[department] ?? 0);
    const groupProgress = progressValues.length > 0 ? Math.max(...progressValues) : 0;

    const isSaving = jobs.some(j => savingProgress === j.id);

    const handleGroupProgress = useCallback((pct: number) => {
        jobs.forEach(j => onProgressUpdate(j.id, pct));
    }, [jobs, onProgressUpdate]);

    const handleSingleProgress = useCallback((jobId: string, pct: number) => {
        onProgressUpdate(jobId, pct);
    }, [onProgressUpdate]);

    return (
        <div className="flex flex-col border border-[#333] rounded-lg bg-[#181818] min-h-[280px]">
            {/* Worker Header */}
            <div className="p-3 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-[10px] font-bold text-white border border-slate-500 shadow-inner">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-white truncate font-serif">{worker.name}</h4>
                        <span className="text-[9px] text-[#666] font-mono">{jobs.length} job{jobs.length !== 1 ? 's' : ''} • {Math.round(totalPoints)} pts</span>
                    </div>
                </div>
                {(worker.qualifications?.length || worker.strengths.length) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {(worker.qualifications || worker.strengths).map(s => (
                            <span key={s} className="text-[8px] px-1 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">{s}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Group Toggle + Progress Controls */}
            {jobs.length > 0 && (
                <div className="px-3 py-2 border-b border-[#333] bg-[#1c1c1c] shrink-0 space-y-2">
                    {/* Group checkbox */}
                    {jobs.length > 1 && (
                        <label className="flex items-center gap-2 cursor-pointer select-none group">
                            <input
                                type="checkbox"
                                checked={grouped}
                                onChange={e => setGrouped(e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-[#555] bg-[#111] text-sky-500 focus:ring-sky-500/30 focus:ring-offset-0 cursor-pointer"
                            />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#888] group-hover:text-slate-300 transition-colors">
                                Group Jobs
                            </span>
                            {grouped && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-sky-900/30 text-sky-400 border border-sky-800/40 font-bold">
                                    ALL
                                </span>
                            )}
                        </label>
                    )}

                    {/* Grouped progress controls */}
                    {(grouped || jobs.length === 1) && (
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] text-[#666] font-bold uppercase tracking-wider">Progress</span>
                                <div className="flex items-center gap-1">
                                    {isSaving && <Loader2 className="w-2.5 h-2.5 text-sky-400 animate-spin" />}
                                    <span className={`text-xs font-mono font-bold ${groupProgress >= 100 ? 'text-emerald-400' : groupProgress > 0 ? 'text-sky-400' : 'text-[#555]'}`}>
                                        {groupProgress}%
                                    </span>
                                </div>
                            </div>
                            <div className="h-2 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-2">
                                <div className={`h-full transition-all duration-500 ${groupProgress >= 100 ? 'bg-emerald-600' : 'bg-sky-600'}`} style={{ width: `${groupProgress}%` }} />
                            </div>
                            <div className="flex gap-1">
                                {[0, 25, 50, 75, 100].map(val => (
                                    <button
                                        key={val}
                                        onClick={() => handleGroupProgress(val)}
                                        disabled={isSaving}
                                        className={`flex-1 py-1 rounded text-[9px] font-bold transition-all border
                                            ${groupProgress === val ? 'bg-sky-600/30 text-sky-300 border-sky-600/50' : 'bg-[#111] text-[#666] border-[#333] hover:text-white hover:border-[#555]'}
                                            ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        {val}%
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Job Badges — colored by product type */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {jobs.length === 0 && (
                    <p className="text-[10px] text-[#444] text-center py-6 font-mono">No assignments</p>
                )}
                {jobs.map(job => {
                    const progress = job.departmentProgress?.[department] ?? 0;
                    const pc = PRODUCT_TYPE_COLORS[job.productType] || PRODUCT_TYPE_COLORS.FAB;
                    const barColor = job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6';
                    const jobSaving = savingProgress === job.id;
                    return (
                        <div key={job.id} className={`border rounded p-2.5 hover:brightness-110 transition-all ${pc.bg} ${pc.border}`}>
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <span className={`text-[11px] font-mono font-bold ${pc.text}`}>{job.id}</span>
                                <span className="text-[9px] font-mono text-[#888]">{job.weldingPoints}pt</span>
                            </div>
                            <p className="text-[11px] text-slate-200 truncate font-medium">{job.name}</p>
                            {/* Mini progress bar */}
                            <div className="mt-1.5 h-1 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden">
                                <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: barColor }} />
                            </div>

                            {/* Individual progress controls when NOT grouped and multiple jobs */}
                            {!grouped && jobs.length > 1 && (
                                <div className="mt-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[8px] text-[#555] font-bold uppercase">Progress</span>
                                        <div className="flex items-center gap-1">
                                            {jobSaving && <Loader2 className="w-2 h-2 text-sky-400 animate-spin" />}
                                            <span className={`text-[9px] font-mono font-bold ${progress >= 100 ? 'text-emerald-400' : progress > 0 ? 'text-sky-400' : 'text-[#555]'}`}>{progress}%</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-0.5">
                                        {[0, 25, 50, 75, 100].map(val => (
                                            <button
                                                key={val}
                                                onClick={() => handleSingleProgress(job.id, val)}
                                                disabled={jobSaving}
                                                className={`flex-1 py-0.5 rounded text-[8px] font-bold transition-all border
                                                    ${progress === val ? 'bg-sky-600/30 text-sky-300 border-sky-600/50' : 'bg-[#111] text-[#555] border-[#222] hover:text-white hover:border-[#444]'}
                                                    ${jobSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            >
                                                {val}%
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
