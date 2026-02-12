'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    collection, query, where, limit, doc, updateDoc, onSnapshot,
    Timestamp, setDoc, getDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Department, Job, SupervisorAlert, WeldingSubStage } from '@/types';
import { startOfDay } from 'date-fns';
import { getDepartmentStatus, subscribeToAlerts, createPullNotice } from '@/lib/supervisorAlerts';
import AlertCreateModal from '../AlertCreateModal';

import {
    NavView,
    WorkerProfile,
    SupervisorScheduleSlot,
    SUPERVISOR_SCHEDULE_SLOTS,
    getSlotDept,
    toDate,
    normalizeScheduleDates,
} from './types';

import NavSwitch from './shared/NavSwitch';
import AlertsView from './shared/AlertsView';
import FutureWorkView from './shared/FutureWorkView';
import DefaultDeptView from './departments/DefaultDeptView';
import WeldingView from './departments/WeldingView';

import {
    Hammer, ChevronDown, ClipboardList, AlertTriangle,
    Eye, Power, ArrowLeft, Loader2,
    UserPlus, ClipboardPlus,
} from 'lucide-react';

// Get Monday–Friday window for the current work week
const getCurrentWorkWeek = (): { weekStart: Date; weekEnd: Date } => {
    const today = startOfDay(new Date());
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4); // Friday
    return { weekStart: startOfDay(weekStart), weekEnd: startOfDay(weekEnd) };
};

// ─────────────────────────────────────────────────────────────────
// MAIN SHELL
// ─────────────────────────────────────────────────────────────────

export default function SupervisorSchedule() {
    const router = useRouter();
    const [selectedSlot, setSelectedSlot] = useState<SupervisorScheduleSlot>('Welding');
    const [deptOpen, setDeptOpen] = useState(false);
    const selectedDept = getSlotDept(selectedSlot);
    const [activeView, setActiveView] = useState<NavView>('plan');
    const [jobs, setJobs] = useState<Job[]>([]);
    const [alerts, setAlerts] = useState<SupervisorAlert[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [savingProgress, setSavingProgress] = useState<string | null>(null);
    const [prefillJobId, setPrefillJobId] = useState<string | undefined>(undefined);

    // ── Roster State ──
    const [roster, setRoster] = useState<WorkerProfile[]>([]);
    const [rosterLoading, setRosterLoading] = useState(true);
    const [newWorkerName, setNewWorkerName] = useState('');
    const [showAddWorker, setShowAddWorker] = useState(false);
    const [editingWorker, setEditingWorker] = useState<WorkerProfile | null>(null);

    // ── Assignment UI ──
    const [assigningJob, setAssigningJob] = useState<string | null>(null);

    // ── Fetch Jobs (real-time) ──
    useEffect(() => {
        const q = query(
            collection(db, 'jobs'),
            where('status', 'in', ['PENDING', 'IN_PROGRESS', 'HOLD']),
            limit(500)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetched: Job[] = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data() as Job;
                fetched.push({
                    ...data,
                    id: data.id || docSnap.id,
                    dueDate: toDate(data.dueDate) || new Date(),
                    updatedAt: toDate(data.updatedAt) || new Date(),
                    departmentSchedule: normalizeScheduleDates((data as any).departmentSchedule),
                    remainingDepartmentSchedule: normalizeScheduleDates((data as any).remainingDepartmentSchedule),
                });
            });
            setJobs(fetched);
            setLoadingJobs(false);
        });
        return () => unsubscribe();
    }, []);

    // ── Fetch Roster ──
    useEffect(() => {
        setRosterLoading(true);
        const rosterKey = selectedSlot.replace(/[\s\/]/g, '_');
        const rosterRef = doc(db, 'departmentRosters', rosterKey);
        const unsubscribe = onSnapshot(rosterRef, (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                const workers = data.workers || [];
                const profiles: WorkerProfile[] = workers.map((w: string | WorkerProfile) =>
                    typeof w === 'string' ? { name: w, strengths: [] } : w
                );
                setRoster(profiles);
            } else {
                setRoster([]);
            }
            setRosterLoading(false);
        });
        return () => unsubscribe();
    }, [selectedDept, selectedSlot]);

    // ── Subscribe to Alerts ──
    useEffect(() => {
        const unsubscribe = subscribeToAlerts(setAlerts);
        return () => unsubscribe();
    }, []);

    const activeAlerts = useMemo(() => alerts.filter(a => a.status === 'active'), [alerts]);
    const deptAlerts = useMemo(() => activeAlerts.filter(a => a.department === selectedDept), [activeAlerts, selectedDept]);

    const deptJobs = useMemo(() => {
        const { weekStart, weekEnd } = getCurrentWorkWeek();
        const filtered = jobs.filter(j => {
            const schedule = j.remainingDepartmentSchedule || j.departmentSchedule;
            const window = schedule?.[selectedDept];
            if (!window) return false;
            const start = startOfDay(new Date(window.start));
            const end = startOfDay(new Date(window.end));
            return start <= weekEnd && end >= weekStart;
        });
        if (selectedSlot === 'Engineering F/H') return filtered.filter(j => j.productType === 'FAB' || j.productType === 'HARMONIC');
        if (selectedSlot === 'Engineering D') return filtered.filter(j => j.productType === 'DOORS');
        return filtered;
    }, [jobs, selectedDept, selectedSlot]);

    // ── Future work ──
    const futureJobs = useMemo(() => {
        const { weekEnd } = getCurrentWorkWeek();
        return jobs.filter(j => {
            const schedule = j.remainingDepartmentSchedule || j.departmentSchedule;
            const window = schedule?.[selectedDept];
            if (!window) return false;
            const start = startOfDay(new Date(window.start));
            return start > weekEnd;
        }).sort((a, b) => {
            const aInDept = a.currentDepartment === selectedDept;
            const bInDept = b.currentDepartment === selectedDept;
            if (aInDept && !bInDept) return -1;
            if (!aInDept && bInDept) return 1;
            const sA = (a.remainingDepartmentSchedule || a.departmentSchedule)?.[selectedDept]?.start;
            const sB = (b.remainingDepartmentSchedule || b.departmentSchedule)?.[selectedDept]?.start;
            return (sA ? new Date(sA).getTime() : Infinity) - (sB ? new Date(sB).getTime() : Infinity);
        });
    }, [jobs, selectedDept]);

    const totalPoints = useMemo(() => deptJobs.reduce((s, j) => s + (j.weldingPoints || 0), 0), [deptJobs]);
    const departmentStatus = useMemo(() => getDepartmentStatus(activeAlerts, jobs), [activeAlerts, jobs]);

    // ── Roster Management ──
    const addWorker = useCallback(async () => {
        const name = newWorkerName.trim();
        if (!name) return;
        const profile: WorkerProfile = { name, strengths: [], qualifications: [], comments: '' };
        const rosterKey = selectedSlot.replace(/[\s\/]/g, '_');
        const rosterRef = doc(db, 'departmentRosters', rosterKey);
        const snap = await getDoc(rosterRef);
        if (snap.exists()) {
            await updateDoc(rosterRef, { workers: arrayUnion(profile) });
        } else {
            await setDoc(rosterRef, { workers: [profile], department: selectedDept, slot: selectedSlot });
        }
        setNewWorkerName('');
    }, [newWorkerName, selectedDept, selectedSlot]);

    const updateWorkerProfile = useCallback(async (oldProfile: WorkerProfile, updatedProfile: WorkerProfile) => {
        const rosterKey = selectedSlot.replace(/[\s\/]/g, '_');
        const rosterRef = doc(db, 'departmentRosters', rosterKey);
        await updateDoc(rosterRef, { workers: arrayRemove(oldProfile) });
        await updateDoc(rosterRef, { workers: arrayUnion(updatedProfile) });
        setEditingWorker(null);
    }, [selectedDept, selectedSlot]);

    const removeWorker = useCallback(async (profile: WorkerProfile) => {
        const rosterKey = selectedSlot.replace(/[\s\/]/g, '_');
        const rosterRef = doc(db, 'departmentRosters', rosterKey);
        await updateDoc(rosterRef, { workers: arrayRemove(profile) });
    }, [selectedDept, selectedSlot]);

    // ── Assign Worker to Job ──
    const assignWorkerToJob = useCallback(async (jobId: string, workerName: string) => {
        const jobRef = doc(db, 'jobs', jobId);
        const job = deptJobs.find(j => j.id === jobId);
        const currentWorkers: string[] = job?.assignedWorkers?.[selectedDept] || [];
        if (currentWorkers.includes(workerName)) return;
        await updateDoc(jobRef, {
            [`assignedWorkers.${selectedDept}`]: [...currentWorkers, workerName],
            updatedAt: Timestamp.now(),
        });
    }, [selectedDept, deptJobs]);

    const unassignWorkerFromJob = useCallback(async (jobId: string, workerName: string) => {
        const jobRef = doc(db, 'jobs', jobId);
        const job = deptJobs.find(j => j.id === jobId);
        const currentWorkers: string[] = job?.assignedWorkers?.[selectedDept] || [];
        await updateDoc(jobRef, {
            [`assignedWorkers.${selectedDept}`]: currentWorkers.filter(w => w !== workerName),
            updatedAt: Timestamp.now(),
        });
    }, [selectedDept, deptJobs]);

    // ── Save Progress ──
    const handleProgressUpdate = useCallback(async (jobId: string, percent: number) => {
        setSavingProgress(jobId);
        try {
            await updateDoc(doc(db, 'jobs', jobId), {
                [`departmentProgress.${selectedDept}`]: percent,
                updatedAt: Timestamp.now(),
            });
        } catch (err) {
            console.error('Failed to update progress', err);
        } finally {
            setSavingProgress(null);
        }
    }, [selectedDept]);

    // ── Save Welding Station Progress (Press/Robot) ──
    const handleStationProgressUpdate = useCallback(async (jobId: string, stage: WeldingSubStage, pct: number) => {
        setSavingProgress(jobId);
        try {
            const job = jobs.find(j => j.id === jobId);
            const updates: Record<string, any> = {
                [`weldingStationProgress.${stage}`]: pct,
                updatedAt: Timestamp.now(),
            };
            // When press > 0 and robot doesn't exist yet, initialize robot at 0
            if (stage === 'press' && pct > 0) {
                if (job && (job.weldingStationProgress?.robot === undefined)) {
                    updates['weldingStationProgress.robot'] = 0;
                }
            }
            // Sync combined station progress → departmentProgress.Welding
            // so the Gantt chart reflects it. Press = 50%, Robot = 50%.
            const currentPress = stage === 'press' ? pct : (job?.weldingStationProgress?.press ?? 0);
            const currentRobot = stage === 'robot' ? pct : (job?.weldingStationProgress?.robot ?? 0);
            const combined = Math.round((currentPress + currentRobot) / 2);
            updates['departmentProgress.Welding'] = combined;

            await updateDoc(doc(db, 'jobs', jobId), updates);
        } catch (err) {
            console.error('Failed to update station progress', err);
        } finally {
            setSavingProgress(null);
        }
    }, [jobs]);

    // ── Assign Door Leaf to Press ──
    const assignToPress = useCallback(async (jobId: string) => {
        try {
            await updateDoc(doc(db, 'jobs', jobId), {
                'weldingStationProgress.press': 0,
                updatedAt: Timestamp.now(),
            });
        } catch (err) {
            console.error('Failed to assign to press', err);
        }
    }, []);

    // Pull job from Future Work into today's queue for this department.
    const pullJobToQueue = useCallback(async (jobId: string, reason: string) => {
        const job = jobs.find(j => j.id === jobId);
        if (!job) return;
        const fromDept = job.currentDepartment;
        const toDept = selectedDept;
        try {
            await updateDoc(doc(db, 'jobs', jobId), {
                currentDepartment: toDept,
                supervisorPulledAt: Timestamp.now(),
                supervisorPulledFrom: fromDept,
                supervisorPullReason: reason,
                updatedAt: Timestamp.now(),
            });
            await createPullNotice({
                jobId,
                jobName: job.name,
                fromDepartment: fromDept,
                toDepartment: toDept,
                pullReason: reason,
            });
        } catch (err) {
            console.error('Failed to pull job to queue', err);
        }
    }, [jobs, selectedDept]);

    // ── Shared props passed to department views ──
    const deptViewProps = {
        jobs: deptJobs,
        department: selectedDept,
        selectedSlot,
        roster,
        rosterLoading,
        showAddWorker,
        newWorkerName,
        onNewWorkerNameChange: setNewWorkerName,
        onAddWorker: addWorker,
        onRemoveWorker: removeWorker,
        onSetShowAddWorker: setShowAddWorker,
        onEditWorker: setEditingWorker,
        editingWorker,
        onUpdateWorkerProfile: updateWorkerProfile,
        onCancelEditWorker: () => setEditingWorker(null),
        onAssignWorker: assignWorkerToJob,
        onUnassignWorker: unassignWorkerFromJob,
        onProgressUpdate: handleProgressUpdate,
        onStationProgressUpdate: handleStationProgressUpdate,
        onAssignToPress: assignToPress,
        savingProgress,
        assigningJob,
        onSetAssigningJob: setAssigningJob,
        alerts: deptAlerts,
        onReportIssue: (jobId: string) => { setPrefillJobId(jobId); setShowCreateModal(true); },
    };

    // Choose the right view component for the current department
    const TodaysPlanView = selectedDept === 'Welding' ? WeldingView : DefaultDeptView;

    return (
        <div className="flex h-screen bg-[#111] overflow-hidden text-slate-200 font-sans">
            <AlertCreateModal
                isOpen={showCreateModal}
                jobs={jobs}
                onClose={() => { setShowCreateModal(false); setPrefillJobId(undefined); }}
                onCreated={() => { setShowCreateModal(false); setPrefillJobId(undefined); }}
                prefillJobId={prefillJobId}
            />

            {/* ═══════════════════════════════════════════════════════
                SIDEBAR
            ═══════════════════════════════════════════════════════ */}
            <div className="w-72 bg-[#1a1a1a] border-r border-[#333] flex flex-col flex-shrink-0 relative z-20 shadow-[5px_0_20px_rgba(0,0,0,0.5)]">
                <div className="absolute inset-0 opacity-10 pointer-events-none"
                    style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, #fff 2px, #fff 3px)' }} />

                {/* Header */}
                <div className="h-20 flex items-center justify-between px-6 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] relative shrink-0">
                    <div className="flex items-center gap-3 text-slate-400">
                        <div className="p-2 bg-[#111] border border-[#444] rounded shadow-inner">
                            <Hammer className="w-5 h-5 drop-shadow-md text-slate-300" />
                        </div>
                        <div>
                            <span className="block font-bold tracking-widest uppercase text-sm font-serif">Supervisor<span className="text-white">Schedule</span></span>
                            <span className="block text-[10px] text-[#666] tracking-widest uppercase">Operations Terminal</span>
                        </div>
                    </div>
                    <button onClick={() => router.push('/')} className="p-1.5 rounded border border-[#333] text-[#555] hover:text-white hover:border-[#555] transition-colors" title="Back to Portal">
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 flex-1 relative z-10 space-y-8 overflow-y-auto">
                    {/* Sector Control */}
                    <div className="bg-[#111] p-1 rounded-lg border border-[#333] shadow-inner">
                        <div className="bg-[#222] border border-[#444] rounded p-3 relative group cursor-pointer hover:border-sky-500/50 transition-colors" onClick={() => setDeptOpen(!deptOpen)}>
                            <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)] animate-pulse" />
                            <span className="text-[10px] text-[#666] uppercase tracking-widest font-bold block mb-1">Sector Control</span>
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-slate-200 font-serif text-lg group-hover:text-white">{selectedSlot.toUpperCase()}</span>
                                <ChevronDown className={`w-4 h-4 text-[#666] group-hover:text-sky-400 transition-transform ${deptOpen ? 'rotate-180' : ''}`} />
                            </div>
                        </div>
                        {deptOpen && (
                            <div className="mt-1 bg-[#1a1a1a] border border-[#444] rounded shadow-xl overflow-hidden">
                                {SUPERVISOR_SCHEDULE_SLOTS.map(({ label, slot }) => (
                                    <button key={slot} onClick={() => { setSelectedSlot(slot); setDeptOpen(false); }}
                                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between
                                            ${slot === selectedSlot ? 'bg-sky-600/20 text-sky-300 font-bold' : 'text-slate-400 hover:bg-[#222] hover:text-white'}`}>
                                        <span className="font-serif uppercase tracking-wide">{label}</span>
                                        {slot === selectedSlot && <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Nav Switches */}
                    <div className="space-y-2">
                        <p className="text-[10px] text-[#555] uppercase tracking-widest font-bold ml-2 mb-2">Modules</p>
                        <NavSwitch icon={<ClipboardList />} label="Today's Plan" active={activeView === 'plan'} onClick={() => setActiveView('plan')} count={deptJobs.length} />
                        <NavSwitch icon={<AlertTriangle />} label="Alerts" active={activeView === 'alerts'} onClick={() => setActiveView('alerts')} count={deptAlerts.length} isAlert={deptAlerts.length > 0} />
                        <NavSwitch icon={<Eye />} label="Future Work" active={activeView === 'future'} onClick={() => setActiveView('future')} count={futureJobs.length} />
                    </div>

                    {/* Load Stats */}
                    <div className="bg-[#151515] rounded border border-[#333] p-4">
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-[10px] text-[#666] font-bold uppercase">Dept Load</span>
                            <span className="text-xs font-mono text-sky-400 font-bold">{deptJobs.length} jobs</span>
                        </div>
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-[10px] text-[#666] font-bold uppercase">Total Points</span>
                            <span className="text-xs font-mono text-slate-300 font-bold">{Math.round(totalPoints)} pts</span>
                        </div>
                        <div className="flex justify-between items-end">
                            <span className="text-[10px] text-[#666] font-bold uppercase">Crew Size</span>
                            <span className="text-xs font-mono text-slate-300 font-bold">{roster.length} workers</span>
                        </div>
                    </div>
                </div>

                {/* User Plate */}
                <div className="p-4 border-t border-[#333] bg-[#151515] shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center font-bold text-white border border-slate-600 shadow-lg text-sm">SV</div>
                        <div className="flex-1 overflow-hidden">
                            <div className="text-sm font-bold text-slate-300 truncate font-serif">Supervisor</div>
                            <div className="text-[10px] text-[#666] uppercase tracking-wider truncate">{selectedDept}</div>
                        </div>
                        <Power className="w-4 h-4 text-[#444] hover:text-rose-500 cursor-pointer transition-colors" onClick={() => router.push('/')} />
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════
                MAIN WORKSPACE
            ═══════════════════════════════════════════════════════ */}
            <div className="flex-1 flex flex-col h-full bg-[#151515] relative">
                <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
                    style={{ backgroundImage: `linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />

                {/* Top Bar */}
                <div className="h-14 border-b border-[#333] bg-[#1a1a1a]/90 backdrop-blur flex items-center justify-between px-6 z-10 shadow-md shrink-0">
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-bold text-slate-100 font-serif uppercase tracking-wide">
                            {activeView === 'plan' && "Today's Plan"}
                            {activeView === 'alerts' && 'Active Alerts'}
                            {activeView === 'future' && 'Future Work'}
                        </h2>
                        <div className="h-5 w-px bg-[#333]" />
                        <span className="text-[10px] text-[#666] font-mono">{selectedDept.toUpperCase()} • {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {activeView === 'alerts' && (
                            <button onClick={() => setShowCreateModal(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-xs font-bold text-white uppercase tracking-wider transition-colors flex items-center gap-2">
                                <ClipboardPlus className="w-3.5 h-3.5" /> Report Issue
                            </button>
                        )}
                        {activeView === 'plan' && (
                            <button onClick={() => setShowAddWorker(!showAddWorker)} className="px-3 py-1.5 bg-[#222] hover:bg-[#333] border border-[#444] rounded text-xs font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors flex items-center gap-2">
                                <UserPlus className="w-3.5 h-3.5" /> Manage Roster
                            </button>
                        )}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden z-0">
                    {loadingJobs ? (
                        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-[#555] animate-spin" /></div>
                    ) : (
                        <>
                            {activeView === 'plan' && <TodaysPlanView {...deptViewProps} />}
                            {activeView === 'alerts' && <AlertsView alerts={deptAlerts} allAlerts={activeAlerts} departmentStatus={departmentStatus} />}
                            {activeView === 'future' && <FutureWorkView jobs={futureJobs} department={selectedDept} onPullToQueue={pullJobToQueue} />}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
