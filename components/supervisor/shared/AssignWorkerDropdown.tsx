import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, UserPlus } from 'lucide-react';

export default function AssignWorkerDropdown({ jobId, rosterNames, assignedWorkers, isAssigning, onSetAssigning, onAssign }: {
    jobId: string; rosterNames: string[]; assignedWorkers: string[];
    isAssigning: boolean; onSetAssigning: (v: string | null) => void;
    onAssign: (jobId: string, worker: string) => void;
}) {
    const btnRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

    // Calculate position when dropdown opens
    useEffect(() => {
        if (isAssigning && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        } else {
            setPos(null);
        }
    }, [isAssigning]);

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

    const availableWorkers = rosterNames.filter(w => !assignedWorkers.includes(w));

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
                    style={{ top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
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
