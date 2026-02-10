'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Job, Department } from '@/types';
import { DEPT_ORDER } from '@/lib/departmentConfig';

interface JobConfigPopoverProps {
    job: Job;
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    onNoGapsToggle: (jobId: string, noGaps: boolean) => Promise<void>;
    onSkipDepartments: (jobId: string, skipped: Department[]) => Promise<void>;
    onClose: () => void;
}

const DEPT_LABELS: Record<Department, string> = {
    'Engineering': 'Eng',
    'Laser': 'Laser',
    'Press Brake': 'Brake',
    'Welding': 'Weld',
    'Polishing': 'Polish',
    'Assembly': 'Assy',
};

const DEPT_COLORS: Record<Department, string> = {
    'Engineering': '#6366f1',
    'Laser': '#ef4444',
    'Press Brake': '#f59e0b',
    'Welding': '#10b981',
    'Polishing': '#8b5cf6',
    'Assembly': '#3b82f6',
};

export default function JobConfigPopover({ job, anchorRef, onNoGapsToggle, onSkipDepartments, onClose }: JobConfigPopoverProps) {
    const ref = useRef<HTMLDivElement>(null);
    const currentDeptIndex = DEPT_ORDER.indexOf(job.currentDepartment);
    const skipped = new Set(job.skippedDepartments || []);
    const [localSkipped, setLocalSkipped] = useState<Set<Department>>(skipped);
    const [saving, setSaving] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Position relative to the anchor button
    useEffect(() => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            const popoverHeight = 340; // approximate
            const spaceBelow = window.innerHeight - rect.bottom;
            const showAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;

            setPos({
                top: showAbove ? rect.top - popoverHeight - 4 : rect.bottom + 4,
                left: rect.left,
            });
        }
    }, [anchorRef]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                ref.current && !ref.current.contains(e.target as Node) &&
                anchorRef.current && !anchorRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose, anchorRef]);

    const toggleDept = (dept: Department) => {
        setLocalSkipped(prev => {
            const next = new Set(prev);
            if (next.has(dept)) {
                next.delete(dept);
            } else {
                next.add(dept);
            }
            return next;
        });
    };

    const handleApply = async () => {
        setSaving(true);
        try {
            await onSkipDepartments(job.id, Array.from(localSkipped));
        } finally {
            setSaving(false);
            onClose();
        }
    };

    const hasChanges = (() => {
        const original = new Set(job.skippedDepartments || []);
        if (original.size !== localSkipped.size) return true;
        for (const d of localSkipped) {
            if (!original.has(d)) return true;
        }
        return false;
    })();

    return createPortal(
        <div
            ref={ref}
            className="fixed z-[9999] bg-white border border-slate-300 rounded-lg shadow-xl w-56"
            style={{ top: pos.top, left: pos.left, minWidth: 220 }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 rounded-t-lg">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Schedule Config
                </div>
                <div className="text-[11px] font-semibold text-slate-800 truncate">{job.id}</div>
            </div>

            {/* No Gaps Toggle */}
            <div className="px-3 py-2 border-b border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={!!job.noGaps}
                        onChange={async () => {
                            await onNoGapsToggle(job.id, !job.noGaps);
                        }}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div>
                        <div className="text-[11px] font-semibold text-slate-700 group-hover:text-slate-900">
                            ⚡ No Gaps
                        </div>
                        <div className="text-[9px] text-slate-400 leading-tight">
                            Remove gaps between departments
                        </div>
                    </div>
                </label>
            </div>

            {/* Department Checkboxes */}
            <div className="px-3 py-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Departments
                </div>
                <div className="space-y-1">
                    {DEPT_ORDER.map((dept, idx) => {
                        const isCompleted = idx < currentDeptIndex;
                        const isCurrent = idx === currentDeptIndex;
                        const isSkipped = localSkipped.has(dept);
                        const isDisabled = isCompleted || isCurrent;

                        return (
                            <label
                                key={dept}
                                className={`flex items-center gap-2 py-0.5 rounded transition-colors ${isDisabled
                                        ? 'opacity-40 cursor-not-allowed'
                                        : 'cursor-pointer hover:bg-slate-50'
                                    }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={!isSkipped && !isCompleted}
                                    disabled={isDisabled}
                                    onChange={() => !isDisabled && toggleDept(dept)}
                                    className="w-3 h-3 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                />
                                <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: DEPT_COLORS[dept] }}
                                />
                                <span className={`text-[11px] ${isCompleted
                                        ? 'text-slate-400 line-through'
                                        : isCurrent
                                            ? 'text-slate-800 font-bold'
                                            : isSkipped
                                                ? 'text-slate-400'
                                                : 'text-slate-700'
                                    }`}>
                                    {DEPT_LABELS[dept]}
                                    {isCurrent && <span className="text-[8px] text-blue-500 ml-1 font-normal">● current</span>}
                                    {isCompleted && <span className="text-[8px] text-slate-400 ml-1 font-normal">done</span>}
                                </span>
                            </label>
                        );
                    })}
                </div>
            </div>

            {/* Apply Button */}
            {hasChanges && (
                <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 rounded-b-lg">
                    <button
                        onClick={handleApply}
                        disabled={saving}
                        className="w-full text-[10px] font-semibold px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {saving ? 'Saving...' : 'Apply Changes'}
                    </button>
                </div>
            )}
        </div>,
        document.body
    );
}
