'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Job, SupervisorAlert } from '@/types';
import { X } from 'lucide-react';

interface StatusSymbol {
    key: string;
    icon: string;
    label: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
    explanation: string;
    actionType?: 'reschedule' | 'po-details';
    jobId?: string;
}

function getJobSymbols(job: Job, alerts?: SupervisorAlert[]): StatusSymbol[] {
    const symbols: StatusSymbol[] = [];

    if (job.schedulingConflict) {
        symbols.push({
            key: 'conflict',
            icon: '!',
            label: 'Scheduling Conflict',
            bgClass: 'bg-red-100',
            borderClass: 'border-red-300',
            textClass: 'text-red-600',
            explanation:
                `This job cannot meet its due date within current capacity. ` +
                `The scheduler placed departments from today forward, but required time still exceeds available time. ` +
                `Consider overtime, reprioritizing other jobs, or a due date extension.`,
        });
    }

    if (job.progressStatus === 'STALLED') {
        symbols.push({
            key: 'stalled',
            icon: 'OT?',
            label: 'Overtime Candidate',
            bgClass: 'bg-orange-100',
            borderClass: 'border-orange-300',
            textClass: 'text-orange-600',
            explanation:
                `This job has not progressed for 2+ work days and is behind schedule. ` +
                `Without intervention, it is likely to miss due date.`,
        });
    }

    if (job.progressStatus === 'SLIPPING' && !job.schedulingConflict) {
        symbols.push({
            key: 'slipping',
            icon: 'WARN',
            label: 'Slipping Behind',
            bgClass: 'bg-yellow-100',
            borderClass: 'border-yellow-300',
            textClass: 'text-yellow-600',
            explanation:
                `This job is behind its planned timeline but still progressing. ` +
                `If the trend continues, it may need overtime or reprioritization.`,
        });
    }

    if (job.progressStatus === 'AHEAD') {
        symbols.push({
            key: 'ahead',
            icon: 'AHEAD',
            label: 'Ahead of Schedule',
            bgClass: 'bg-emerald-100',
            borderClass: 'border-emerald-300',
            textClass: 'text-emerald-600',
            explanation:
                `This job has advanced past its expected department and is running ahead of schedule.`,
        });
    }

    if (job.needsReschedule) {
        const previous = job.previousDueDate ? new Date(job.previousDueDate).toLocaleDateString() : '?';
        const current = new Date(job.dueDate).toLocaleDateString();
        symbols.push({
            key: 'reschedule',
            icon: 'DUE',
            label: 'Due Date Changed',
            bgClass: 'bg-purple-100',
            borderClass: 'border-purple-300',
            textClass: 'text-purple-600',
            explanation:
                `Due date changed. Previous: ${previous}. Current: ${current}. ` +
                `This job should be reviewed for rescheduling.`,
            actionType: 'reschedule',
            jobId: job.id,
        });
    }

    if (job.schedulingConflict && job.progressStatus !== 'STALLED') {
        const alreadyMarkedStalled = symbols.some((s) => s.key === 'stalled');
        if (!alreadyMarkedStalled) {
            symbols.push({
                key: 'ot-needed',
                icon: 'OT',
                label: 'OT Likely Needed',
                bgClass: 'bg-amber-100',
                borderClass: 'border-amber-300',
                textClass: 'text-amber-700',
                explanation:
                    `Current capacity places this job beyond due date. ` +
                    `Overtime is likely required to recover schedule.`,
            });
        }
    }

    if (job.openPOs && !job.closedPOs) {
        symbols.push({
            key: 'open-po',
            icon: 'Open PO',
            label: 'Open PO',
            bgClass: 'bg-orange-100',
            borderClass: 'border-orange-400',
            textClass: 'text-orange-700',
            explanation: `Purchase orders are open and no receipts are complete yet.`,
            actionType: 'po-details',
            jobId: job.id,
        });
    }

    if (job.openPOs && job.closedPOs) {
        symbols.push({
            key: 'partial-po',
            icon: 'Partial',
            label: 'Partially Received',
            bgClass: 'bg-yellow-100',
            borderClass: 'border-yellow-400',
            textClass: 'text-yellow-700',
            explanation: `Some PO lines are received, but one or more lines remain open.`,
            actionType: 'po-details',
            jobId: job.id,
        });
    }

    if (!job.openPOs && job.closedPOs) {
        symbols.push({
            key: 'received-po',
            icon: 'Received',
            label: 'Received',
            bgClass: 'bg-emerald-100',
            borderClass: 'border-emerald-400',
            textClass: 'text-emerald-700',
            explanation: `All purchase orders for this job are fully received.`,
            actionType: 'po-details',
            jobId: job.id,
        });
    }

    if (alerts && alerts.length > 0) {
        if (alerts.some((a) => a.isCsiNotReceived)) {
            symbols.push({
                key: 'csi-missing',
                icon: 'CSI',
                label: 'CSI Not Received',
                bgClass: 'bg-amber-100',
                borderClass: 'border-amber-400',
                textClass: 'text-amber-700',
                explanation: `A supervisor alert indicates missing CSI information.`,
            });
        }

        if (alerts.some((a) => a.isOutOfStock)) {
            symbols.push({
                key: 'out-of-stock',
                icon: 'OOS',
                label: 'Out of Stock Part',
                bgClass: 'bg-rose-100',
                borderClass: 'border-rose-400',
                textClass: 'text-rose-700',
                explanation: `A supervisor alert indicates at least one required part is out of stock.`,
            });
        }
    }

    return symbols;
}

interface SymbolButtonProps {
    symbol: StatusSymbol;
    onRescheduleRequest?: (jobId: string) => void;
    onPoDetailRequest?: (jobId: string) => void;
}

function SymbolButton({ symbol, onRescheduleRequest, onPoDetailRequest }: SymbolButtonProps) {
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const updatePopoverPosition = () => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const popoverWidth = 288;

        let left = rect.left;
        let top = rect.bottom + 4;

        if (left + popoverWidth > window.innerWidth - 8) {
            left = window.innerWidth - popoverWidth - 8;
        }
        if (left < 8) left = 8;
        if (top + 120 > window.innerHeight) {
            top = rect.top - 4;
        }

        setPopoverPos({ top, left });
    };

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

    useEffect(() => {
        if (!open) return;
        const handleScroll = () => setOpen(false);
        document.addEventListener('scroll', handleScroll, true);
        return () => document.removeEventListener('scroll', handleScroll, true);
    }, [open]);

    return (
        <>
            <button
                ref={buttonRef}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((prev) => {
                        const next = !prev;
                        if (next) updatePopoverPosition();
                        return next;
                    });
                }}
                className={`flex items-center justify-center min-w-[20px] h-5 px-1 ${symbol.bgClass} border ${symbol.borderClass} rounded cursor-pointer hover:brightness-95 active:scale-95 transition-all`}
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
                        {symbol.actionType === 'reschedule' && onRescheduleRequest && symbol.jobId && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setOpen(false);
                                    onRescheduleRequest(symbol.jobId!);
                                }}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold rounded transition-colors"
                            >
                                View Suggested Placement
                            </button>
                        )}
                        {symbol.actionType === 'po-details' && onPoDetailRequest && symbol.jobId && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setOpen(false);
                                    onPoDetailRequest(symbol.jobId!);
                                }}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold rounded transition-colors"
                            >
                                View PO Detail
                            </button>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

interface JobStatusSymbolsProps {
    job: Job;
    alerts?: SupervisorAlert[];
    onRescheduleRequest?: (jobId: string) => void;
    onPoDetailRequest?: (jobId: string) => void;
}

export default function JobStatusSymbols({ job, alerts, onRescheduleRequest, onPoDetailRequest }: JobStatusSymbolsProps) {
    const symbols = getJobSymbols(job, alerts);
    if (symbols.length === 0) return null;

    return (
        <div className="flex items-center gap-0.5 shrink-0">
            {symbols.map((symbol) => (
                <SymbolButton
                    key={symbol.key}
                    symbol={symbol}
                    onRescheduleRequest={onRescheduleRequest}
                    onPoDetailRequest={onPoDetailRequest}
                />
            ))}
        </div>
    );
}

export { getJobSymbols };
