'use client';

import { ScheduleInsights } from '@/types';
import { AlertTriangle, Clock, ArrowRightCircle, CalendarClock, Flame, TrendingUp, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface Props {
    insights: ScheduleInsights;
    onClose: () => void;
}

export default function ScheduleInsightsPanel({ insights, onClose }: Props) {
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        late: true,
        overtime: true,
        suggestions: true
    });

    const toggleSection = (key: string) => {
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const { summary, lateJobs, overloadedWeeks, moveSuggestions } = insights;

    // Group overloaded weeks by week
    const weekGroups = overloadedWeeks.reduce((acc, w) => {
        if (!acc[w.weekKey]) acc[w.weekKey] = [];
        acc[w.weekKey].push(w);
        return acc;
    }, {} as Record<string, typeof overloadedWeeks>);

    const hasIssues = lateJobs.length > 0 || overloadedWeeks.length > 0;

    return (
        <div className="fixed inset-0 bg-slate-950/80 z-[1000] flex items-center justify-center backdrop-blur-sm p-4">
            <div className="relative w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50 bg-slate-900/80 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${hasIssues ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                            {hasIssues
                                ? <AlertTriangle className="w-5 h-5 text-amber-400" />
                                : <TrendingUp className="w-5 h-5 text-emerald-400" />
                            }
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Schedule Insights</h2>
                            <p className="text-xs text-slate-400">
                                {summary.totalJobs} jobs analyzed • {summary.onTimeJobs} on-time • {summary.lateJobCount} at risk
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Summary Bar */}
                <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-slate-800 bg-slate-900/50 shrink-0">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-white">{summary.totalJobs}</div>
                        <div className="text-[10px] uppercase text-slate-500 font-medium tracking-wider">Total Jobs</div>
                    </div>
                    <div className="text-center">
                        <div className={`text-2xl font-bold ${summary.lateJobCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {summary.lateJobCount}
                        </div>
                        <div className="text-[10px] uppercase text-slate-500 font-medium tracking-wider">Will Be Late</div>
                    </div>
                    <div className="text-center">
                        <div className={`text-2xl font-bold ${summary.weeksRequiringOT > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {summary.weeksRequiringOT}
                        </div>
                        <div className="text-[10px] uppercase text-slate-500 font-medium tracking-wider">Weeks Need OT</div>
                    </div>
                    <div className="text-center">
                        <div className={`text-2xl font-bold ${summary.totalExcessPoints > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                            {summary.totalExcessPoints}
                        </div>
                        <div className="text-[10px] uppercase text-slate-500 font-medium tracking-wider">Excess Points</div>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
                    {/* ─── 1. Late Jobs ─── */}
                    {lateJobs.length > 0 && (
                        <section>
                            <button onClick={() => toggleSection('late')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <Flame className="w-4 h-4 text-red-400" />
                                    <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider">
                                        Jobs That Will Be Late ({lateJobs.length})
                                    </h3>
                                </div>
                                {expandedSections.late ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.late && (
                                <div className="space-y-2">
                                    {lateJobs.map(job => (
                                        <div key={job.jobId} className="bg-red-950/20 border border-red-500/20 rounded-lg p-3">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-mono font-bold text-red-300">{job.jobId}</span>
                                                        <span className="text-xs text-slate-400 truncate max-w-[200px]">{job.jobName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                                                        <span className="text-slate-400">
                                                            Due: <span className="text-white font-medium">{new Date(job.dueDate).toLocaleDateString()}</span>
                                                        </span>
                                                        <span className="text-red-400">
                                                            Est: <span className="font-medium">{new Date(job.estimatedCompletion).toLocaleDateString()}</span>
                                                        </span>
                                                        <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold text-[10px]">
                                                            {job.daysLate}d LATE
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0 ml-4">
                                                    <div className="text-[10px] uppercase text-slate-500 tracking-wider">With OT</div>
                                                    <div className={`text-sm font-bold ${job.daysLateWithOT > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                        {job.daysLateWithOT > 0
                                                            ? `Still ${job.daysLateWithOT}d late`
                                                            : '✓ On Time'}
                                                    </div>
                                                    <div className="text-[10px] text-slate-500">
                                                        Bottleneck: <span className="text-amber-300">{job.bottleneckDept}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── 2. Overloaded Weeks / OT Needs ─── */}
                    {overloadedWeeks.length > 0 && (
                        <section>
                            <button onClick={() => toggleSection('overtime')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-amber-400" />
                                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                                        Overtime Required ({Object.keys(weekGroups).length} weeks)
                                    </h3>
                                </div>
                                {expandedSections.overtime ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.overtime && (
                                <div className="space-y-2">
                                    {Object.entries(weekGroups).map(([weekKey, depts]) => (
                                        <div key={weekKey} className="bg-amber-950/15 border border-amber-500/20 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <CalendarClock className="w-3.5 h-3.5 text-amber-300" />
                                                    <span className="text-sm font-bold text-amber-300">{weekKey}</span>
                                                </div>
                                                <span className="text-xs text-amber-400/70">
                                                    {depts.length} dept{depts.length > 1 ? 's' : ''} over capacity
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {depts.map((d, i) => (
                                                    <div key={i} className="flex items-center justify-between text-xs">
                                                        <span className="text-slate-300 font-medium">{d.department}</span>
                                                        <div className="flex items-center gap-3">
                                                            {/* Capacity bar */}
                                                            <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500"
                                                                    style={{ width: `${Math.min((d.scheduledPoints / d.capacity) * 100, 150)}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-slate-400 font-mono w-20 text-right">
                                                                {d.scheduledPoints}/{d.capacity}
                                                            </span>
                                                            <span className="text-red-400 font-bold font-mono w-16 text-right">
                                                                +{d.excess}pts
                                                            </span>
                                                            <span className="text-amber-300 font-mono w-14 text-right">
                                                                ~{d.estimatedOTHours}h OT
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── 3. Move Suggestions ─── */}
                    {moveSuggestions.length > 0 && (
                        <section>
                            <button onClick={() => toggleSection('suggestions')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <ArrowRightCircle className="w-4 h-4 text-cyan-400" />
                                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                                        Suggested Moves ({moveSuggestions.length})
                                    </h3>
                                </div>
                                {expandedSections.suggestions ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.suggestions && (
                                <div className="space-y-2">
                                    {/* Work Order suggestions */}
                                    {moveSuggestions.filter(s => s.type === 'work_order').length > 0 && (
                                        <div>
                                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1.5 pl-1">
                                                Work Orders — Move Due Date
                                            </div>
                                            {moveSuggestions.filter(s => s.type === 'work_order').map((s, i) => (
                                                <div key={i} className="bg-cyan-950/15 border border-cyan-500/15 rounded-lg p-2.5 mb-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <span className="text-sm font-mono font-bold text-cyan-300">{s.id}</span>
                                                            <span className="text-xs text-slate-400 ml-2 truncate">{s.name}</span>
                                                        </div>
                                                        <span className="text-xs font-bold text-emerald-400 shrink-0">
                                                            -{s.pointsRelieved}pts
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                                                        <span>{new Date(s.currentDueDate).toLocaleDateString()}</span>
                                                        <ArrowRightCircle className="w-3 h-3 text-cyan-500" />
                                                        <span className="text-cyan-300 font-medium">{new Date(s.suggestedDueDate).toLocaleDateString()}</span>
                                                        <span className="text-slate-500 ml-1">• {s.benefitDescription}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Sales Order suggestions */}
                                    {moveSuggestions.filter(s => s.type === 'sales_order').length > 0 && (
                                        <div className="mt-3">
                                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1.5 pl-1">
                                                Sales Orders — Move Entire Project
                                            </div>
                                            {moveSuggestions.filter(s => s.type === 'sales_order').map((s, i) => (
                                                <div key={i} className="bg-purple-950/15 border border-purple-500/15 rounded-lg p-2.5 mb-1.5">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <span className="text-sm font-bold text-purple-300">{s.name}</span>
                                                        </div>
                                                        <span className="text-xs font-bold text-emerald-400 shrink-0">
                                                            -{s.pointsRelieved}pts
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                                                        <span>{new Date(s.currentDueDate).toLocaleDateString()}</span>
                                                        <ArrowRightCircle className="w-3 h-3 text-purple-500" />
                                                        <span className="text-purple-300 font-medium">{new Date(s.suggestedDueDate).toLocaleDateString()}</span>
                                                        <span className="text-slate-500 ml-1">• {s.benefitDescription}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500 mt-1">
                                                        Affects: {s.jobsAffected.join(', ')}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── All Clear ─── */}
                    {!hasIssues && (
                        <div className="text-center py-12">
                            <div className="text-4xl mb-3">✨</div>
                            <h3 className="text-xl font-bold text-emerald-400 mb-1">All Clear</h3>
                            <p className="text-sm text-slate-400">All jobs are scheduled within capacity — no overtime needed.</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-slate-700/50 bg-slate-900/80 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded-lg text-sm font-medium
                                   shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95"
                    >
                        Got It
                    </button>
                </div>
            </div>
        </div>
    );
}
