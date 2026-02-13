import React from 'react';
import { Department, Job } from '@/types';
import { PRODUCT_TYPE_COLORS } from '../types';
import AssignWorkerDropdown from './AssignWorkerDropdown';
import {
    AlertTriangle, Loader2, Package, Check, X, PackageX, Undo2,
} from 'lucide-react';

export default function JobQueueCard({ job, department, rosterNames, onAssign, onUnassign, onProgressUpdate, isSaving, isAssigning, onSetAssigning, hasAlert, onReportIssue, inBatchGroup, batchAccentColor, isDoorLeaf, isFrame, onAssignToPress, onRemoveFromPress }: {
    job: Job; department: Department; rosterNames: string[];
    onAssign: (jobId: string, worker: string) => void;
    onUnassign: (jobId: string, worker: string) => void;
    onProgressUpdate: (jobId: string, pct: number) => void;
    isSaving: boolean; isAssigning: boolean;
    onSetAssigning: (v: string | null) => void;
    hasAlert: boolean;
    onReportIssue: (jobId: string) => void;
    inBatchGroup?: boolean;
    batchAccentColor?: string;
    /** Welding door-leaf: show PRESS button, hide assign-worker */
    isDoorLeaf?: boolean;
    /** Welding frame: distinct purple accent */
    isFrame?: boolean;
    /** Callback to send door-leaf job to Press station */
    onAssignToPress?: (jobId: string) => void;
    /** Callback to remove door-leaf job from Press station back to queue */
    onRemoveFromPress?: (jobId: string) => void;
}) {
    const assignedWorkers = job.assignedWorkers?.[department] || [];
    const progress = job.departmentProgress?.[department] ?? 0;
    const dueDate = new Date(job.dueDate);
    const isOverdue = dueDate < new Date();
    const productColor = PRODUCT_TYPE_COLORS[job.productType] || PRODUCT_TYPE_COLORS.FAB;

    // Already sent to press station?
    const inPress = job.weldingStationProgress?.press !== undefined;

    const isActive = assignedWorkers.length > 0 || inPress;

    // Door-leaf vs frame accent colors
    const topBarColor = isDoorLeaf
        ? '#f59e0b'   // amber for door leaf
        : isFrame
            ? '#a78bfa' // violet for frame
            : job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6';

    // Card border style — no extra glow, just clean distinction
    const borderClass = hasAlert ? 'border-rose-500' : 'border-[#ddd]';

    // Active = light mode card, Inactive = dark mode card
    const cardBg = isActive
        ? 'bg-white'
        : 'bg-gradient-to-b from-[#222] to-[#1c1c1c]';

    // Text color helpers
    const primaryText = isActive ? 'text-slate-900' : 'text-white';
    const secondaryText = isActive ? 'text-slate-600' : 'text-slate-300';
    const mutedText = isActive ? 'text-slate-400' : 'text-[#666]';
    const descBg = isActive ? 'bg-slate-100 border-slate-200' : 'bg-[#111] border-[#2a2a2a]';
    const descLabel = isActive ? 'text-slate-400' : 'text-[#555]';
    const descText = isActive ? 'text-slate-700' : 'text-slate-200';
    const ptBg = isActive ? 'bg-slate-100 border-slate-200' : 'bg-[#111] border-[#333]';
    const ptColor = isActive ? 'text-sky-600' : 'text-sky-400';
    const ptLabel = isActive ? 'text-slate-400' : 'text-[#666]';
    const reportBtnClass = isActive
        ? 'border-slate-300 text-slate-400 hover:text-rose-500 hover:border-rose-400 hover:bg-rose-50'
        : 'border-[#333] text-[#666] hover:text-rose-400 hover:border-rose-700/50 hover:bg-rose-900/20';
    const workerBadgeBg = isActive ? 'bg-sky-100 text-sky-700 border-sky-200' : 'bg-sky-900/30 text-sky-300 border-sky-700/30';
    const workerRemoveBtn = isActive ? 'text-sky-500 hover:text-rose-500' : 'text-sky-500 hover:text-rose-400';
    const qtyBadge = isActive ? 'bg-slate-200 text-slate-600 border-slate-300' : 'bg-[#222] text-slate-300 border-[#444]';

    return (
        <div className={`${cardBg} border rounded-lg transition-all relative
            ${borderClass}
            ${inBatchGroup ? 'border-l-[3px]' : ''}`}
            style={inBatchGroup && batchAccentColor ? { borderLeftColor: batchAccentColor } : undefined}>
            {/* Product type color bar */}
            <div className="h-1.5 w-full rounded-t-lg" style={{ backgroundColor: topBarColor }} />

            <div className="p-4">
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            {/* BIGGER WO Number */}
                            <span className={`text-sm font-mono font-bold ${primaryText}`}>{job.id}</span>
                            {/* Product type badge — hide for door/frame since they have specific sub-labels */}
                            {!isDoorLeaf && !isFrame && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${productColor.bg} ${productColor.text} border ${productColor.border}`}>
                                    {productColor.label}
                                </span>
                            )}
                            {/* Door/Frame sub-label */}
                            {isDoorLeaf && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${isActive ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-amber-900/30 text-amber-300 border border-amber-700/40'}`}>
                                    🚪 Door Leaf
                                </span>
                            )}
                            {isFrame && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${isActive ? 'bg-violet-100 text-violet-700 border border-violet-300' : 'bg-violet-900/30 text-violet-300 border border-violet-700/40'}`}>
                                    🖼️ Frame
                                </span>
                            )}
                            {(isDoorLeaf || isFrame) && job.quantity && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${qtyBadge}`}>
                                    Qty {job.quantity}
                                </span>
                            )}
                            {isActive && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase flex items-center gap-1 ${isActive ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-emerald-600/20 text-emerald-300 border border-emerald-700/30'}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
                                </span>
                            )}
                            {hasAlert && (
                                <span className="text-[8px] font-bold text-rose-500 px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 flex items-center gap-1">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Blocked
                                </span>
                            )}
                        </div>
                        <h4 className={`text-[12px] ${secondaryText} font-medium truncate`}>{job.name}</h4>
                    </div>
                    <div className="shrink-0 flex items-start gap-1.5">
                        {/* Report Issue button */}
                        <button
                            onClick={() => onReportIssue(job.id)}
                            title="Report Issue"
                            className={`p-1.5 rounded border ${reportBtnClass} transition-all`}
                        >
                            <AlertTriangle className="w-3.5 h-3.5" />
                        </button>
                        <div className="text-right">
                            <div className={`px-1.5 py-0.5 rounded border shadow-inner inline-block ${ptBg}`}>
                                <span className={`${ptColor} text-xs font-mono font-bold`}>{job.weldingPoints}</span>
                                <span className={`text-[8px] ${ptLabel} ml-0.5`}>pt</span>
                            </div>
                            <div className={`text-[9px] font-mono mt-0.5 ${isOverdue ? 'text-rose-500' : mutedText}`}>
                                {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* PO Status */}
                {(job.openPOs || job.closedPOs) && (
                    <div className="flex items-center gap-1.5 mb-2">
                        {job.openPOs && !job.closedPOs && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-orange-100 text-orange-600 border border-orange-300' : 'bg-orange-900/30 text-orange-300 border border-orange-700/40'}`}>
                                <Package className="w-3 h-3" /> Open
                            </span>
                        )}
                        {job.openPOs && job.closedPOs && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-yellow-100 text-yellow-700 border border-yellow-300' : 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/40'}`}>
                                <Package className="w-3 h-3" /> Partial
                            </span>
                        )}
                        {!job.openPOs && job.closedPOs && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-emerald-100 text-emerald-600 border border-emerald-300' : 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40'}`}>
                                <Check className="w-3 h-3" /> Received
                            </span>
                        )}
                    </div>
                )}

                {/* Part Description */}
                {job.description && (
                    <div className={`mb-2 px-2 py-1.5 rounded border ${descBg}`}>
                        <span className={`text-[8px] ${descLabel} uppercase tracking-wider font-bold block mb-0.5`}>Part</span>
                        <p className={`text-[11px] ${descText} font-medium leading-tight`} title={job.description}>{job.description}</p>
                    </div>
                )}

                {/* ── Door Leaf: PRESS button instead of worker assignment ── */}
                {isDoorLeaf && onAssignToPress && (
                    <div className="mb-2">
                        {inPress ? (
                            <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded ${isActive ? 'bg-orange-50 border border-orange-200' : 'bg-orange-900/20 border border-orange-700/40'}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-orange-600' : 'text-orange-300'}`}>⚙️ In Press Station</span>
                                    <span className={`text-[9px] font-mono ${isActive ? 'text-orange-500' : 'text-orange-400/70'}`}>{job.weldingStationProgress?.press ?? 0}%</span>
                                </div>
                                {onRemoveFromPress && (
                                    <button
                                        onClick={() => onRemoveFromPress(job.id)}
                                        title="Back to Queue"
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider transition-all
                                            ${isActive ? 'border border-orange-300 text-orange-600 hover:bg-orange-100 hover:border-orange-400' : 'border border-orange-700/40 text-orange-300 hover:bg-orange-900/40 hover:border-orange-500'}`}
                                    >
                                        <Undo2 className="w-3 h-3" /> Back to Queue
                                    </button>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={() => onAssignToPress(job.id)}
                                className={`w-full py-2 rounded border-2 border-dashed transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider
                                    ${isActive ? 'border-amber-400 text-amber-600 hover:bg-amber-50 hover:border-amber-500' : 'border-amber-600/50 text-amber-300 hover:bg-amber-900/30 hover:border-amber-500'}`}
                            >
                                ⚙️ Send to Press
                            </button>
                        )}
                    </div>
                )}

                {/* ── Standard worker assignment (hidden for door-leaf jobs) ── */}
                {!isDoorLeaf && (
                    <>
                        {/* Assigned Workers */}
                        {assignedWorkers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                                {assignedWorkers.map(w => (
                                    <span key={w} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${workerBadgeBg}`}>
                                        {w}
                                        <button onClick={() => onUnassign(job.id, w)} className={`${workerRemoveBtn} transition-colors`}>
                                            <X className="w-2.5 h-2.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Assign Worker Button */}
                        <AssignWorkerDropdown
                            jobId={job.id}
                            rosterNames={rosterNames}
                            assignedWorkers={assignedWorkers}
                            isAssigning={isAssigning}
                            onSetAssigning={onSetAssigning}
                            onAssign={onAssign}
                        />
                    </>
                )}


            </div>
        </div>
    );
}
