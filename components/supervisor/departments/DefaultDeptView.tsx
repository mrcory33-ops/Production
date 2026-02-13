'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Job } from '@/types';
import { startOfDay } from 'date-fns';
import { getBatchKeyForJob, BATCH_COHORT_WINDOW_BUSINESS_DAYS } from '@/lib/scheduler';
import { DEPT_ORDER } from '@/lib/departmentConfig';
import { DeptViewProps, WorkerProfile, ProductFilter, PRODUCT_TYPE_COLORS } from '../types';
import FilterTabs from '../shared/FilterTabs';
import JobQueueCard from '../shared/JobQueueCard';
import WorkerColumn from '../shared/WorkerColumn';
import WorkerEditPopup from '../shared/WorkerEditPopup';
import {
    ClipboardList, Users, Loader2, GripVertical,
    X, Plus, Pencil, ChevronLeft, ChevronRight,
} from 'lucide-react';

const WORKERS_PER_PAGE = 8;

/**
 * DefaultDeptView — Generic Today's Plan view used by departments
 * that don't need custom layouts (Engineering, Laser, Press Brake, Polishing, Assembly).
 */
export default function DefaultDeptView({
    jobs, department, selectedSlot, roster, rosterLoading,
    showAddWorker, newWorkerName, onNewWorkerNameChange,
    onAddWorker, onRemoveWorker, onSetShowAddWorker,
    onEditWorker, editingWorker, onUpdateWorkerProfile, onCancelEditWorker,
    onAssignWorker, onUnassignWorker, onProgressUpdate,
    savingProgress, assigningJob, onSetAssigningJob,
    alerts, onReportIssue, onWorkerPositionChange, onOpenPODetails,
}: DeptViewProps) {
    const [productFilter, setProductFilter] = useState<ProductFilter>('ALL');
    const [workerPage, setWorkerPage] = useState(1);
    const isWelding = false;

    // Sort jobs: active first, then group by product type, then by description (batching), then by due date
    const PRODUCT_TYPE_SORT: Record<string, number> = { DOORS: 0, FAB: 1, HARMONIC: 2 };
    const sorted = useMemo(() => {
        let filtered = [...jobs];
        if (productFilter !== 'ALL') {
            filtered = filtered.filter(j => j.productType === productFilter);
        }
        return filtered.sort((a, b) => {
            const aActive = (a.assignedWorkers?.[department]?.length || 0) > 0;
            const bActive = (b.assignedWorkers?.[department]?.length || 0) > 0;
            if (aActive && !bActive) return -1;
            if (!aActive && bActive) return 1;
            const schedA = (a.remainingDepartmentSchedule || a.departmentSchedule)?.[department];
            const schedB = (b.remainingDepartmentSchedule || b.departmentSchedule)?.[department];
            const startA = schedA ? new Date(schedA.start).getTime() : Infinity;
            const startB = schedB ? new Date(schedB.start).getTime() : Infinity;
            if (startA !== startB) return startA - startB;
            const aType = PRODUCT_TYPE_SORT[a.productType || 'FAB'] ?? 1;
            const bType = PRODUCT_TYPE_SORT[b.productType || 'FAB'] ?? 1;
            if (aType !== bType) return aType - bType;
            const aDesc = (a.description || '').trim().toLowerCase();
            const bDesc = (b.description || '').trim().toLowerCase();
            if (aDesc !== bDesc) return aDesc.localeCompare(bDesc);
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
    }, [jobs, department, productFilter]);

    // Batch key logic
    const getBatchKey = (j: Job): string | null => getBatchKeyForJob(j);
    const getBatchCohortKey = (j: Job): string | null => {
        const key = getBatchKey(j);
        if (!key) return null;
        return `${key}|DEPT:${j.currentDepartment || 'UNKNOWN'}`;
    };

    const addBusinessDays = (from: Date, days: number): Date => {
        const result = new Date(from);
        let count = 0;
        while (count < days) {
            result.setDate(result.getDate() + 1);
            const dow = result.getDay();
            if (dow !== 0 && dow !== 6) count++;
        }
        return result;
    };
    const batchWindowEnd = addBusinessDays(startOfDay(new Date()), BATCH_COHORT_WINDOW_BUSINESS_DAYS);

    const PRESS_BRAKE_INDEX = DEPT_ORDER.indexOf('Press Brake');
    const isBatchEligible = (j: Job) => DEPT_ORDER.indexOf(j.currentDepartment) <= PRESS_BRAKE_INDEX;

    const batchInfo = useMemo(() => {
        const counts: Record<string, number> = {};
        const labels: Record<string, string> = {};
        sorted.forEach(j => {
            if (!isBatchEligible(j)) return;
            const dueDate = new Date(j.dueDate);
            if (dueDate > batchWindowEnd) return;
            const key = getBatchCohortKey(j);
            if (!key) return;
            counts[key] = (counts[key] || 0) + 1;
            if (!labels[key]) labels[key] = j.description || j.productType || 'FAB';
        });
        return { counts, labels };
    }, [sorted]);

    const sortedRoster = useMemo(() => [...roster].sort((a, b) => (a.position ?? 999) - (b.position ?? 999)), [roster]);
    const getWorkerJobs = (workerName: string) => jobs.filter(j => j.assignedWorkers?.[department]?.includes(workerName));
    const rosterNames = sortedRoster.map(w => w.name);

    // Build a position→worker map; workers without position get assigned after the last positioned one
    const slotMap = useMemo(() => {
        const map: Record<number, WorkerProfile> = {};
        const unpositioned: WorkerProfile[] = [];
        for (const w of sortedRoster) {
            if (w.position != null && w.position > 0) {
                map[w.position] = w;
            } else {
                unpositioned.push(w);
            }
        }
        // Put unpositioned workers into the first available slots after all positioned ones
        const maxPos = Object.keys(map).length > 0 ? Math.max(...Object.keys(map).map(Number)) : 0;
        let nextSlot = maxPos + 1;
        for (const w of unpositioned) {
            while (map[nextSlot]) nextSlot++;
            map[nextSlot] = w;
            nextSlot++;
        }
        return map;
    }, [sortedRoster]);

    const highestSlot = useMemo(() => {
        const positions = Object.keys(slotMap).map(Number);
        return positions.length > 0 ? Math.max(...positions) : 0;
    }, [slotMap]);

    const workerPageCount = Math.max(1, Math.ceil(highestSlot / WORKERS_PER_PAGE));

    useEffect(() => {
        setWorkerPage(prev => Math.min(prev, workerPageCount));
    }, [workerPageCount]);

    // Build the 8 slots for the current page (some may be null = empty)
    const pageSlots = useMemo(() => {
        const startPos = (workerPage - 1) * WORKERS_PER_PAGE + 1;
        const slots: (WorkerProfile | null)[] = [];
        for (let i = 0; i < WORKERS_PER_PAGE; i++) {
            slots.push(slotMap[startPos + i] || null);
        }
        return slots;
    }, [slotMap, workerPage]);

    const pageStartPos = (workerPage - 1) * WORKERS_PER_PAGE + 1;
    const pageEndPos = workerPage * WORKERS_PER_PAGE;

    const fabCount = jobs.filter(j => j.productType === 'FAB').length;
    const doorsCount = jobs.filter(j => j.productType === 'DOORS').length;
    const harmonicCount = jobs.filter(j => j.productType === 'HARMONIC').length;

    return (
        <div className="flex h-full overflow-hidden">
            {/* ── Roster Management Panel (overlay) ── */}
            {showAddWorker && (
                <div className="absolute top-14 right-4 z-30 w-80 bg-[#1a1a1a] border border-[#444] rounded-lg shadow-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider font-serif">Manage Roster</h3>
                        <button onClick={() => onSetShowAddWorker(false)} className="p-1 text-[#666] hover:text-white"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex gap-2 mb-3">
                        <input
                            value={newWorkerName}
                            onChange={e => onNewWorkerNameChange(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && onAddWorker()}
                            placeholder="Worker name..."
                            className="flex-1 bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-[#555] focus:border-sky-500/50 focus:outline-none"
                        />
                        <button onClick={onAddWorker} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded text-xs font-bold text-white transition-colors">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {roster.map(w => (
                            <div key={w.name} className="flex items-center justify-between px-3 py-2 bg-[#222] rounded border border-[#333] group">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-sm text-slate-300 font-bold truncate">{w.name}</span>
                                    {(w.qualifications?.length || 0) > 0 && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/40 shrink-0">
                                            {w.qualifications!.length} qual
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button onClick={() => onEditWorker(w)} className="p-1 text-[#555] hover:text-sky-400 transition-colors" title="Edit Profile">
                                        <Pencil className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => onRemoveWorker(w)} className="p-1 text-[#555] hover:text-rose-400 transition-colors" title="Remove">
                                        <X className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {roster.length === 0 && <p className="text-xs text-[#555] text-center py-4">No workers added yet</p>}
                    </div>
                </div>
            )}

            {/* ── Worker Edit Popup (Portal) ── */}
            {editingWorker && typeof document !== 'undefined' && createPortal(
                <WorkerEditPopup
                    worker={editingWorker}
                    onSave={(updated) => onUpdateWorkerProfile(editingWorker, updated)}
                    onClose={onCancelEditWorker}
                />,
                document.body
            )}

            {/* ── JOB QUEUE (Left Column) ── */}
            <div className="w-[420px] flex-shrink-0 flex flex-col border-r border-[#333] bg-[#1a1a1a]/50">
                <div className="border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] shrink-0">
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <GripVertical className="w-4 h-4 text-[#555]" />
                            <h3 className="font-bold text-sm text-slate-200 uppercase tracking-wider font-serif">Job Queue</h3>
                        </div>
                        <span className="bg-[#111] text-sky-400 border border-[#333] px-2 py-0.5 rounded text-xs font-mono font-bold">{sorted.length}</span>
                    </div>
                    <FilterTabs isWelding={isWelding} productFilter={productFilter} setProductFilter={setProductFilter} jobs={jobs} fabCount={fabCount} doorsCount={doorsCount} harmonicCount={harmonicCount} />
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {sorted.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 text-[#555]">
                            <ClipboardList className="w-10 h-10 mb-3 opacity-30" />
                            <p className="text-xs text-center font-mono">No jobs in {department}</p>
                        </div>
                    )}
                    {sorted.map((job, idx) => {
                        const type = job.productType || 'FAB';
                        const key = getBatchCohortKey(job);
                        const prevKey = idx > 0 ? getBatchCohortKey(sorted[idx - 1]) : null;
                        const batchCount = key ? (batchInfo.counts[key] || 0) : 0;
                        const inBatchGroup = batchCount >= 2;
                        const isGroupStart = key !== prevKey;
                        const showBatchHeader = isGroupStart && inBatchGroup;
                        const typeColor = PRODUCT_TYPE_COLORS[type] || PRODUCT_TYPE_COLORS.FAB;
                        const batchAccent = type === 'FAB' ? '#0ea5e9' : type === 'DOORS' ? '#f59e0b' : '#8b5cf6';

                        return (
                            <React.Fragment key={job.id}>
                                {showBatchHeader && (
                                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${typeColor.border} ${typeColor.bg} ${idx > 0 ? 'mt-1' : ''}`}>
                                        <span className="text-[10px]">⚙️</span>
                                        <span className={`text-[10px] font-bold uppercase tracking-wider ${typeColor.text}`}>
                                            {job.description} — {batchCount} jobs
                                        </span>
                                        <span className="text-[9px] text-[#777] font-mono italic">· Run together</span>
                                    </div>
                                )}
                                <JobQueueCard
                                    job={job}
                                    department={department}
                                    rosterNames={rosterNames}
                                    onAssign={onAssignWorker}
                                    onUnassign={onUnassignWorker}
                                    onProgressUpdate={onProgressUpdate}
                                    isSaving={savingProgress === job.id}
                                    isAssigning={assigningJob === job.id}
                                    onSetAssigning={onSetAssigningJob}
                                    hasAlert={alerts.some(a => a.jobId === job.id)}
                                    onReportIssue={onReportIssue}
                                    inBatchGroup={inBatchGroup}
                                    batchAccentColor={batchAccent}
                                    onOpenPODetails={onOpenPODetails}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>

            {/* ── RIGHT AREA: Worker Columns ── */}
            <div className="flex-1 overflow-hidden p-3 flex flex-col gap-2">
                {rosterLoading ? (
                    <div className="flex items-center justify-center w-full"><Loader2 className="w-6 h-6 text-[#555] animate-spin" /></div>
                ) : roster.length === 0 ? (
                    <div className="flex flex-col items-center justify-center w-full text-[#555]">
                        <Users className="w-12 h-12 mb-4 opacity-30" />
                        <p className="text-sm font-mono uppercase tracking-wider">No workers in roster</p>
                        <p className="text-xs text-[#444] mt-2">Click &quot;Manage Roster&quot; to add workers</p>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center justify-between rounded-md border border-[#333] bg-[#1a1a1a] px-2 h-6 leading-none">
                            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider leading-none">
                                Positions {pageStartPos}–{pageEndPos}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setWorkerPage(p => Math.max(1, p - 1))}
                                    disabled={workerPage === 1}
                                    className="inline-flex h-4 items-center gap-0.5 rounded border border-[#444] px-1.5 text-[10px] font-bold leading-none text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#222]"
                                >
                                    <ChevronLeft className="w-2.5 h-2.5" /> Prev
                                </button>
                                <span className="text-[10px] text-slate-300 font-mono leading-none">
                                    Page {workerPage} / {workerPageCount}
                                </span>
                                <button
                                    onClick={() => setWorkerPage(p => Math.min(workerPageCount, p + 1))}
                                    disabled={workerPage === workerPageCount}
                                    className="inline-flex h-4 items-center gap-0.5 rounded border border-[#444] px-1.5 text-[10px] font-bold leading-none text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#222]"
                                >
                                    Next <ChevronRight className="w-2.5 h-2.5" />
                                </button>
                            </div>
                        </div>
                        <div
                            className="flex-1 min-h-0 grid gap-3 overflow-auto"
                            style={{
                                gridTemplateColumns: 'repeat(4, minmax(230px, 1fr))',
                                gridTemplateRows: 'repeat(2, minmax(0, 1fr))'
                            }}
                        >
                            {pageSlots.map((worker, i) => {
                                const slotPos = pageStartPos + i;
                                return worker ? (
                                    <div key={worker.name} className="min-h-0">
                                        <WorkerColumn
                                            worker={worker}
                                            jobs={getWorkerJobs(worker.name)}
                                            department={department}
                                            onProgressUpdate={onProgressUpdate}
                                            savingProgress={savingProgress}
                                            onPositionChange={onWorkerPositionChange}
                                        />
                                    </div>
                                ) : (
                                    <div key={`empty-${slotPos}`} className="min-h-0 flex items-center justify-center border-2 border-dashed border-[#333] rounded-lg">
                                        <span className="text-[10px] text-[#444] font-mono">{slotPos}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
