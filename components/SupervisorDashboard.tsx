'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, BellRing, CheckCircle, ClipboardPlus, Clock3, FileX2, Package, PackageX, ShieldAlert } from 'lucide-react';
import { db } from '@/lib/firebase';
import { DepartmentLiveStatus, Job, SupervisorAlert } from '@/types';
import { getDepartmentStatus, subscribeToAlerts } from '@/lib/supervisorAlerts';
import AlertCreateModal from './AlertCreateModal';

const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value !== null) {
        const maybeTimestamp = value as { toDate?: () => Date };
        if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export default function SupervisorDashboard() {
    const router = useRouter();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [alerts, setAlerts] = useState<SupervisorAlert[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        const run = async () => {
            try {
                const q = query(
                    collection(db, 'jobs'),
                    where('status', 'in', ['PENDING', 'IN_PROGRESS', 'HOLD']),
                    limit(500)
                );
                const snapshot = await getDocs(q);
                const fetched: Job[] = [];
                snapshot.forEach((docSnap) => {
                    const data = docSnap.data() as Job;
                    fetched.push({
                        ...data,
                        dueDate: toDate(data.dueDate) || new Date(),
                        updatedAt: toDate(data.updatedAt) || new Date()
                    });
                });
                setJobs(fetched);
            } catch (error) {
                console.error('Failed to fetch jobs for supervisor dashboard', error);
            } finally {
                setLoadingJobs(false);
            }
        };

        run();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToAlerts(setAlerts);
        return () => unsubscribe();
    }, []);

    const activeAlerts = useMemo(
        () => alerts.filter((alert) => alert.status === 'active'),
        [alerts]
    );

    const departmentStatus = useMemo<DepartmentLiveStatus[]>(
        () => getDepartmentStatus(activeAlerts, jobs),
        [activeAlerts, jobs]
    );

    const totalBlockedPoints = useMemo(
        () => departmentStatus.reduce((sum, dept) => sum + dept.totalBlockedPoints, 0),
        [departmentStatus]
    );

    return (
        <div className="supervisor-shell min-h-screen px-4 py-6 md:px-8">
            <AlertCreateModal
                isOpen={showCreateModal}
                jobs={jobs}
                onClose={() => setShowCreateModal(false)}
                onCreated={() => setShowCreateModal(false)}
            />

            <div className="max-w-7xl mx-auto space-y-6">
                <header className="supervisor-panel rounded-2xl p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <button
                            onClick={() => router.back()}
                            className="mt-0.5 p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-300/80 font-semibold">Supervisor Console</p>
                            <h1 className="text-2xl md:text-3xl font-bold text-white">Real-Time Shop Floor Feedback</h1>
                            <p className="text-sm text-slate-400 mt-1">
                                Report blockers quickly. Plant manager handles all reschedule decisions.
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-lg shadow-cyan-900/40 transition-colors"
                    >
                        <ClipboardPlus className="w-4 h-4" />
                        Report Issue
                    </button>
                </header>

                <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="supervisor-panel rounded-xl p-4">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Active Alerts</p>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-3xl font-bold text-amber-300">{activeAlerts.length}</span>
                            <BellRing className="w-5 h-5 text-amber-400" />
                        </div>
                    </div>
                    <div className="supervisor-panel rounded-xl p-4">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Departments Affected</p>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-3xl font-bold text-cyan-300">
                                {departmentStatus.filter((dept) => dept.activeAlerts > 0).length}
                            </span>
                            <ShieldAlert className="w-5 h-5 text-cyan-300" />
                        </div>
                    </div>
                    <div className="supervisor-panel rounded-xl p-4">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Blocked Points</p>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-3xl font-bold text-rose-300">{Math.round(totalBlockedPoints)}</span>
                            <AlertTriangle className="w-5 h-5 text-rose-300" />
                        </div>
                    </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
                    <div className="supervisor-panel rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Department Status</h2>
                            <span className="text-xs text-slate-500">{loadingJobs ? 'Loading jobs...' : `${jobs.length} active jobs`}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {departmentStatus.map((dept) => (
                                <div key={dept.department} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-semibold text-white">{dept.department}</span>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${dept.activeAlerts > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                                            {dept.activeAlerts} alert{dept.activeAlerts === 1 ? '' : 's'}
                                        </span>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-400">
                                        <div>Blocked jobs: <span className="text-slate-200 font-semibold">{dept.blockedJobs.length}</span></div>
                                        <div>Blocked points: <span className="text-slate-200 font-semibold">{dept.totalBlockedPoints}</span></div>
                                    </div>
                                    {dept.topIssue && (
                                        <div className="mt-2 text-[11px] text-amber-300 truncate" title={dept.topIssue}>
                                            Top issue: {dept.topIssue}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="supervisor-panel rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Active Alert Feed</h2>
                            <span className="text-xs text-slate-500">{activeAlerts.length} open</span>
                        </div>

                        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                            {activeAlerts.length === 0 && (
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                                    No active delays reported.
                                </div>
                            )}
                            {activeAlerts.map((alert) => (
                                <div key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-sm font-mono text-cyan-300">{alert.jobId}</div>
                                            <div className="text-xs text-slate-300 truncate" title={alert.jobName}>{alert.jobName}</div>
                                            {alert.additionalJobIds && alert.additionalJobIds.length > 0 && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {alert.additionalJobIds.map((id, idx) => (
                                                        <span key={id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700" title={alert.additionalJobNames?.[idx] || id}>
                                                            +{id}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                            {alert.department}
                                        </span>
                                        {alert.isSpecialPurchase && (
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold inline-flex items-center gap-1">
                                                <Package className="w-3 h-3" />
                                                SP
                                            </span>
                                        )}
                                        {alert.isCsiNotReceived && (
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold inline-flex items-center gap-1">
                                                <FileX2 className="w-3 h-3" />
                                                CSI
                                            </span>
                                        )}
                                        {alert.isOutOfStock && (
                                            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold inline-flex items-center gap-1">
                                                <PackageX className="w-3 h-3" />
                                                OOS
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-2 text-xs text-slate-300 leading-relaxed">{alert.reason}</p>
                                    {(alert.isSpecialPurchase || alert.isCsiNotReceived || alert.isOutOfStock) && alert.daysNeededAfterPO && (
                                        <div className="mt-1.5 text-[11px] text-sky-300 flex items-center gap-1">
                                            <Package className="w-3 h-3" />
                                            {alert.daysNeededAfterPO} business days needed after issue clears
                                        </div>
                                    )}
                                    {alert.poReceivedEarly && (
                                        <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] text-emerald-300 font-semibold flex items-center gap-1.5">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                            PO RECEIVED EARLY — consider readjusting schedule
                                        </div>
                                    )}
                                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                                        <span className="inline-flex items-center gap-1">
                                            <Clock3 className="w-3 h-3" />
                                            {new Date(alert.estimatedResolutionDate).toLocaleDateString()}
                                        </span>
                                        <span>{alert.daysBlocked} business day{alert.daysBlocked === 1 ? '' : 's'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
