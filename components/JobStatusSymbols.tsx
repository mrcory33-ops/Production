'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Job } from '@/types';
import { X } from 'lucide-react';

interface StatusSymbol {
    key: string;
    icon: string;
    label: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
    explanation: string;
}

function getJobSymbols(job: Job): StatusSymbol[] {
    const symbols: StatusSymbol[] = [];

    // Scheduling Conflict — system could not meet due date
    if (job.schedulingConflict) {
        symbols.push({
            key: 'conflict',
            icon: '!',
            label: 'Scheduling Conflict',
            bgClass: 'bg-red-100',
            borderClass: 'border-red-300',
            textClass: 'text-red-600',
            explanation: `This job cannot meet its due date within the current capacity limits. ` +
                `The scheduler placed all departments starting from today (to avoid scheduling in the past), ` +
                `but the total time required exceeds the time available before the due date. ` +
                `Consider: overtime, moving other jobs later, or requesting a due date extension.`
        });
    }

    // STALLED — no progress + behind schedule → OT candidate
    if (job.progressStatus === 'STALLED') {
        symbols.push({
            key: 'stalled',
            icon: 'OT?',
            label: 'Overtime Candidate',
            bgClass: 'bg-orange-100',
            borderClass: 'border-orange-300',
            textClass: 'text-orange-600',
            explanation: `This job has stalled — it hasn't progressed for 2+ work days and is behind schedule. ` +
                `Without intervention, it will likely miss its due date. ` +
                `Overtime (Saturday work) is recommended to get it back on track. ` +
                `The system detected this by comparing the job's current department against its scheduled department for today.`
        });
    }

    // SLIPPING — behind schedule but still progressing
    if (job.progressStatus === 'SLIPPING') {
        symbols.push({
            key: 'slipping',
            icon: '⚠',
            label: 'Slipping Behind',
            bgClass: 'bg-yellow-100',
            borderClass: 'border-yellow-300',
            textClass: 'text-yellow-600',
            explanation: `This job is falling behind its scheduled timeline. ` +
                `It is still progressing but slower than planned. The current department or ` +
                `completion timeline indicates it won't finish on the original schedule. ` +
                `If it continues slipping, it may become an overtime candidate.`
        });
    }

    // AHEAD — progressed past expected department
    if (job.progressStatus === 'AHEAD') {
        symbols.push({
            key: 'ahead',
            icon: '🚀',
            label: 'Ahead of Schedule',
            bgClass: 'bg-emerald-100',
            borderClass: 'border-emerald-300',
            textClass: 'text-emerald-600',
            explanation: `Great news — this job has advanced past its expected department! ` +
                `It's running ahead of schedule. This freed-up capacity can be applied ` +
                `to other jobs in the earlier department(s).`
        });
    }

    // Due Date Changed — needs reschedule
    if (job.needsReschedule) {
        const prev = job.previousDueDate ? new Date(job.previousDueDate).toLocaleDateString() : '?';
        const curr = new Date(job.dueDate).toLocaleDateString();
        symbols.push({
            key: 'reschedule',
            icon: '📅',
            label: 'Due Date Changed',
            bgClass: 'bg-purple-100',
            borderClass: 'border-purple-300',
            textClass: 'text-purple-600',
            explanation: `The customer or sales team changed this job's due date. ` +
                `Previous: ${prev} → Now: ${curr}. ` +
                `The schedule was built with the old due date, so this job may need to be ` +
                `re-prioritized or rescheduled to meet the new deadline. ` +
                `Re-import the schedule or manually adjust dates on the Gantt chart.`
        });
    }

    // OT Needed — overloaded capacity weeks intersect this job's schedule
    if (job.schedulingConflict && job.progressStatus !== 'STALLED') {
        // Only add if not already showing OT? from STALLED
        const hasOTSymbol = symbols.some(s => s.key === 'stalled');
        if (!hasOTSymbol) {
            symbols.push({
                key: 'ot-needed',
                icon: '⏱',
                label: 'OT Likely Needed',
                bgClass: 'bg-amber-100',
                borderClass: 'border-amber-300',
                textClass: 'text-amber-700',
                explanation: `Based on current capacity, this job is scheduled beyond its due date. ` +
                    `Overtime (Saturday shifts) will likely be needed to bring it back on time. ` +
                    `The scheduler detected that the total work points in the affected week(s) ` +
                    `exceed the 850-point weekly capacity for at least one department.`
            });
        }
    }

    return symbols;
}

interface SymbolButtonProps {
    symbol: StatusSymbol;
}

function SymbolButton({ symbol }: SymbolButtonProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Calculate position when opening
    useEffect(() => {
        if (!open || !buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const popoverWidth = 288; // w-72 = 18rem = 288px

        // Position below the button, clamped to viewport
        let left = rect.left;
        let top = rect.bottom + 4;

        // Clamp to right edge of viewport
        if (left + popoverWidth > window.innerWidth - 8) {
            left = window.innerWidth - popoverWidth - 8;
        }
        // Clamp to left edge
        if (left < 8) left = 8;

        // If popover would go below viewport, show above instead
        if (top + 120 > window.innerHeight) {
            top = rect.top - 4; // will use bottom-positioning in CSS
        }

        setPopoverPos({ top, left });
    }, [open]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                buttonRef.current && !buttonRef.current.contains(target) &&
                popoverRef.current && !popoverRef.current.contains(target)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    // Close on scroll (the table scrolls, position would be stale)
    useEffect(() => {
        if (!open) return;
        const handleScroll = () => setOpen(false);
        // Capture phase to catch scroll on any container
        document.addEventListener('scroll', handleScroll, true);
        return () => document.removeEventListener('scroll', handleScroll, true);
    }, [open]);

    return (
        <>
            <button
                ref={buttonRef}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
                className={`flex items-center justify-center min-w-[20px] h-5 px-1 ${symbol.bgClass} border ${symbol.borderClass} rounded cursor-pointer 
                           hover:brightness-95 active:scale-95 transition-all`}
            >
                <span className={`text-[10px] ${symbol.textClass} font-bold leading-none`}>{symbol.icon}</span>
            </button>

            {open && createPortal(
                <div
                    ref={popoverRef}
                    className="w-72 bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 overflow-hidden"
                    style={{
                        position: 'fixed',
                        top: `${popoverPos.top}px`,
                        left: `${popoverPos.left}px`,
                        zIndex: 9999,
                        animation: 'fadeIn 0.12s ease-out',
                    }}
                >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 bg-slate-800/50">
                        <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 ${symbol.bgClass} border ${symbol.borderClass} rounded`}>
                                <span className={`text-[10px] ${symbol.textClass} font-bold leading-none`}>{symbol.icon}</span>
                            </span>
                            <span className="text-xs font-bold text-white">{symbol.label}</span>
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpen(false);
                            }}
                            className="p-0.5 text-slate-400 hover:text-white rounded transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="px-3 py-2.5">
                        <p className="text-[11px] text-slate-300 leading-relaxed">{symbol.explanation}</p>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

interface JobStatusSymbolsProps {
    job: Job;
}

export default function JobStatusSymbols({ job }: JobStatusSymbolsProps) {
    const symbols = getJobSymbols(job);
    if (symbols.length === 0) return null;

    return (
        <div className="flex items-center gap-0.5 shrink-0">
            {symbols.map(s => (
                <SymbolButton key={s.key} symbol={s} />
            ))}
        </div>
    );
}

export { getJobSymbols };
