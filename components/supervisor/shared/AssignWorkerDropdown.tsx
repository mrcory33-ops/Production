import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, UserPlus } from 'lucide-react';

export default function AssignWorkerDropdown({ jobId, rosterNames, assignedWorkers, isAssigning, onSetAssigning, onAssign }: {
    jobId: string; rosterNames: string[]; assignedWorkers: string[];
    isAssigning: boolean; onSetAssigning: (v: string | null) => void;
    onAssign: (jobId: string, worker: string) => void;
}) {
    const btnRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

    const availableWorkers = rosterNames.filter(w => !assignedWorkers.includes(w));

    const updateDropdownPosition = useCallback(() => {
        if (!btnRef.current) return;

        const rect = btnRef.current.getBoundingClientRect();
        const viewportPadding = 8;
        const gap = 4;
        const dropdownMaxHeight = 224;
        const rowEstimate = 40;
        const estimatedHeight = Math.min(
            dropdownMaxHeight,
            Math.max(48, availableWorkers.length * rowEstimate + 8)
        );

        const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap);
        const spaceAbove = Math.max(0, rect.top - viewportPadding - gap);
        const shouldOpenUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;

        const maxHeight = Math.max(
            64,
            Math.min(dropdownMaxHeight, shouldOpenUpward ? spaceAbove : spaceBelow)
        );

        const unclampedTop = shouldOpenUpward ? rect.top - maxHeight - gap : rect.bottom + gap;
        const top = Math.max(
            viewportPadding,
            Math.min(unclampedTop, window.innerHeight - maxHeight - viewportPadding)
        );

        const width = rect.width;
        const left = Math.max(
            viewportPadding,
            Math.min(rect.left, window.innerWidth - width - viewportPadding)
        );

        setPos({ top, left, width, maxHeight });
    }, [availableWorkers.length]);

    // Calculate and maintain position while dropdown is open.
    useEffect(() => {
        if (!isAssigning) {
            setPos(null);
            return;
        }

        updateDropdownPosition();

        const reposition = () => updateDropdownPosition();
        window.addEventListener('resize', reposition);
        document.addEventListener('scroll', reposition, true);

        return () => {
            window.removeEventListener('resize', reposition);
            document.removeEventListener('scroll', reposition, true);
        };
    }, [isAssigning, updateDropdownPosition]);

    // Close on outside click
    useEffect(() => {
        if (!isAssigning) return;
        const handler = (e: MouseEvent) => {
            if (
                dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                btnRef.current && !btnRef.current.contains(e.target as Node)
            ) {
                onSetAssigning(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isAssigning, onSetAssigning]);

    return (
        <div className="mb-2">
            <button
                ref={btnRef}
                onClick={() => onSetAssigning(isAssigning ? null : jobId)}
                className="w-full py-1.5 rounded border border-dashed border-[#444] text-[10px] text-[#666] hover:text-white hover:border-sky-500/50 transition-colors flex items-center justify-center gap-1 uppercase font-bold tracking-wider"
            >
                <UserPlus className="w-3 h-3" /> Assign Worker
            </button>
            {isAssigning && pos && typeof document !== 'undefined' && createPortal(
                <div
                    ref={dropdownRef}
                    className="fixed bg-[#1a1a1a] border border-[#444] rounded-lg shadow-2xl max-h-56 overflow-y-auto"
                    style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, zIndex: 9999 }}
                >
                    {availableWorkers.map(w => (
                        <button key={w} onClick={() => { onAssign(jobId, w); onSetAssigning(null); }}
                            className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-sky-600/20 hover:text-white transition-colors flex items-center gap-2 border-b border-[#333]/50 last:border-b-0">
                            <Plus className="w-3.5 h-3.5 text-sky-400" /> {w}
                        </button>
                    ))}
                    {availableWorkers.length === 0 && (
                        <p className="px-3 py-3 text-xs text-[#555] text-center">All workers assigned</p>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}
