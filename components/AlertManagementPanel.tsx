'use client';

import { useMemo, useState } from 'react';
import { Bell, CheckCircle2, ChevronDown, Clock3, Pencil, Trash2, X } from 'lucide-react';
import { Department, Job, SupervisorAlert } from '@/types';
import type { AlertAdjustmentDecision } from '@/lib/scheduler';

interface AlertManagementPanelProps {
    alerts: SupervisorAlert[];
    jobs: Job[];
    onClose: () => void;
    onResolve: (alertId: string) => Promise<void>;
    onExtend: (alertId: string, newDate: string) => Promise<void>;
    onEdit: (alertId: string, update: { reason?: string; estimatedResolutionDate?: string }) => Promise<void>;
    onAdjust: (
        alert: SupervisorAlert,
        mode: 'preview' | 'apply',
        previewDecision?: AlertAdjustmentDecision
    ) => Promise<{ success: boolean; message: string; decision?: AlertAdjustmentDecision }>;
    onDelete: (alertId: string) => Promise<void>;
}

const DEPARTMENTS: Department[] = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

const STRATEGY_LABEL: Record<'direct' | 'move_jobs' | 'ot', string> = {
    direct: 'Direct Capacity Slot',
    move_jobs: 'Shift Non-Late Jobs',
    ot: 'OT-Assisted Slot'
};

const toDateInput = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const businessDaysBetween = (startIso: string, endIso: string): number => {
    const start = new Date(startIso);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endIso);
    end.setHours(0, 0, 0, 0);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

    let count = 0;
    const cursor = new Date(start);
    while (cursor < end) {
        cursor.setDate(cursor.getDate() + 1);
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) count++;
    }
    return count;
};

export default function AlertManagementPanel({
    alerts,
    jobs,
    onClose,
    onResolve,
    onExtend,
    onEdit,
    onAdjust,
    onDelete
}: AlertManagementPanelProps) {
    const [departmentFilter, setDepartmentFilter] = useState<'ALL' | Department>('ALL');
    const [sortBy, setSortBy] = useState<'reported' | 'resolution'>('reported');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [extendId, setExtendId] = useState<string | null>(null);
    const [extendDate, setExtendDate] = useState('');
    const [editId, setEditId] = useState<string | null>(null);
    const [editReason, setEditReason] = useState('');
    const [editDate, setEditDate] = useState('');
    const [adjustFeedback, setAdjustFeedback] = useState<Record<string, { success: boolean; message: string }>>({});
    const [adjustPreview, setAdjustPreview] = useState<Record<string, AlertAdjustmentDecision>>({});

    const activeAlerts = useMemo(
        () => alerts.filter(alert => alert.status === 'active'),
        [alerts]
    );

    const jobsById = useMemo(() => {
        const map = new Map<string, Job>();
        for (const job of jobs) map.set(job.id, job);
        return map;
    }, [jobs]);

    const filteredAlerts = useMemo(() => {
        const base = activeAlerts.filter(alert =>
            departmentFilter === 'ALL' ? true : alert.department === departmentFilter
        );

        base.sort((a, b) => {
            if (sortBy === 'resolution') {
                return new Date(a.estimatedResolutionDate).getTime() - new Date(b.estimatedResolutionDate).getTime();
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        return base;
    }, [activeAlerts, departmentFilter, sortBy]);

    const summary = useMemo(() => {
        const affectedDepartments = new Set(activeAlerts.map(alert => alert.department)).size;
        const blockedJobIds = new Set(activeAlerts.flatMap(alert => [alert.jobId, ...(alert.additionalJobIds || [])]));
        let blockedPoints = 0;
        for (const jobId of blockedJobIds) {
            blockedPoints += jobsById.get(jobId)?.weldingPoints || 0;
        }
        return {
            activeCount: activeAlerts.length,
            affectedDepartments,
            blockedPoints: Math.round(blockedPoints)
        };
    }, [activeAlerts, jobsById]);

    const handleResolve = async (alertId: string) => {
        setBusyId(alertId);
        try {
            await onResolve(alertId);
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (alertId: string) => {
        setBusyId(alertId);
        try {
            await onDelete(alertId);
        } finally {
            setBusyId(null);
        }
    };

    const handleExtend = async (alertId: string) => {
        if (!extendDate) return;
        setBusyId(alertId);
        try {
            await onExtend(alertId, extendDate);
            setExtendId(null);
            setExtendDate('');
        } finally {
            setBusyId(null);
        }
    };

    const handleEdit = async (alertId: string) => {
        setBusyId(alertId);
        try {
            await onEdit(alertId, {
                reason: editReason,
                estimatedResolutionDate: editDate
            });
            setEditId(null);
            setEditReason('');
            setEditDate('');
        } finally {
            setBusyId(null);
        }
    };

    const handleAdjustPreview = async (alert: SupervisorAlert) => {
        setBusyId(alert.id);
        try {
            const result = await onAdjust(alert, 'preview');
            if (result.success && result.decision) {
                setAdjustPreview(prev => ({
                    ...prev,
                    [alert.id]: result.decision as AlertAdjustmentDecision
                }));
            } else {
                setAdjustPreview(prev => {
                    const next = { ...prev };
                    delete next[alert.id];
                    return next;
                });
            }
            setAdjustFeedback(prev => ({
                ...prev,
                [alert.id]: { success: result.success, message: result.message }
            }));
        } finally {
            setBusyId(null);
        }
    };

    const handleAdjustApply = async (alert: SupervisorAlert) => {
        const preview = adjustPreview[alert.id];
        if (!preview) return;

        setBusyId(alert.id);
        try {
            const result = await onAdjust(alert, 'apply', preview);
            setAdjustFeedback(prev => ({
                ...prev,
                [alert.id]: { success: result.success, message: result.message }
            }));
            if (result.success) {
                setAdjustPreview(prev => {
                    const next = { ...prev };
                    delete next[alert.id];
                    return next;
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Adjust failed unexpectedly.';
            setAdjustFeedback(prev => ({
                ...prev,
                [alert.id]: { success: false, message }
            }));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[1050] bg-slate-950/60 backdrop-blur-sm">
            <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
                <div className="px-5 py-4 border-b border-slate-800">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Bell className="w-5 h-5 text-amber-400" />
                            <h2 className="text-lg font-bold text-white">Alert Management</h2>
                        </div>
                        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                        <span className="text-rose-300 font-semibold">{summary.activeCount} active alerts</span>
                        {' '}· {summary.affectedDepartments} depts affected · {summary.blockedPoints} pts blocked
                    </p>
                </div>

                <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
                    <div className="relative">
                        <select
                            value={departmentFilter}
                            onChange={(e) => setDepartmentFilter(e.target.value as 'ALL' | Department)}
                            className="appearance-none bg-slate-950 border border-slate-700 text-sm text-slate-200 rounded-lg pl-3 pr-8 py-1.5"
                        >
                            <option value="ALL">All Departments</option>
                            {DEPARTMENTS.map(dept => (
                                <option key={dept} value={dept}>{dept}</option>
                            ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-2 pointer-events-none" />
                    </div>
                    <div className="relative">
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as 'reported' | 'resolution')}
                            className="appearance-none bg-slate-950 border border-slate-700 text-sm text-slate-200 rounded-lg pl-3 pr-8 py-1.5"
                        >
                            <option value="reported">Sort: Reported</option>
                            <option value="resolution">Sort: Resolution Date</option>
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-500 absolute right-2 top-2 pointer-events-none" />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {filteredAlerts.length === 0 && (
                        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                            No active alerts match this filter.
                        </div>
                    )}

                    {filteredAlerts.map((alert) => {
                        const job = jobsById.get(alert.jobId);
                        const daysBlocked = businessDaysBetween(new Date().toISOString(), alert.estimatedResolutionDate);
                        const severityClass = daysBlocked >= 7 ? 'text-red-300' : daysBlocked >= 3 ? 'text-orange-300' : 'text-amber-300';
                        const isBusy = busyId === alert.id;
                        const isExtending = extendId === alert.id;
                        const isEditing = editId === alert.id;
                        const preview = adjustPreview[alert.id];
                        const affectedCount = preview?.affectedJobIds?.length || 0;
                        const movedJobsCount = preview
                            ? Math.max(0, preview.jobShifts.filter(shift => shift.workDays !== 0).length - affectedCount)
                            : 0;
                        const totalShiftedJobs = preview
                            ? preview.jobShifts.filter(shift => shift.workDays !== 0).length
                            : 0;

                        return (
                            <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950/75 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-mono text-cyan-300">{alert.jobId}</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                                {alert.department}
                                            </span>
                                            {alert.additionalJobIds && alert.additionalJobIds.length > 0 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-semibold">
                                                    +{alert.additionalJobIds.length} more
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-300 truncate max-w-[260px]" title={alert.jobName}>
                                            {alert.jobName}
                                        </div>
                                        {alert.additionalJobIds && alert.additionalJobIds.length > 0 && (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {alert.additionalJobIds.map((id, idx) => (
                                                    <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700" title={alert.additionalJobNames?.[idx] || id}>
                                                        {id}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {job?.salesOrder && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">SO {job.salesOrder}</div>
                                        )}
                                    </div>
                                    <div className="text-right text-[10px] text-slate-500">
                                        <div>Reported</div>
                                        <div>{new Date(alert.createdAt).toLocaleDateString()}</div>
                                    </div>
                                </div>

                                {!isEditing ? (
                                    <p className="mt-2 text-sm text-slate-300 leading-relaxed">{alert.reason}</p>
                                ) : (
                                    <div className="mt-2 space-y-2">
                                        <textarea
                                            value={editReason}
                                            onChange={(e) => setEditReason(e.target.value)}
                                            className="w-full rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-100 px-2 py-1.5"
                                            rows={3}
                                        />
                                        <input
                                            type="date"
                                            value={editDate}
                                            onChange={(e) => setEditDate(e.target.value)}
                                            className="rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-100 px-2 py-1.5"
                                        />
                                    </div>
                                )}

                                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                                    <div className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-slate-400">
                                        Est. resolution: <span className="text-slate-200">{new Date(alert.estimatedResolutionDate).toLocaleDateString()}</span>
                                    </div>
                                    <div className={`rounded-md border border-slate-800 bg-slate-900 px-2 py-1 ${severityClass}`}>
                                        Days blocked: {daysBlocked}
                                    </div>
                                </div>

                                {alert.lastAdjustmentAt && (
                                    <div className="mt-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1.5 text-[11px] text-indigo-100">
                                        <div className="font-semibold">
                                            Adjusted {new Date(alert.lastAdjustmentAt).toLocaleString()}
                                            {alert.lastAdjustmentStrategy ? ` via ${STRATEGY_LABEL[alert.lastAdjustmentStrategy] || alert.lastAdjustmentStrategy}` : ''}
                                        </div>
                                        <div className="text-indigo-200/90 mt-0.5">
                                            {alert.lastAdjustmentReason || 'Schedule was adjusted based on alert resolution planning.'}
                                        </div>
                                    </div>
                                )}

                                {isExtending && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <input
                                            type="date"
                                            value={extendDate}
                                            onChange={(e) => setExtendDate(e.target.value)}
                                            className="rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-100 px-2 py-1.5"
                                        />
                                        <button
                                            onClick={() => handleExtend(alert.id)}
                                            disabled={isBusy || !extendDate}
                                            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50"
                                        >
                                            Save Date
                                        </button>
                                        <button
                                            onClick={() => {
                                                setExtendId(null);
                                                setExtendDate('');
                                            }}
                                            className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )}

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {!isEditing ? (
                                        <button
                                            onClick={() => {
                                                setEditId(alert.id);
                                                setEditReason(alert.reason);
                                                setEditDate(toDateInput(alert.estimatedResolutionDate));
                                            }}
                                            disabled={isBusy}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-50"
                                        >
                                            <Pencil className="w-3 h-3" /> Edit
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => handleEdit(alert.id)}
                                                disabled={isBusy}
                                                className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs disabled:opacity-50"
                                            >
                                                Save Edit
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditId(null);
                                                    setEditReason('');
                                                    setEditDate('');
                                                }}
                                                className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs"
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}

                                    <button
                                        onClick={() => handleAdjustPreview(alert)}
                                        disabled={isBusy}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-400/40 text-indigo-200 text-xs hover:bg-indigo-950/40 disabled:opacity-50"
                                    >
                                        {preview ? 'Refresh Suggestion' : 'Adjust'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setExtendId(alert.id);
                                            setExtendDate(toDateInput(alert.estimatedResolutionDate));
                                        }}
                                        disabled={isBusy}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-50"
                                    >
                                        <Clock3 className="w-3 h-3" /> Extend
                                    </button>
                                    <button
                                        onClick={() => handleResolve(alert.id)}
                                        disabled={isBusy}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs disabled:opacity-50"
                                    >
                                        <CheckCircle2 className="w-3 h-3" /> Resolve
                                    </button>
                                    <button
                                        onClick={() => handleDelete(alert.id)}
                                        disabled={isBusy}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-300 text-xs hover:bg-red-950/40 disabled:opacity-50"
                                    >
                                        <Trash2 className="w-3 h-3" /> Clear
                                    </button>
                                </div>

                                {preview && (
                                    <div className="mt-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1.5 text-[11px] text-indigo-100">
                                        <div className="font-semibold">
                                            Suggested date: {preview.selectedStartDate || preview.requestedStartDate}
                                        </div>
                                        <div className="mt-0.5">
                                            Method: {preview.strategy ? (STRATEGY_LABEL[preview.strategy] || preview.strategy) : 'Not specified'}
                                        </div>
                                        {preview.strategy === 'move_jobs' && (
                                            <div className="mt-0.5">
                                                Non-late jobs shifted: {movedJobsCount}
                                            </div>
                                        )}
                                        {preview.strategy === 'ot' && preview.otRequirements && preview.otRequirements.length > 0 && (
                                            <div className="mt-0.5">
                                                OT: {preview.otRequirements.map(req => `${req.department} ${req.weekKey} Tier ${req.requiredTier}`).join(', ')}
                                            </div>
                                        )}
                                        <div className="mt-0.5 text-indigo-200/90">{preview.reason}</div>
                                        <div className="mt-0.5">
                                            Planned shifts: {totalShiftedJobs}
                                        </div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <button
                                                onClick={() => handleAdjustApply(alert)}
                                                disabled={isBusy || totalShiftedJobs === 0}
                                                className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs disabled:opacity-50"
                                            >
                                                Confirm Move
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setAdjustPreview(prev => {
                                                        const next = { ...prev };
                                                        delete next[alert.id];
                                                        return next;
                                                    });
                                                }}
                                                disabled={isBusy}
                                                className="px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-200 text-xs disabled:opacity-50"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                        {totalShiftedJobs === 0 && (
                                            <div className="mt-1 text-[10px] text-indigo-200/80">
                                                No shift is required for this plan. Refresh suggestion if the schedule changed.
                                            </div>
                                        )}
                                    </div>
                                )}

                                {adjustFeedback[alert.id] && (
                                    <div
                                        className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] ${adjustFeedback[alert.id].success
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                                            : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                                            }`}
                                    >
                                        {adjustFeedback[alert.id].message}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
