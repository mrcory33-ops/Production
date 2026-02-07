'use client';

import { ScheduleInsights, MoveOption, OTRecommendation } from '@/types';
import {
    AlertTriangle, Clock, ArrowRightCircle, CalendarClock,
    Flame, TrendingUp, X, ChevronDown, ChevronUp,
    Package, Truck, Shield, AlertCircle, CheckCircle2
} from 'lucide-react';
import { useState } from 'react';

interface Props {
    insights: ScheduleInsights;
    onClose: () => void;
}

// ── Tier color helpers ──
const tierColor = (tier: 1 | 2 | 3 | 4) => {
    switch (tier) {
        case 1: return { bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', text: 'text-yellow-300', badge: 'bg-yellow-500/20 text-yellow-300' };
        case 2: return { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-300', badge: 'bg-amber-500/20 text-amber-300' };
        case 3: return { bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-300', badge: 'bg-orange-500/20 text-orange-300' };
        case 4: return { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-300', badge: 'bg-red-500/20 text-red-300' };
    }
};

export default function ScheduleInsightsPanel({ insights, onClose }: Props) {
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        late: true,
        ot: false,
        moves: true,
        projected: false
    });

    const toggleSection = (key: string) => {
        setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const { summary, lateJobs, overloadedWeeks, moveOptions, otRecommendations, projectedWithMoves, projectedWithMovesAndOT } = insights;

    // Group OT recommendations by week
    const otByWeek = otRecommendations.reduce((acc, ot) => {
        if (!acc[ot.weekKey]) acc[ot.weekKey] = [];
        acc[ot.weekKey].push(ot);
        return acc;
    }, {} as Record<string, OTRecommendation[]>);

    // Group move options: WO vs SO
    const woMoves = moveOptions.filter(m => m.type === 'work_order');
    const soMoves = moveOptions.filter(m => m.type === 'sales_order');

    // Deduplicate WO moves — keep best push for each job
    const bestWOMoves = woMoves.reduce((acc, m) => {
        const existing = acc.find(e => e.id === m.id);
        if (existing) {
            if (m.lateJobsRecovered.length > existing.lateJobsRecovered.length ||
                (m.lateJobsRecovered.length === existing.lateJobsRecovered.length && m.pointsRelieved > existing.pointsRelieved)) {
                Object.assign(existing, m);
            }
        } else {
            acc.push({ ...m });
        }
        return acc;
    }, [] as MoveOption[]);

    // Deduplicate SO moves — keep best push for each SO
    const bestSOMoves = soMoves.reduce((acc, m) => {
        const existing = acc.find(e => e.id === m.id);
        if (existing) {
            if (m.lateJobsRecovered.length > existing.lateJobsRecovered.length ||
                (m.lateJobsRecovered.length === existing.lateJobsRecovered.length && m.pointsRelieved > existing.pointsRelieved)) {
                Object.assign(existing, m);
            }
        } else {
            acc.push({ ...m });
        }
        return acc;
    }, [] as MoveOption[]);

    const hasIssues = lateJobs.length > 0 || overloadedWeeks.length > 0;

    return (
        <div className="fixed inset-0 bg-slate-950/80 z-[1000] flex items-center justify-center backdrop-blur-sm p-4">
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col">

                {/* ════ Header ════ */}
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
                                {summary.totalJobs} jobs analyzed • Decision-support analysis
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* ════ Pipeline Summary Bar ════ */}
                <div className="px-6 py-3 border-b border-slate-800 bg-slate-900/50 shrink-0">
                    <div className="flex items-center justify-between">
                        {/* Current */}
                        <div className="text-center flex-1">
                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">Current</div>
                            <div className={`text-2xl font-bold ${summary.lateJobCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                {summary.lateJobCount}
                            </div>
                            <div className="text-[10px] text-slate-500">late jobs</div>
                        </div>
                        {/* Arrow */}
                        <ArrowRightCircle className="w-4 h-4 text-slate-600 shrink-0" />
                        {/* With Moves */}
                        <div className="text-center flex-1">
                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">With Moves</div>
                            <div className={`text-2xl font-bold ${summary.projectedLateAfterMoves > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {summary.projectedLateAfterMoves}
                            </div>
                            <div className="text-[10px] text-slate-500">late jobs</div>
                        </div>
                        {/* Arrow */}
                        <ArrowRightCircle className="w-4 h-4 text-slate-600 shrink-0" />
                        {/* With OT */}
                        <div className="text-center flex-1">
                            <div className="text-[10px] uppercase text-slate-500 font-bold tracking-wider mb-1">+ Overtime</div>
                            <div className={`text-2xl font-bold ${summary.projectedLateAfterOT > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                {summary.projectedLateAfterOT}
                            </div>
                            <div className="text-[10px] text-slate-500">late jobs</div>
                        </div>
                        {/* Divider */}
                        <div className="w-px h-10 bg-slate-700 mx-3 shrink-0" />
                        {/* Stats */}
                        <div className="text-center flex-1">
                            <div className={`text-2xl font-bold ${summary.weeksRequiringOT > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {summary.weeksRequiringOT}
                            </div>
                            <div className="text-[10px] text-slate-500">OT weeks</div>
                        </div>
                        <div className="text-center flex-1">
                            <div className={`text-2xl font-bold ${summary.totalExcessPoints > 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                                {summary.totalExcessPoints}
                            </div>
                            <div className="text-[10px] text-slate-500">excess pts</div>
                        </div>
                    </div>
                </div>

                {/* ════ Scrollable Content ════ */}
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
                                                        {job.salesOrder && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">SO {job.salesOrder}</span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                                                        <span className="text-slate-400">
                                                            Due: <span className="text-white font-medium">{new Date(job.dueDate).toLocaleDateString()}</span>
                                                        </span>
                                                        <span className="text-red-400">
                                                            Est: <span className="font-medium">{new Date(job.estimatedCompletion).toLocaleDateString()}</span>
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0 ml-4">
                                                    <span className="px-2 py-1 rounded bg-red-500/20 text-red-300 font-bold text-xs">
                                                        {job.daysLate}d LATE
                                                    </span>
                                                    <div className="text-[10px] text-slate-500 mt-1.5">
                                                        Bottleneck: <span className="text-amber-300">{job.bottleneckDept}</span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-500">
                                                        {job.points} pts
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── 2. OT Recommendations ─── */}
                    {otRecommendations.length > 0 && (
                        <section>
                            <button onClick={() => toggleSection('ot')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-amber-400" />
                                    <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider">
                                        Overtime Recommendations ({Object.keys(otByWeek).length} weeks)
                                    </h3>
                                </div>
                                {expandedSections.ot ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.ot && (
                                <div className="space-y-3">
                                    {Object.entries(otByWeek).map(([weekKey, recs]) => (
                                        <div key={weekKey} className="bg-amber-950/15 border border-amber-500/20 rounded-lg p-3">
                                            <div className="flex items-center gap-2 mb-2.5">
                                                <CalendarClock className="w-3.5 h-3.5 text-amber-300" />
                                                <span className="text-sm font-bold text-amber-300">{weekKey}</span>
                                                <span className="text-xs text-amber-400/60">{recs.length} dept{recs.length > 1 ? 's' : ''}</span>
                                            </div>
                                            <div className="space-y-2">
                                                {recs.map((ot, i) => {
                                                    const colors = tierColor(ot.recommendedTier);
                                                    return (
                                                        <div key={i} className={`${colors.bg} border ${colors.border} rounded-lg p-2.5`}>
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <span className="text-sm font-medium text-white">{ot.department}</span>
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${colors.badge}`}>
                                                                    TIER {ot.recommendedTier}: {ot.tierLabel}
                                                                </span>
                                                            </div>
                                                            {/* Capacity bar */}
                                                            <div className="flex items-center gap-2 mb-1.5">
                                                                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                                                                    <div
                                                                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-red-500"
                                                                        style={{ width: `${Math.min((ot.currentLoad / ot.baseCapacity) * 100, 150)}%` }}
                                                                    />
                                                                </div>
                                                                <span className="text-xs text-slate-400 font-mono shrink-0">
                                                                    {ot.currentLoad}/{ot.baseCapacity}
                                                                </span>
                                                                <span className="text-xs text-red-400 font-bold font-mono shrink-0">
                                                                    +{ot.excess}pts
                                                                </span>
                                                            </div>
                                                            {/* Schedule details */}
                                                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-1.5">
                                                                <div className="bg-slate-900/50 rounded px-2 py-1">
                                                                    <span className="text-slate-500">Mon-Fri: </span>
                                                                    <span className={colors.text}>{ot.weekdayHours}</span>
                                                                </div>
                                                                <div className="bg-slate-900/50 rounded px-2 py-1">
                                                                    <span className="text-slate-500">Saturday: </span>
                                                                    <span className={ot.saturdayHours === 'N/A' ? 'text-slate-600' : colors.text}>
                                                                        {ot.saturdayHours}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {/* Bonus & result */}
                                                            <div className="flex items-center gap-3 text-[10px]">
                                                                <span className="text-emerald-400 font-bold">+{ot.bonusPoints}pts capacity</span>
                                                                {ot.remainingExcess <= 0 ? (
                                                                    <span className="text-emerald-400 flex items-center gap-1">
                                                                        <CheckCircle2 className="w-3 h-3" /> Fully covered
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-red-400 flex items-center gap-1">
                                                                        <AlertCircle className="w-3 h-3" /> {ot.remainingExcess}pts still uncovered
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Explanation */}
                                                            <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">{ot.explanation}</p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── 3. Move Options (WO + SO side by side) ─── */}
                    {moveOptions.length > 0 && (
                        <section>
                            <button onClick={() => toggleSection('moves')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <ArrowRightCircle className="w-4 h-4 text-cyan-400" />
                                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
                                        Move Options ({bestWOMoves.length} WO + {bestSOMoves.length} SO)
                                    </h3>
                                </div>
                                {expandedSections.moves ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.moves && (
                                <div className="space-y-3">
                                    {/* Work Order options */}
                                    {bestWOMoves.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-2 mb-2 pl-1">
                                                <Package className="w-3.5 h-3.5 text-cyan-400" />
                                                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                                    Work Order Moves — Individual Jobs
                                                </span>
                                            </div>
                                            <div className="space-y-1.5">
                                                {bestWOMoves.slice(0, 10).map((m, i) => (
                                                    <MoveOptionCard key={`wo-${i}`} move={m} />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Sales Order options */}
                                    {bestSOMoves.length > 0 && (
                                        <div className="mt-3">
                                            <div className="flex items-center gap-2 mb-2 pl-1">
                                                <Truck className="w-3.5 h-3.5 text-purple-400" />
                                                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                                    Sales Order Moves — Entire Projects
                                                </span>
                                            </div>
                                            <div className="space-y-1.5">
                                                {bestSOMoves.slice(0, 10).map((m, i) => (
                                                    <MoveOptionCard key={`so-${i}`} move={m} isSO />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ─── 4. Projected Outcome ─── */}
                    {hasIssues && (
                        <section>
                            <button onClick={() => toggleSection('projected')} className="flex items-center justify-between w-full mb-3 group">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                                    <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                                        Projected Outcome
                                    </h3>
                                </div>
                                {expandedSections.projected ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                            </button>
                            {expandedSections.projected && (
                                <div className="space-y-3">
                                    {/* After Moves */}
                                    <div className="bg-cyan-950/10 border border-cyan-500/15 rounded-lg p-3">
                                        <div className="text-xs font-bold text-cyan-300 mb-2">After Suggested Moves</div>
                                        {projectedWithMoves.lateJobs.length === 0 ? (
                                            <div className="flex items-center gap-2 text-emerald-400 text-sm">
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span className="font-medium">All jobs on time!</span>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-xs text-slate-400 mb-2">
                                                    {projectedWithMoves.lateJobs.length} job{projectedWithMoves.lateJobs.length > 1 ? 's' : ''} still late:
                                                </p>
                                                <div className="space-y-1">
                                                    {projectedWithMoves.lateJobs.map(lj => (
                                                        <div key={lj.jobId} className="flex items-center justify-between text-xs">
                                                            <span className="font-mono text-red-300">{lj.jobId}</span>
                                                            <span className="text-slate-400">{lj.daysLate}d late • {lj.bottleneckDept}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* After Moves + OT */}
                                    <div className="bg-emerald-950/10 border border-emerald-500/15 rounded-lg p-3">
                                        <div className="text-xs font-bold text-emerald-300 mb-2">After Moves + Overtime</div>
                                        {projectedWithMovesAndOT.lateJobs.length === 0 ? (
                                            <div className="flex items-center gap-2 text-emerald-400 text-sm">
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span className="font-medium">All jobs on time!</span>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-xs text-amber-300 mb-2 flex items-center gap-1.5">
                                                    <AlertTriangle className="w-3.5 h-3.5" />
                                                    {projectedWithMovesAndOT.lateJobs.length} job{projectedWithMovesAndOT.lateJobs.length > 1 ? 's' : ''} still late even with max OT — escalation needed
                                                </p>
                                                <div className="space-y-1">
                                                    {projectedWithMovesAndOT.lateJobs.map(lj => (
                                                        <div key={lj.jobId} className="flex items-center justify-between text-xs">
                                                            <span className="font-mono text-red-300">{lj.jobId}</span>
                                                            <span className="text-slate-400">{lj.daysLate}d late • {lj.bottleneckDept}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
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

                {/* ════ Footer ════ */}
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

// ═════════════════════════════════════════════════════
// Move Option Card (used for both WO and SO)
// ═════════════════════════════════════════════════════

function MoveOptionCard({ move, isSO }: { move: MoveOption; isSO?: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const accentColor = isSO ? 'purple' : 'cyan';
    const recovers = move.lateJobsRecovered.length;

    return (
        <div className={`bg-${accentColor}-950/15 border border-${accentColor}-500/15 rounded-lg overflow-hidden`}
            style={{
                background: isSO ? 'rgba(88, 28, 135, 0.08)' : 'rgba(8, 51, 68, 0.15)',
                borderColor: isSO ? 'rgba(168, 85, 247, 0.15)' : 'rgba(6, 182, 212, 0.15)'
            }}
        >
            <button onClick={() => setExpanded(!expanded)} className="w-full p-2.5 text-left">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm font-mono font-bold ${isSO ? 'text-purple-300' : 'text-cyan-300'}`}>
                            {isSO ? `SO ${move.id}` : move.id}
                        </span>
                        <span className="text-xs text-slate-400 truncate">{move.name}</span>
                        {isSO && move.jobIds.length > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/15 text-purple-300 rounded">
                                {move.jobIds.length} jobs
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Risk badge */}
                        {move.riskLevel === 'safe' ? (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                                <Shield className="w-2.5 h-2.5" /> Safe
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                <AlertCircle className="w-2.5 h-2.5" /> Close
                            </span>
                        )}
                        {/* Recovery badge */}
                        {recovers > 0 ? (
                            <span className="text-xs font-bold text-emerald-400">
                                ↑{recovers} recovered
                            </span>
                        ) : (
                            <span className="text-xs text-slate-500">No recoveries</span>
                        )}
                        <span className="text-xs font-bold text-emerald-400/70">
                            -{move.pointsRelieved}pts
                        </span>
                    </div>
                </div>
                {/* Date change */}
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <span>{new Date(move.currentDueDate).toLocaleDateString()}</span>
                    <ArrowRightCircle className={`w-3 h-3 ${isSO ? 'text-purple-500' : 'text-cyan-500'}`} />
                    <span className={`font-medium ${isSO ? 'text-purple-300' : 'text-cyan-300'}`}>
                        {new Date(move.suggestedDueDate).toLocaleDateString()}
                    </span>
                    <span className="text-slate-500">
                        (+{move.pushWeeks}wk)
                    </span>
                </div>
            </button>

            {/* Expanded details */}
            {expanded && (
                <div className="px-2.5 pb-2.5 border-t border-slate-800/50 pt-2 space-y-1.5">
                    <p className="text-[11px] text-slate-300 leading-relaxed">{move.impactSummary}</p>
                    {move.lateJobsRecovered.length > 0 && (
                        <div className="text-[10px] text-emerald-400">
                            Jobs recovered: {move.lateJobsRecovered.join(', ')}
                        </div>
                    )}
                    <div className="text-[10px] text-slate-500">
                        Affects: {move.affectedDepartments.join(', ')} • Weeks: {move.affectedWeeks.join(', ')}
                    </div>
                    {isSO && move.jobIds.length > 1 && (
                        <div className="text-[10px] text-slate-500">
                            Jobs in SO: {move.jobIds.join(', ')}
                        </div>
                    )}
                    <div className="flex items-center gap-3 text-[10px] mt-1">
                        <span className="text-slate-500">
                            Before: <span className="text-red-300 font-bold">{move.lateJobsBefore} late</span>
                        </span>
                        <ArrowRightCircle className="w-3 h-3 text-slate-600" />
                        <span className="text-slate-500">
                            After: <span className={`font-bold ${move.lateJobsAfter > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{move.lateJobsAfter} late</span>
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
