'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, ArrowRight, Clock, AlertTriangle, Zap } from 'lucide-react';
import { RescheduleSuggestion } from '@/lib/scheduler';
import { formatWeekKeyForDisplay } from '@/lib/weekFormatting';

interface RescheduleSuggestionPopoverProps {
    suggestion: RescheduleSuggestion;
    onAccept: (suggestion: RescheduleSuggestion) => void;
    onDismiss: (jobId: string) => void;
    onClose?: () => void;
}

const STRATEGY_CONFIG = {
    direct: {
        badge: 'Clean Fit',
        badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        icon: Check,
    },
    move_jobs: {
        badge: 'Requires Job Moves',
        badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        icon: ArrowRight,
    },
    ot: {
        badge: 'Requires Overtime',
        badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
        icon: Clock,
    },
    no_fit: {
        badge: 'No Clean Fit',
        badgeColor: 'bg-red-500/20 text-red-400 border-red-500/30',
        icon: AlertTriangle,
    },
} as const;

const DEPT_ORDER = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

export default function RescheduleSuggestionPopover({
    suggestion,
    onAccept,
    onDismiss,
    onClose,
}: RescheduleSuggestionPopoverProps) {
    const [isClosing, setIsClosing] = useState(false);

    const config = STRATEGY_CONFIG[suggestion.strategy];
    const StrategyIcon = config.icon;

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => onClose ? onClose() : onDismiss(suggestion.jobId), 150);
    };

    const handleDismiss = () => {
        setIsClosing(true);
        setTimeout(() => onDismiss(suggestion.jobId), 150);
    };

    const handleAccept = () => {
        setIsClosing(true);
        setTimeout(() => onAccept(suggestion), 150);
    };

    // Get departments that have schedule entries
    const allDepts = DEPT_ORDER.filter(
        d => suggestion.currentSchedule[d] || suggestion.suggestedSchedule[d]
    );

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 10000 }}
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                style={{
                    animation: isClosing ? 'fadeOut 0.15s ease-in forwards' : 'fadeIn 0.15s ease-out',
                }}
                onClick={handleClose}
            />

            {/* Modal */}
            <div
                className="relative w-[520px] max-h-[85vh] bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700/80 overflow-hidden flex flex-col"
                style={{
                    animation: isClosing
                        ? 'popoverOut 0.15s ease-in forwards'
                        : 'popoverIn 0.2s ease-out',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/50 bg-slate-800/60">
                    <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 bg-purple-500/20 border border-purple-500/30 rounded-lg">
                            <span className="text-base">📅</span>
                        </span>
                        <div>
                            <h2 className="text-sm font-bold text-white leading-tight">
                                Reschedule Suggestion
                            </h2>
                            <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                                {suggestion.jobName}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body — scrollable */}
                <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

                    {/* Due Date Change Row */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/30">
                        <div className="flex-1 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Previous</p>
                            <p className="text-sm font-bold text-slate-300 mt-0.5">{suggestion.previousDueDate}</p>
                        </div>
                        <div className="flex flex-col items-center">
                            <ArrowRight className="w-4 h-4 text-purple-400" />
                            <span className="text-[9px] text-purple-400/80 mt-0.5">
                                {suggestion.shiftDirection === 'earlier' ? `${suggestion.shiftWorkDays}d earlier` :
                                    suggestion.shiftDirection === 'later' ? `${suggestion.shiftWorkDays}d later` :
                                        'No change'}
                            </span>
                        </div>
                        <div className="flex-1 text-center">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">New</p>
                            <p className="text-sm font-bold text-white mt-0.5">{suggestion.newDueDate}</p>
                        </div>
                    </div>

                    {/* Strategy Badge */}
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border ${config.badgeColor}`}>
                            <StrategyIcon className="w-3 h-3" />
                            {config.badge}
                        </span>
                        {suggestion.hasConflict && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border bg-red-500/20 text-red-400 border-red-500/30">
                                <AlertTriangle className="w-3 h-3" />
                                Will miss due date
                            </span>
                        )}
                    </div>

                    {/* Summary */}
                    <p className="text-[11px] text-slate-300 leading-relaxed">{suggestion.summary}</p>

                    {/* Schedule Comparison Table */}
                    <div>
                        <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                            Schedule Comparison
                        </h3>
                        <div className="rounded-lg border border-slate-700/50 overflow-hidden">
                            <table className="w-full text-[11px]">
                                <thead>
                                    <tr className="bg-slate-800/80">
                                        <th className="text-left px-3 py-1.5 text-slate-400 font-medium">Dept</th>
                                        <th className="text-center px-2 py-1.5 text-slate-400 font-medium">Current</th>
                                        <th className="text-center px-1 py-1.5 text-slate-400 font-medium"></th>
                                        <th className="text-center px-2 py-1.5 text-slate-400 font-medium">Suggested</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allDepts.map((dept, i) => {
                                        const cur = suggestion.currentSchedule[dept];
                                        const sug = suggestion.suggestedSchedule[dept];
                                        const changed = cur && sug && (
                                            cur.start.split('T')[0] !== sug.start.split('T')[0] ||
                                            cur.end.split('T')[0] !== sug.end.split('T')[0]
                                        );
                                        return (
                                            <tr
                                                key={dept}
                                                className={`border-t border-slate-700/30 ${changed ? 'bg-purple-500/5' : ''} ${i % 2 === 0 ? 'bg-slate-800/20' : ''}`}
                                            >
                                                <td className="px-3 py-1.5 text-slate-300 font-medium">{dept}</td>
                                                <td className="text-center px-2 py-1.5 text-slate-400">
                                                    {cur ? `${formatDate(cur.start)} – ${formatDate(cur.end)}` : '—'}
                                                </td>
                                                <td className="text-center px-1 py-1.5">
                                                    {changed ? <ArrowRight className="w-3 h-3 text-purple-400 mx-auto" /> : null}
                                                </td>
                                                <td className={`text-center px-2 py-1.5 ${changed ? 'text-purple-300 font-semibold' : 'text-slate-400'}`}>
                                                    {sug ? `${formatDate(sug.start)} – ${formatDate(sug.end)}` : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Job Shifts (Tier 2) */}
                    {suggestion.jobShifts.length > 0 && (
                        <div>
                            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                                Jobs That Need to Move
                            </h3>
                            <div className="space-y-1.5">
                                {suggestion.jobShifts.map((shift, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
                                    >
                                        <span className="text-[11px] text-amber-300 font-medium">{shift.jobName}</span>
                                        <span className="text-[10px] text-amber-400/80">+{shift.workDays} work days</span>
                                    </div>
                                ))}
                                <p className="text-[10px] text-emerald-400/80 mt-1">
                                    ✓ All shifted jobs remain on-time
                                </p>
                            </div>
                        </div>
                    )}

                    {/* OT Requirements (Tier 3) */}
                    {suggestion.otRequirements && suggestion.otRequirements.length > 0 && (
                        <div>
                            <h3 className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">
                                Overtime Required
                            </h3>
                            <div className="space-y-1.5">
                                {suggestion.otRequirements.map((ot, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/20"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Zap className="w-3 h-3 text-orange-400" />
                                            <span className="text-[11px] text-orange-300 font-medium">
                                                {ot.department} — {formatWeekKeyForDisplay(ot.weekKey)}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-orange-400/80">
                                            Tier {ot.requiredTier}: {ot.tierLabel}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-700/50 bg-slate-800/40">
                    <button
                        onClick={handleDismiss}
                        className="px-4 py-2 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors"
                    >
                        Dismiss
                    </button>
                    <button
                        onClick={handleAccept}
                        className="px-4 py-2 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/50 rounded-lg transition-colors flex items-center gap-1.5"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Accept Placement
                    </button>
                </div>
            </div>

            {/* Animations */}
            <style jsx global>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes fadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes popoverIn {
                    from { opacity: 0; transform: scale(0.95) translateY(10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes popoverOut {
                    from { opacity: 1; transform: scale(1) translateY(0); }
                    to { opacity: 0; transform: scale(0.95) translateY(10px); }
                }
            `}</style>
        </div>,
        document.body
    );
}
