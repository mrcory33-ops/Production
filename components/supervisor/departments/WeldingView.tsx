'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Job, WeldingSubStage } from '@/types';
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
 * WeldingView — Custom Today's Plan for the Welding department.
 * Includes the FAB+HARMONIC merge and the Doors tab with
 * Press/Robot stations and Frame Workers layout.
 */
export default function WeldingView({
    jobs, department, selectedSlot, roster, rosterLoading,
    showAddWorker, newWorkerName, onNewWorkerNameChange,
    onAddWorker, onRemoveWorker, onSetShowAddWorker,
    onEditWorker, editingWorker, onUpdateWorkerProfile, onCancelEditWorker,
    onAssignWorker, onUnassignWorker, onProgressUpdate,
    onStationProgressUpdate, onAssignToPress, onRemoveFromPress,
    savingProgress, assigningJob, onSetAssigningJob,
    alerts, onReportIssue, onWorkerPositionChange,
}: DeptViewProps) {
    const [productFilter, setProductFilter] = useState<ProductFilter>('ALL');
    const [workerPage, setWorkerPage] = useState(1);
    const [frameWorkerPage, setFrameWorkerPage] = useState(1);

    // ── Frame vs Door Leaf classifiers ──
    const isWelding = true;
    const isDoorLeaf = (job: Job) => job.productType === 'DOORS' && !/\b(frame|fr|borrowed\s*light)/i.test(job.description || '');
    const isFrame = (job: Job) => job.productType === 'DOORS' && /\b(frame|fr|borrowed\s*light)/i.test(job.description || '');
    const isDoorsView = productFilter === 'DOORS';

    // Sort jobs
    const PRODUCT_TYPE_SORT: Record<string, number> = { DOORS: 0, FAB: 1, HARMONIC: 2 };
    const sorted = useMemo(() => {
        let filtered = [...jobs];
        if (productFilter !== 'ALL') {
            if (productFilter === 'FAB') {
                filtered = filtered.filter(j => j.productType === 'FAB' || j.productType === 'HARMONIC');
            } else {
                filtered = filtered.filter(j => j.productType === productFilter);
            }
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

    // Count by product type (merge FAB+HARMONIC for Welding)
    const fabCount = jobs.filter(j => j.productType === 'FAB' || j.productType === 'HARMONIC').length;
    const doorsCount = jobs.filter(j => j.productType === 'DOORS').length;
    const harmonicCount = jobs.filter(j => j.productType === 'HARMONIC').length;

    // ── Doors-specific derived data ──
    const pressJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isDoorLeaf(j) && j.weldingStationProgress?.press !== undefined && (j.weldingStationProgress.press ?? 0) < 100)
        : [], [sorted, isDoorsView]);
    const robotJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isDoorLeaf(j) && (j.weldingStationProgress?.press ?? -1) > 0)
        : [], [sorted, isDoorsView]);
    const frameWorkerJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isFrame(j))
        : [], [sorted, isDoorsView]);

    const frameWorkers = useMemo(() => {
        if (!isDoorsView) return [];
        return sortedRoster.filter(worker =>
            frameWorkerJobs.some(j => j.assignedWorkers?.[department]?.includes(worker.name))
        );
    }, [department, frameWorkerJobs, isDoorsView, sortedRoster]);

    const frameWorkerPageCount = Math.max(1, Math.ceil(frameWorkers.length / WORKERS_PER_PAGE));
    useEffect(() => {
        setFrameWorkerPage(prev => Math.min(prev, frameWorkerPageCount));
    }, [frameWorkerPageCount]);

    const pagedFrameWorkers = useMemo(() => {
        const start = (frameWorkerPage - 1) * WORKERS_PER_PAGE;
        return frameWorkers.slice(start, start + WORKERS_PER_PAGE);
    }, [frameWorkerPage, frameWorkers]);
    const frameGridRows = pagedFrameWorkers.length > 4 ? 2 : 1;

    const framePageStart = frameWorkers.length === 0 ? 0 : (frameWorkerPage - 1) * WORKERS_PER_PAGE + 1;
    const framePageEnd = Math.min(frameWorkerPage * WORKERS_PER_PAGE, frameWorkers.length);

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

                        const doorLeaf = isDoorLeaf(job);
                        const frame = isFrame(job);

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
                                    isDoorLeaf={doorLeaf}
                                    isFrame={frame}
                                    onAssignToPress={doorLeaf ? onAssignToPress : undefined}
                                    onRemoveFromPress={doorLeaf ? onRemoveFromPress : undefined}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>

            {/* ── RIGHT AREA: Worker Columns OR Doors Station Layout ── */}
            {isDoorsView ? (
                <div className="flex-1 overflow-auto p-3 flex gap-3">
                    {/* ── PRESS STATION (badge column) ── */}
                    <div className="flex flex-col border border-orange-700/40 rounded-lg bg-[#181818] min-w-[260px] w-[280px] flex-shrink-0">
                        {/* Station Header — badge style */}
                        <div className="p-3 border-b border-orange-700/30 bg-gradient-to-b from-orange-900/30 to-[#1a1a1a] shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded bg-gradient-to-br from-orange-600 to-orange-800 flex items-center justify-center text-sm font-bold text-white border border-orange-500 shadow-inner">
                                    ⚙️
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-orange-200 truncate font-serif uppercase tracking-wider">Press Station</h4>
                                    <span className="text-[9px] text-orange-400/70 font-mono">{pressJobs.length} job{pressJobs.length !== 1 ? 's' : ''} in press</span>
                                </div>
                            </div>
                        </div>
                        {/* Job Badges */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {pressJobs.length === 0 && (
                                <p className="text-[10px] text-[#444] text-center py-8 font-mono">No jobs in Press</p>
                            )}
                            {pressJobs.map(job => {
                                const pressPct = job.weldingStationProgress?.press ?? 0;
                                const saving = savingProgress === job.id;
                                return (
                                    <div key={job.id} className="border border-orange-700/40 rounded p-2.5 bg-orange-950/20 hover:brightness-110 transition-all">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span className="text-[11px] font-mono font-bold text-orange-200">{job.id}</span>
                                            <div className="flex items-center gap-1">
                                                {saving && <Loader2 className="w-2.5 h-2.5 text-orange-400 animate-spin" />}
                                                <span className={`text-[10px] font-mono font-bold ${pressPct >= 100 ? 'text-emerald-400' : pressPct > 0 ? 'text-orange-300' : 'text-[#555]'}`}>{pressPct}%</span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-300 truncate font-medium mb-1">{job.name}</p>
                                        {job.description && <p className="text-[9px] text-[#666] truncate mb-1.5">{job.description}</p>}
                                        {/* Mini progress bar */}
                                        <div className="h-1.5 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-1.5">
                                            <div className={`h-full transition-all duration-500 ${pressPct >= 100 ? 'bg-emerald-600' : 'bg-orange-500'}`} style={{ width: `${pressPct}%` }} />
                                        </div>
                                        {/* Progress buttons */}
                                        <div className="flex gap-0.5">
                                            {[0, 25, 50, 75, 100].map(val => (
                                                <button key={val} onClick={() => onStationProgressUpdate(job.id, 'press', val)} disabled={saving}
                                                    className={`flex-1 py-0.5 rounded text-[8px] font-bold transition-all border
                                                    ${pressPct === val ? 'bg-orange-600/30 text-orange-300 border-orange-600/50' : 'bg-[#111] text-[#555] border-[#333] hover:text-white hover:border-[#555]'}
                                                    ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                    {val}%
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── ROBOT STATION (badge column) ── */}
                    <div className="flex flex-col border border-cyan-700/40 rounded-lg bg-[#181818] min-w-[260px] w-[280px] flex-shrink-0">
                        {/* Station Header — badge style */}
                        <div className="p-3 border-b border-cyan-700/30 bg-gradient-to-b from-cyan-900/30 to-[#1a1a1a] shrink-0">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded bg-gradient-to-br from-cyan-600 to-cyan-800 flex items-center justify-center text-sm font-bold text-white border border-cyan-500 shadow-inner">
                                    🤖
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-bold text-cyan-200 truncate font-serif uppercase tracking-wider">Robot Station</h4>
                                    <span className="text-[9px] text-cyan-400/70 font-mono">{robotJobs.length} job{robotJobs.length !== 1 ? 's' : ''} in robot</span>
                                </div>
                            </div>
                        </div>
                        {/* Job Badges */}
                        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {robotJobs.length === 0 && (
                                <p className="text-[10px] text-[#444] text-center py-8 font-mono">No jobs in Robot</p>
                            )}
                            {robotJobs.map(job => {
                                const robotPct = job.weldingStationProgress?.robot ?? 0;
                                const saving = savingProgress === job.id;
                                return (
                                    <div key={job.id} className="border border-cyan-700/40 rounded p-2.5 bg-cyan-950/20 hover:brightness-110 transition-all">
                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span className="text-[11px] font-mono font-bold text-cyan-200">{job.id}</span>
                                            <div className="flex items-center gap-1">
                                                {saving && <Loader2 className="w-2.5 h-2.5 text-cyan-400 animate-spin" />}
                                                <span className={`text-[10px] font-mono font-bold ${robotPct >= 100 ? 'text-emerald-400' : robotPct > 0 ? 'text-cyan-300' : 'text-[#555]'}`}>{robotPct}%</span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-slate-300 truncate font-medium mb-1">{job.name}</p>
                                        {job.description && <p className="text-[9px] text-[#666] truncate mb-1">{job.description}</p>}
                                        {/* Press progress reference */}
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-[8px] text-orange-400/70 font-bold uppercase">Press</span>
                                            <div className="flex-1 h-1 bg-[#0a0a0a] rounded-sm overflow-hidden">
                                                <div className="h-full bg-orange-500/60" style={{ width: `${job.weldingStationProgress?.press ?? 0}%` }} />
                                            </div>
                                            <span className="text-[8px] text-orange-400/60 font-mono">{job.weldingStationProgress?.press ?? 0}%</span>
                                        </div>
                                        {/* Robot progress bar */}
                                        <div className="h-1.5 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-1.5">
                                            <div className={`h-full transition-all duration-500 ${robotPct >= 100 ? 'bg-emerald-600' : 'bg-cyan-500'}`} style={{ width: `${robotPct}%` }} />
                                        </div>
                                        {/* Progress buttons */}
                                        <div className="flex gap-0.5">
                                            {[0, 25, 50, 75, 100].map(val => (
                                                <button key={val} onClick={() => onStationProgressUpdate(job.id, 'robot', val)} disabled={saving}
                                                    className={`flex-1 py-0.5 rounded text-[8px] font-bold transition-all border
                                                    ${robotPct === val ? 'bg-cyan-600/30 text-cyan-300 border-cyan-600/50' : 'bg-[#111] text-[#555] border-[#333] hover:text-white hover:border-[#555]'}
                                                    ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                    {val}%
                                                </button>
                                            ))}
                                        </div>
                                        {/* Send back to Press */}
                                        <button
                                            onClick={() => {
                                                onStationProgressUpdate(job.id, 'robot', 0);
                                                onStationProgressUpdate(job.id, 'press', 50);
                                            }}
                                            disabled={saving}
                                            className="mt-1.5 w-full py-1 rounded border border-dashed border-orange-600/50 text-orange-300 hover:bg-orange-900/20 hover:border-orange-500 transition-all text-[8px] font-bold uppercase tracking-wider flex items-center justify-center gap-1"
                                        >
                                            ↩ Back to Press
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── FRAME WORKERS (badge columns) ── */}
                    {frameWorkers.length > 0 && (
                        <div className="flex flex-col gap-2 min-w-0 flex-1">
                            {frameWorkers.length > WORKERS_PER_PAGE && (
                                <div className="flex items-center justify-between rounded-md border border-[#333] bg-[#1a1a1a] px-2 h-6 leading-none">
                                    <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider leading-none">
                                        Frame Workers {framePageStart}-{framePageEnd} of {frameWorkers.length}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setFrameWorkerPage(p => Math.max(1, p - 1))}
                                            disabled={frameWorkerPage === 1}
                                            className="inline-flex h-4 items-center gap-0.5 rounded border border-[#444] px-1.5 text-[10px] font-bold leading-none text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#222]"
                                        >
                                            <ChevronLeft className="w-2.5 h-2.5" /> Prev
                                        </button>
                                        <span className="text-[10px] text-slate-300 font-mono leading-none">
                                            Page {frameWorkerPage} / {frameWorkerPageCount}
                                        </span>
                                        <button
                                            onClick={() => setFrameWorkerPage(p => Math.min(frameWorkerPageCount, p + 1))}
                                            disabled={frameWorkerPage === frameWorkerPageCount}
                                            className="inline-flex h-4 items-center gap-0.5 rounded border border-[#444] px-1.5 text-[10px] font-bold leading-none text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#222]"
                                        >
                                            Next <ChevronRight className="w-2.5 h-2.5" />
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div
                                className="grid gap-3 flex-1 min-h-0 overflow-auto"
                                style={{
                                    gridTemplateColumns: 'repeat(4, minmax(230px, 1fr))',
                                    gridTemplateRows: `repeat(${frameGridRows}, minmax(0, 1fr))`
                                }}
                            >
                                {pagedFrameWorkers.map(worker => {
                                    const workerFrameJobs = frameWorkerJobs.filter(j => j.assignedWorkers?.[department]?.includes(worker.name));
                                    return (
                                        <div key={worker.name} className="min-h-0">
                                            <WorkerColumn
                                                worker={worker}
                                                jobs={workerFrameJobs}
                                                department={department}
                                                onProgressUpdate={onProgressUpdate}
                                                savingProgress={savingProgress}
                                                onPositionChange={onWorkerPositionChange}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
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
            )}
        </div>
    );
}
