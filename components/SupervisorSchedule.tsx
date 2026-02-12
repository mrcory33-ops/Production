'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
    collection, getDocs, query, where, limit, doc, updateDoc, onSnapshot,
    Timestamp, setDoc, getDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Department, Job, SupervisorAlert, WeldingSubStage } from '@/types';
import { format, startOfDay } from 'date-fns';
import { getBatchKeyForJob, BATCH_COHORT_WINDOW_BUSINESS_DAYS } from '@/lib/scheduler';
import { getDepartmentStatus, subscribeToAlerts, createPullNotice } from '@/lib/supervisorAlerts';
import { DEPT_ORDER, DEPARTMENT_CONFIG } from '@/lib/departmentConfig';
import AlertCreateModal from './AlertCreateModal';
import {
    Hammer, ChevronDown, ClipboardList, Users, AlertTriangle,
    Eye, Power, Calendar, ChevronRight, Plus, X, UserPlus,
    ClipboardPlus, BellRing, ShieldAlert, Package, PackageX,
    FileX2, Clock3, ArrowLeft, Loader2, GripVertical, Check,
    Pencil, MessageSquare, Search, ArrowDownToLine
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

type NavView = 'plan' | 'alerts' | 'future';

const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value !== null) {
        const t = value as { toDate?: () => Date };
        if (typeof t.toDate === 'function') return t.toDate();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Normalize Firestore Timestamps → ISO strings for departmentSchedule
const normalizeScheduleDates = (
    schedule?: Record<string, { start: any; end: any }>
): Record<string, { start: string; end: string }> | undefined => {
    if (!schedule) return undefined;
    const result: Record<string, { start: string; end: string }> = {};
    for (const [dept, dates] of Object.entries(schedule)) {
        const s = toDate(dates?.start);
        const e = toDate(dates?.end);
        if (s && e) result[dept] = { start: s.toISOString(), end: e.toISOString() };
    }
    return Object.keys(result).length > 0 ? result : undefined;
};

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

// Product type color mapping
const PRODUCT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
    FAB: { bg: 'bg-sky-900/40', text: 'text-sky-300', border: 'border-sky-700/50', label: 'FAB' },
    DOORS: { bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-700/50', label: 'DOORS' },
    HARMONIC: { bg: 'bg-violet-900/40', text: 'text-violet-300', border: 'border-violet-700/50', label: 'HARMONIC' },
};

// Worker profile type
interface WorkerProfile {
    name: string;
    strengths: string[];  // legacy field
    qualifications?: string[];  // e.g. ["TIG Welding", "Blueprint Reading", "Forklift Certified"]
    comments?: string;
    notes?: string;
}

type ProductFilter = 'ALL' | 'FAB' | 'DOORS' | 'HARMONIC';

// CrewDeck-specific department slots (splits Engineering into 2 sub-teams)
type SupervisorScheduleSlot = Department | 'Engineering F/H' | 'Engineering D';
const SUPERVISOR_SCHEDULE_SLOTS: { label: string; slot: SupervisorScheduleSlot; dept: Department }[] = [
    { label: 'Engineering F/H', slot: 'Engineering F/H', dept: 'Engineering' },
    { label: 'Engineering D', slot: 'Engineering D', dept: 'Engineering' },
    { label: 'Laser', slot: 'Laser', dept: 'Laser' },
    { label: 'Press Brake', slot: 'Press Brake', dept: 'Press Brake' },
    { label: 'Welding', slot: 'Welding', dept: 'Welding' },
    { label: 'Polishing', slot: 'Polishing', dept: 'Polishing' },
    { label: 'Assembly', slot: 'Assembly', dept: 'Assembly' },
];
const getSlotDept = (slot: SupervisorScheduleSlot): Department => SUPERVISOR_SCHEDULE_SLOTS.find(s => s.slot === slot)?.dept || slot as Department;

// ─────────────────────────────────────────────────────────────────
// MAIN COMPONENT
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
                // Support legacy string[] format and new WorkerProfile[] format
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
            // Job overlaps this work week if: start <= weekEnd AND end >= weekStart
            return start <= weekEnd && end >= weekStart;
        });
        // For Engineering sub-slots, further filter by product type
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
            // Future = starts after this work week
            return start > weekEnd;
        }).sort((a, b) => {
            // Sort swap candidates (in-dept) first, then by scheduled start
            const aInDept = a.currentDepartment === selectedDept;
            const bInDept = b.currentDepartment === selectedDept;
            if (aInDept && !bInDept) return -1;
            if (!aInDept && bInDept) return 1;
            const sA = (a.remainingDepartmentSchedule || a.departmentSchedule)?.[selectedDept]?.start;
            const sB = (b.remainingDepartmentSchedule || b.departmentSchedule)?.[selectedDept]?.start;
            return (sA ? new Date(sA).getTime() : Infinity) - (sB ? new Date(sB).getTime() : Infinity);
        });
    }, [jobs, selectedDept]);

    // ── Load stats ──
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
        // Remove old, add updated
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
        if (currentWorkers.includes(workerName)) return; // already assigned
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
            const updates: Record<string, any> = {
                [`weldingStationProgress.${stage}`]: pct,
                updatedAt: Timestamp.now(),
            };
            // When press > 0 and robot doesn't exist yet, initialize robot at 0
            if (stage === 'press' && pct > 0) {
                const job = jobs.find(j => j.id === jobId);
                if (job && (job.weldingStationProgress?.robot === undefined)) {
                    updates['weldingStationProgress.robot'] = 0;
                }
            }
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
                            {activeView === 'plan' && (
                                <TodaysPlanView
                                    jobs={deptJobs}
                                    department={selectedDept}
                                    selectedSlot={selectedSlot}
                                    roster={roster}
                                    rosterLoading={rosterLoading}
                                    showAddWorker={showAddWorker}
                                    newWorkerName={newWorkerName}
                                    onNewWorkerNameChange={setNewWorkerName}
                                    onAddWorker={addWorker}
                                    onRemoveWorker={removeWorker}
                                    onSetShowAddWorker={setShowAddWorker}
                                    onEditWorker={setEditingWorker}
                                    editingWorker={editingWorker}
                                    onUpdateWorkerProfile={updateWorkerProfile}
                                    onCancelEditWorker={() => setEditingWorker(null)}
                                    onAssignWorker={assignWorkerToJob}
                                    onUnassignWorker={unassignWorkerFromJob}
                                    onProgressUpdate={handleProgressUpdate}
                                    onStationProgressUpdate={handleStationProgressUpdate}
                                    onAssignToPress={assignToPress}
                                    savingProgress={savingProgress}
                                    assigningJob={assigningJob}
                                    onSetAssigningJob={setAssigningJob}
                                    alerts={deptAlerts}
                                    onReportIssue={(jobId) => { setPrefillJobId(jobId); setShowCreateModal(true); }}
                                />
                            )}
                            {activeView === 'alerts' && (
                                <AlertsView alerts={deptAlerts} allAlerts={activeAlerts} departmentStatus={departmentStatus} />
                            )}
                            {activeView === 'future' && (
                                <FutureWorkView jobs={futureJobs} department={selectedDept} onPullToQueue={pullJobToQueue} />
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// NAV SWITCH
// ─────────────────────────────────────────────────────────────────

function NavSwitch({ icon, label, active, onClick, count, isAlert }: {
    icon: React.ReactElement; label: string; active: boolean; onClick: () => void; count?: number; isAlert?: boolean;
}) {
    return (
        <div onClick={onClick} className={`relative group flex items-center gap-3 px-3 py-3 mx-2 rounded cursor-pointer transition-all border
            ${active ? 'bg-[#222] border-sky-500/50 shadow-[0_0_10px_rgba(56,189,248,0.1)]' : 'bg-transparent border-transparent hover:bg-[#222] hover:border-[#333]'}`}>
            <div className={`text-[#666] transition-colors ${active ? 'text-sky-300' : 'group-hover:text-[#ccc]'}`}>
                {React.cloneElement(icon, { className: 'w-5 h-5' } as React.SVGProps<SVGSVGElement>)}
            </div>
            <span className={`text-sm tracking-wide font-medium flex-1 ${active ? 'text-slate-200' : 'text-[#888] group-hover:text-[#ccc]'}`}>{label}</span>
            {active && <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.8)]" />}
            {count !== undefined && count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${isAlert ? 'bg-rose-900/30 text-rose-400 border-rose-800' : 'bg-[#111] text-[#666] border-[#333]'}`}>{count}</span>
            )}
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// PRODUCT FILTER TABS (extracted to avoid TSX type-assertion issue)
// ─────────────────────────────────────────────────────────────────

function FilterTabs({ isWelding, productFilter, setProductFilter, jobs, fabCount, doorsCount, harmonicCount }: {
    isWelding: boolean; productFilter: ProductFilter; setProductFilter: (v: ProductFilter) => void;
    jobs: Job[]; fabCount: number; doorsCount: number; harmonicCount: number;
}) {
    const tabs: [ProductFilter, string, number, string][] = isWelding
        ? [['ALL', 'All', jobs.length, 'bg-[#333] text-slate-300 border-[#555]'], ['FAB', 'FAB', fabCount, 'bg-sky-900/40 text-sky-300 border-sky-700/50'], ['DOORS', 'Doors', doorsCount, 'bg-amber-900/40 text-amber-300 border-amber-700/50']]
        : [['ALL', 'All', jobs.length, 'bg-[#333] text-slate-300 border-[#555]'], ['FAB', 'FAB', fabCount, 'bg-sky-900/40 text-sky-300 border-sky-700/50'], ['DOORS', 'Doors', doorsCount, 'bg-amber-900/40 text-amber-300 border-amber-700/50'], ['HARMONIC', 'Harmonic', harmonicCount, 'bg-violet-900/40 text-violet-300 border-violet-700/50']];
    return (
        <div className="px-4 pb-3 flex gap-1">
            {tabs.map(([key, label, count, activeStyle]) => (
                <button key={key}
                    onClick={() => setProductFilter(key)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all border flex items-center gap-1.5
                        ${productFilter === key ? activeStyle : 'bg-transparent text-[#666] border-transparent hover:text-[#999]'}`}
                >
                    {label}
                    <span className={`text-[9px] ${productFilter === key ? 'opacity-80' : 'opacity-50'}`}>{count}</span>
                </button>
            ))}
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// TODAY'S PLAN — Job Queue + Worker Columns
// ─────────────────────────────────────────────────────────────────


function TodaysPlanView({ jobs, department, selectedSlot, roster, rosterLoading, showAddWorker, newWorkerName, onNewWorkerNameChange, onAddWorker, onRemoveWorker, onSetShowAddWorker, onEditWorker, editingWorker, onUpdateWorkerProfile, onCancelEditWorker, onAssignWorker, onUnassignWorker, onProgressUpdate, onStationProgressUpdate, onAssignToPress, savingProgress, assigningJob, onSetAssigningJob, alerts, onReportIssue }: {
    jobs: Job[]; department: Department; selectedSlot: SupervisorScheduleSlot; roster: WorkerProfile[]; rosterLoading: boolean;
    showAddWorker: boolean; newWorkerName: string;
    onNewWorkerNameChange: (v: string) => void;
    onAddWorker: () => void; onRemoveWorker: (p: WorkerProfile) => void; onSetShowAddWorker: (v: boolean) => void;
    onEditWorker: (w: WorkerProfile) => void;
    editingWorker: WorkerProfile | null;
    onUpdateWorkerProfile: (old: WorkerProfile, updated: WorkerProfile) => void;
    onCancelEditWorker: () => void;
    onAssignWorker: (jobId: string, worker: string) => void; onUnassignWorker: (jobId: string, worker: string) => void;
    onProgressUpdate: (jobId: string, pct: number) => void;
    onStationProgressUpdate: (jobId: string, stage: WeldingSubStage, pct: number) => void;
    onAssignToPress: (jobId: string) => void;
    savingProgress: string | null;
    assigningJob: string | null; onSetAssigningJob: (v: string | null) => void;
    alerts: SupervisorAlert[];
    onReportIssue: (jobId: string) => void;
}) {
    const [productFilter, setProductFilter] = useState<ProductFilter>('ALL');

    // ── Frame vs Door Leaf classifiers (Welding Doors workflow) ──
    const isWelding = department === 'Welding';
    const isDoorLeaf = (job: Job) => job.productType === 'DOORS' && !/\b(frame|fr)\b/i.test(job.description || '');
    const isFrame = (job: Job) => job.productType === 'DOORS' && /\b(frame|fr)\b/i.test(job.description || '');
    const isDoorsView = isWelding && productFilter === 'DOORS';

    // Sort jobs: active first, then group by product type, then by description (batching), then by due date
    const PRODUCT_TYPE_SORT: Record<string, number> = { DOORS: 0, FAB: 1, HARMONIC: 2 };
    const sorted = useMemo(() => {
        let filtered = [...jobs];
        if (productFilter !== 'ALL') {
            // In Welding, FAB tab includes both FAB and HARMONIC
            if (isWelding && productFilter === 'FAB') {
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
            // Sort by scheduled start date in this department (earliest first)
            const schedA = (a.remainingDepartmentSchedule || a.departmentSchedule)?.[department];
            const schedB = (b.remainingDepartmentSchedule || b.departmentSchedule)?.[department];
            const startA = schedA ? new Date(schedA.start).getTime() : Infinity;
            const startB = schedB ? new Date(schedB.start).getTime() : Infinity;
            if (startA !== startB) return startA - startB;
            // Secondary: group by product type
            const aType = PRODUCT_TYPE_SORT[a.productType || 'FAB'] ?? 1;
            const bType = PRODUCT_TYPE_SORT[b.productType || 'FAB'] ?? 1;
            if (aType !== bType) return aType - bType;
            // Tertiary: batch key grouping
            const aDesc = (a.description || '').trim().toLowerCase();
            const bDesc = (b.description || '').trim().toLowerCase();
            if (aDesc !== bDesc) return aDesc.localeCompare(bDesc);
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
    }, [jobs, department, productFilter]);

    // Batch key: only the 8 defined categories are eligible for batching
    // Key is category-only — all items of the same type batch together
    // NOTE: This now uses the same composite key as the scheduler.
    const getBatchKey = (j: Job): string | null => getBatchKeyForJob(j);
    const getBatchCohortKey = (j: Job): string | null => {
        const key = getBatchKey(j);
        if (!key) return null;
        return `${key}|DEPT:${j.currentDepartment || 'UNKNOWN'}`;
    };

    // Calculate 12 business days ahead from today
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

    // Only batch jobs in Press Brake or earlier departments
    const PRESS_BRAKE_INDEX = DEPT_ORDER.indexOf('Press Brake');
    const isBatchEligible = (j: Job) => DEPT_ORDER.indexOf(j.currentDepartment) <= PRESS_BRAKE_INDEX;

    const batchInfo = useMemo(() => {
        const counts: Record<string, number> = {};
        const labels: Record<string, string> = {};
        sorted.forEach(j => {
            if (!isBatchEligible(j)) return;
            const dueDate = new Date(j.dueDate);
            if (dueDate > batchWindowEnd) return; // Outside 12 business day window
            const key = getBatchCohortKey(j);
            if (!key) return;
            counts[key] = (counts[key] || 0) + 1;
            if (!labels[key]) labels[key] = j.description || j.productType || 'FAB';
        });
        return { counts, labels };
    }, [sorted]);

    // Get jobs assigned to a specific worker
    const getWorkerJobs = (workerName: string) => jobs.filter(j => j.assignedWorkers?.[department]?.includes(workerName));

    const rosterNames = roster.map(w => w.name);

    // Count by product type (for Welding, merge FAB+HARMONIC)
    const fabCount = isWelding
        ? jobs.filter(j => j.productType === 'FAB' || j.productType === 'HARMONIC').length
        : jobs.filter(j => j.productType === 'FAB').length;
    const doorsCount = jobs.filter(j => j.productType === 'DOORS').length;
    const harmonicCount = jobs.filter(j => j.productType === 'HARMONIC').length;

    // ── Doors-specific derived data ──
    const pressJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isDoorLeaf(j) && j.weldingStationProgress?.press !== undefined && (j.weldingStationProgress.press ?? 0) < 100)
        : [], [sorted, isDoorsView]);
    const robotJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isDoorLeaf(j) && (j.weldingStationProgress?.press ?? -1) > 0)
        : [], [sorted, isDoorsView]);
    const unassignedDoorLeafs = useMemo(() => isDoorsView
        ? sorted.filter(j => isDoorLeaf(j) && j.weldingStationProgress?.press === undefined)
        : [], [sorted, isDoorsView]);
    const frameWorkerJobs = useMemo(() => isDoorsView
        ? sorted.filter(j => isFrame(j))
        : [], [sorted, isDoorsView]);

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
                    onSave={(updated: WorkerProfile) => onUpdateWorkerProfile(editingWorker, updated)}
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
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div >

            {/* ── RIGHT AREA: Worker Columns OR Doors Station Layout ── */}
            {
                isDoorsView ? (
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
                        {/* ── UNASSIGNED DOOR LEAF JOBS ── */}
                        {unassignedDoorLeafs.length > 0 && (
                            <div className="bg-[#1a1a1a] border border-amber-700/30 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">🚪 Unassigned Door Leaf Jobs</span>
                                    <span className="text-[9px] bg-amber-900/40 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700/40 font-mono">{unassignedDoorLeafs.length}</span>
                                </div>
                                <div className="space-y-1.5">
                                    {unassignedDoorLeafs.map(job => (
                                        <div key={job.id} className="flex items-center justify-between bg-[#222] rounded border border-[#333] px-3 py-2">
                                            <div className="min-w-0 flex-1">
                                                <span className="text-xs font-mono font-bold text-white">{job.id}</span>
                                                <span className="text-[10px] text-slate-400 ml-2 truncate">{job.name}</span>
                                                {job.description && <span className="text-[9px] text-[#666] ml-2">· {job.description}</span>}
                                            </div>
                                            <button
                                                onClick={() => onAssignToPress(job.id)}
                                                className="ml-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-[10px] font-bold text-white uppercase tracking-wider transition-colors flex items-center gap-1.5 shrink-0"
                                            >
                                                ⚙️ PRESS
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── PRESS STATION ── */}
                        <div className="bg-[#1a1a1a] border border-orange-600/40 rounded-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-orange-900/40 to-[#1a1a1a] px-4 py-2.5 flex items-center justify-between border-b border-orange-700/30">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🔧</span>
                                    <span className="text-sm font-bold uppercase tracking-wider text-orange-300 font-serif">Press Station</span>
                                </div>
                                <span className="bg-orange-900/50 text-orange-300 border border-orange-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">{pressJobs.length}</span>
                            </div>
                            <div className="p-3 space-y-2">
                                {pressJobs.length === 0 ? (
                                    <p className="text-xs text-[#555] text-center py-6 font-mono">No jobs in Press</p>
                                ) : pressJobs.map(job => {
                                    const pressPct = job.weldingStationProgress?.press ?? 0;
                                    const saving = savingProgress === job.id;
                                    return (
                                        <div key={job.id} className="bg-[#222] rounded border border-[#333] p-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-mono font-bold text-white">{job.id}</span>
                                                    <span className="text-[10px] text-slate-400 truncate">{job.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {saving && <Loader2 className="w-2.5 h-2.5 text-orange-400 animate-spin" />}
                                                    <span className={`text-xs font-mono font-bold ${pressPct >= 100 ? 'text-emerald-400' : pressPct > 0 ? 'text-orange-400' : 'text-[#555]'}`}>{pressPct}%</span>
                                                </div>
                                            </div>
                                            {job.description && <p className="text-[9px] text-[#666] mb-1.5 truncate">{job.description}</p>}
                                            <div className="h-2 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-2">
                                                <div className={`h-full transition-all duration-500 ${pressPct >= 100 ? 'bg-emerald-600' : 'bg-orange-500'}`} style={{ width: `${pressPct}%` }} />
                                            </div>
                                            <div className="flex gap-1">
                                                {[0, 25, 50, 75, 100].map(val => (
                                                    <button key={val} onClick={() => onStationProgressUpdate(job.id, 'press', val)} disabled={saving}
                                                        className={`flex-1 py-1 rounded text-[9px] font-bold transition-all border
                                                        ${pressPct === val ? 'bg-orange-600/30 text-orange-300 border-orange-600/50' : 'bg-[#111] text-[#666] border-[#333] hover:text-white hover:border-[#555]'}
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

                        {/* ── ROBOT STATION ── */}
                        <div className="bg-[#1a1a1a] border border-cyan-600/40 rounded-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-cyan-900/40 to-[#1a1a1a] px-4 py-2.5 flex items-center justify-between border-b border-cyan-700/30">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">🤖</span>
                                    <span className="text-sm font-bold uppercase tracking-wider text-cyan-300 font-serif">Robot Station</span>
                                </div>
                                <span className="bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">{robotJobs.length}</span>
                            </div>
                            <div className="p-3 space-y-2">
                                {robotJobs.length === 0 ? (
                                    <p className="text-xs text-[#555] text-center py-6 font-mono">No jobs in Robot</p>
                                ) : robotJobs.map(job => {
                                    const robotPct = job.weldingStationProgress?.robot ?? 0;
                                    const saving = savingProgress === job.id;
                                    return (
                                        <div key={job.id} className="bg-[#222] rounded border border-[#333] p-3">
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-mono font-bold text-white">{job.id}</span>
                                                    <span className="text-[10px] text-slate-400 truncate">{job.name}</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {saving && <Loader2 className="w-2.5 h-2.5 text-cyan-400 animate-spin" />}
                                                    <span className={`text-xs font-mono font-bold ${robotPct >= 100 ? 'text-emerald-400' : robotPct > 0 ? 'text-cyan-400' : 'text-[#555]'}`}>{robotPct}%</span>
                                                </div>
                                            </div>
                                            {job.description && <p className="text-[9px] text-[#666] mb-1.5 truncate">{job.description}</p>}
                                            {/* Show press progress as reference */}
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="text-[8px] text-orange-400/70 font-bold uppercase">Press</span>
                                                <div className="flex-1 h-1 bg-[#0a0a0a] rounded-sm overflow-hidden">
                                                    <div className="h-full bg-orange-500/60" style={{ width: `${job.weldingStationProgress?.press ?? 0}%` }} />
                                                </div>
                                                <span className="text-[8px] text-orange-400/60 font-mono">{job.weldingStationProgress?.press ?? 0}%</span>
                                            </div>
                                            <div className="h-2 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-2">
                                                <div className={`h-full transition-all duration-500 ${robotPct >= 100 ? 'bg-emerald-600' : 'bg-cyan-500'}`} style={{ width: `${robotPct}%` }} />
                                            </div>
                                            <div className="flex gap-1">
                                                {[0, 25, 50, 75, 100].map(val => (
                                                    <button key={val} onClick={() => onStationProgressUpdate(job.id, 'robot', val)} disabled={saving}
                                                        className={`flex-1 py-1 rounded text-[9px] font-bold transition-all border
                                                        ${robotPct === val ? 'bg-cyan-600/30 text-cyan-300 border-cyan-600/50' : 'bg-[#111] text-[#666] border-[#333] hover:text-white hover:border-[#555]'}
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

                        {/* ── FRAME WORKERS ── */}
                        {frameWorkerJobs.length > 0 && (
                            <div className="bg-[#1a1a1a] border border-violet-600/40 rounded-lg overflow-hidden">
                                <div className="bg-gradient-to-r from-violet-900/40 to-[#1a1a1a] px-4 py-2.5 flex items-center justify-between border-b border-violet-700/30">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">🖼️</span>
                                        <span className="text-sm font-bold uppercase tracking-wider text-violet-300 font-serif">Frame Jobs</span>
                                    </div>
                                    <span className="bg-violet-900/50 text-violet-300 border border-violet-700/50 px-2 py-0.5 rounded text-xs font-mono font-bold">{frameWorkerJobs.length}</span>
                                </div>
                                <div className="p-3">
                                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                                        {roster.map(worker => {
                                            const workerFrameJobs = frameWorkerJobs.filter(j => j.assignedWorkers?.[department]?.includes(worker.name));
                                            if (workerFrameJobs.length === 0) return null;
                                            return <WorkerColumn key={worker.name} worker={worker} jobs={workerFrameJobs} department={department} />;
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-3 grid gap-3"
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                        {rosterLoading ? (
                            <div className="flex items-center justify-center w-full"><Loader2 className="w-6 h-6 text-[#555] animate-spin" /></div>
                        ) : roster.length === 0 ? (
                            <div className="flex flex-col items-center justify-center w-full text-[#555]">
                                <Users className="w-12 h-12 mb-4 opacity-30" />
                                <p className="text-sm font-mono uppercase tracking-wider">No workers in roster</p>
                                <p className="text-xs text-[#444] mt-2">Click &quot;Manage Roster&quot; to add workers</p>
                            </div>
                        ) : (
                            roster.map(worker => (
                                <WorkerColumn key={worker.name} worker={worker} jobs={getWorkerJobs(worker.name)} department={department} />
                            ))
                        )}
                    </div>
                )
            }
        </div >
    );
}


// ─────────────────────────────────────────────────────────────────
// JOB QUEUE CARD
// ─────────────────────────────────────────────────────────────────

function JobQueueCard({ job, department, rosterNames, onAssign, onUnassign, onProgressUpdate, isSaving, isAssigning, onSetAssigning, hasAlert, onReportIssue, inBatchGroup, batchAccentColor }: {
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
}) {
    const assignedWorkers = job.assignedWorkers?.[department] || [];
    const isActive = assignedWorkers.length > 0;
    const progress = job.departmentProgress?.[department] ?? 0;
    const dueDate = new Date(job.dueDate);
    const isOverdue = dueDate < new Date();
    const productColor = PRODUCT_TYPE_COLORS[job.productType] || PRODUCT_TYPE_COLORS.FAB;

    return (
        <div className={`bg-gradient-to-b from-[#222] to-[#1c1c1c] border rounded-lg transition-all relative
            ${hasAlert ? 'border-rose-800/60' : isActive ? 'border-emerald-800/50' : 'border-[#333]'}
            ${inBatchGroup ? 'border-l-[3px]' : ''}`}
            style={inBatchGroup && batchAccentColor ? { borderLeftColor: batchAccentColor } : undefined}>
            {/* Product type color bar */}
            <div className="h-1.5 w-full rounded-t-lg"
                style={{ backgroundColor: job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6' }} />

            <div className="p-4">
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            {/* BIGGER WO Number */}
                            <span className="text-sm font-mono font-bold text-white">{job.id}</span>
                            {/* Product type badge */}
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${productColor.bg} ${productColor.text} border ${productColor.border}`}>
                                {productColor.label}
                            </span>
                            {isActive && (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-emerald-600/20 text-emerald-300 border border-emerald-700/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                                </span>
                            )}
                            {hasAlert && (
                                <span className="text-[8px] font-bold text-rose-400 px-1.5 py-0.5 rounded bg-rose-900/30 border border-rose-800 flex items-center gap-1">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Blocked
                                </span>
                            )}
                        </div>
                        <h4 className="text-[12px] text-slate-300 font-medium truncate">{job.name}</h4>
                    </div>
                    <div className="shrink-0 flex items-start gap-1.5">
                        {/* Report Issue button */}
                        <button
                            onClick={() => onReportIssue(job.id)}
                            title="Report Issue"
                            className="p-1.5 rounded border border-[#333] text-[#666] hover:text-rose-400 hover:border-rose-700/50 hover:bg-rose-900/20 transition-all"
                        >
                            <AlertTriangle className="w-3.5 h-3.5" />
                        </button>
                        <div className="text-right">
                            <div className="px-1.5 py-0.5 rounded bg-[#111] border border-[#333] shadow-inner inline-block">
                                <span className="text-sky-400 text-xs font-mono font-bold">{job.weldingPoints}</span>
                                <span className="text-[8px] text-[#666] ml-0.5">pt</span>
                            </div>
                            <div className={`text-[9px] font-mono mt-0.5 ${isOverdue ? 'text-rose-400' : 'text-[#666]'}`}>
                                {dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* PO Status */}
                {(job.openPOs || job.closedPOs) && (
                    <div className="flex items-center gap-1.5 mb-2">
                        {job.openPOs && !job.closedPOs && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-orange-900/30 text-orange-300 border border-orange-700/40">
                                <Package className="w-3 h-3" /> Open
                            </span>
                        )}
                        {job.openPOs && job.closedPOs && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-yellow-900/30 text-yellow-300 border border-yellow-700/40">
                                <Package className="w-3 h-3" /> Partial
                            </span>
                        )}
                        {!job.openPOs && job.closedPOs && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-900/30 text-emerald-300 border border-emerald-700/40">
                                <Check className="w-3 h-3" /> Received
                            </span>
                        )}
                    </div>
                )}

                {/* Part Description */}
                {job.description && (
                    <div className="mb-2 px-2 py-1.5 rounded bg-[#111] border border-[#2a2a2a]">
                        <span className="text-[8px] text-[#555] uppercase tracking-wider font-bold block mb-0.5">Part</span>
                        <p className="text-[11px] text-slate-200 font-medium leading-tight" title={job.description}>{job.description}</p>
                    </div>
                )}

                {/* Assigned Workers */}
                {assignedWorkers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                        {assignedWorkers.map(w => (
                            <span key={w} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-900/30 text-sky-300 border border-sky-700/30 text-[10px] font-bold">
                                {w}
                                <button onClick={() => onUnassign(job.id, w)} className="text-sky-500 hover:text-rose-400 transition-colors">
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

                {/* Progress (only show when active) */}
                {isActive && (
                    <div className="pt-2 border-t border-[#333]/50">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] text-[#666] font-bold uppercase tracking-wider">Progress</span>
                            <div className="flex items-center gap-1">
                                {isSaving && <Loader2 className="w-2.5 h-2.5 text-sky-400 animate-spin" />}
                                <span className={`text-xs font-mono font-bold ${progress >= 100 ? 'text-emerald-400' : progress > 0 ? 'text-sky-400' : 'text-[#555]'}`}>{progress}%</span>
                            </div>
                        </div>
                        <div className="h-2 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden mb-2">
                            <div className={`h-full transition-all duration-500 ${progress >= 100 ? 'bg-emerald-600' : 'bg-sky-600'}`} style={{ width: `${progress}%` }} />
                        </div>
                        <div className="flex gap-1">
                            {[0, 25, 50, 75, 100].map(val => (
                                <button key={val} onClick={() => onProgressUpdate(job.id, val)} disabled={isSaving}
                                    className={`flex-1 py-1 rounded text-[9px] font-bold transition-all border
                                        ${progress === val ? 'bg-sky-600/30 text-sky-300 border-sky-600/50' : 'bg-[#111] text-[#666] border-[#333] hover:text-white hover:border-[#555]'}
                                        ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {val}%
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// WORKER EDIT POPUP
// ─────────────────────────────────────────────────────────────────

// Suggested qualifications — users can also add custom ones
const SUGGESTED_QUALIFICATIONS = [
    'TIG Welding', 'MIG Welding', 'Stick Welding',
    'Blueprint Reading', 'Forklift Certified', 'Crane Operator',
    'Laser Cutting', 'Press Brake', 'Shear',
    'Assembly', 'Grinding', 'Layout',
    'Paint Prep', 'Quality Check', 'Lead Hand',
];

function WorkerEditPopup({ worker, onSave, onClose }: {
    worker: WorkerProfile;
    onSave: (updated: WorkerProfile) => void;
    onClose: () => void;
}) {
    const [selectedQuals, setSelectedQuals] = useState<string[]>(worker.qualifications || worker.strengths || []);
    const [comments, setComments] = useState(worker.comments || worker.notes || '');
    const [customQual, setCustomQual] = useState('');

    const addQual = (q: string) => {
        const trimmed = q.trim();
        if (trimmed && !selectedQuals.includes(trimmed)) {
            setSelectedQuals(prev => [...prev, trimmed]);
        }
    };

    const removeQual = (q: string) => {
        setSelectedQuals(prev => prev.filter(x => x !== q));
    };

    const toggleQual = (q: string) => {
        selectedQuals.includes(q) ? removeQual(q) : addQual(q);
    };

    const handleAddCustom = () => {
        if (customQual.trim()) {
            addQual(customQual.trim());
            setCustomQual('');
        }
    };

    const handleSave = () => {
        onSave({
            ...worker,
            qualifications: selectedQuals,
            strengths: selectedQuals, // keep legacy field in sync
            comments,
        });
    };

    // Combine suggested + any custom ones already on the worker
    const allSuggestions = [...new Set([...SUGGESTED_QUALIFICATIONS, ...selectedQuals])];

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[#1a1a1a] border border-[#444] rounded-xl shadow-2xl w-[480px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-5 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-sky-900/40 border border-sky-700/50 flex items-center justify-center text-sky-300 font-bold text-sm">
                                {worker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white font-serif">{worker.name}</h3>
                                <p className="text-[10px] text-[#666] uppercase tracking-wider font-mono">Edit Worker Profile</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 text-[#666] hover:text-white transition-colors rounded hover:bg-[#333]">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Current Qualifications */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Check className="w-3.5 h-3.5" /> Active Qualifications
                        <span className="text-[9px] font-mono text-[#555] ml-auto">{selectedQuals.length} assigned</span>
                    </h4>
                    {selectedQuals.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {selectedQuals.map(q => (
                                <span key={q} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 shadow-[0_0_8px_rgba(52,211,153,0.15)]">
                                    ✓ {q}
                                    <button onClick={() => removeQual(q)} className="ml-0.5 text-emerald-500 hover:text-rose-400 transition-colors">
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-[#555] mb-3">No qualifications assigned yet</p>
                    )}

                    {/* Add custom qualification */}
                    <div className="flex gap-2">
                        <input
                            value={customQual}
                            onChange={e => setCustomQual(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                            placeholder="Add custom qualification..."
                            className="flex-1 bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-xs text-white placeholder-[#555] focus:border-sky-500/50 focus:outline-none"
                        />
                        <button onClick={handleAddCustom} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-xs font-bold text-white transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Suggested Qualifications */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Add</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {SUGGESTED_QUALIFICATIONS.filter(q => !selectedQuals.includes(q)).map(q => (
                            <button key={q} onClick={() => addQual(q)}
                                className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#111] text-[#666] border border-[#333] hover:text-emerald-300 hover:border-emerald-700/50 hover:bg-emerald-900/20 transition-all">
                                + {q}
                            </button>
                        ))}
                        {SUGGESTED_QUALIFICATIONS.filter(q => !selectedQuals.includes(q)).length === 0 && (
                            <p className="text-[10px] text-[#555]">All suggested qualifications assigned</p>
                        )}
                    </div>
                </div>

                {/* Comments */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5" /> Comments
                    </h4>
                    <textarea
                        value={comments}
                        onChange={e => setComments(e.target.value)}
                        placeholder="Notes about this worker..."
                        rows={3}
                        className="w-full bg-[#111] border border-[#333] rounded-lg px-4 py-3 text-sm text-white placeholder-[#555] focus:border-sky-500/50 focus:outline-none resize-none"
                    />
                </div>

                {/* Footer */}
                <div className="p-5 flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#444] text-sm text-[#888] hover:text-white hover:border-[#666] transition-all">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-bold text-white transition-colors shadow-lg">
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// ASSIGN WORKER DROPDOWN (Portal-based to avoid overflow clipping)
// ─────────────────────────────────────────────────────────────────

function AssignWorkerDropdown({ jobId, rosterNames, assignedWorkers, isAssigning, onSetAssigning, onAssign }: {
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


// ─────────────────────────────────────────────────────────────────
// WORKER COLUMN
// ─────────────────────────────────────────────────────────────────

function WorkerColumn({ worker, jobs, department }: { worker: WorkerProfile; jobs: Job[]; department: Department }) {
    const initials = worker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const totalPoints = jobs.reduce((s, j) => s + (j.weldingPoints || 0), 0);

    return (
        <div className="flex flex-col border border-[#333] rounded-lg bg-[#181818] min-h-[280px]">
            {/* Worker Header */}
            <div className="p-3 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-[10px] font-bold text-white border border-slate-500 shadow-inner">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-white truncate font-serif">{worker.name}</h4>
                        <span className="text-[9px] text-[#666] font-mono">{jobs.length} job{jobs.length !== 1 ? 's' : ''} • {Math.round(totalPoints)} pts</span>
                    </div>
                </div>
                {(worker.qualifications?.length || worker.strengths.length) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {(worker.qualifications || worker.strengths).map(s => (
                            <span key={s} className="text-[8px] px-1 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">{s}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Job Badges — colored by product type */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {jobs.length === 0 && (
                    <p className="text-[10px] text-[#444] text-center py-6 font-mono">No assignments</p>
                )}
                {jobs.map(job => {
                    const progress = job.departmentProgress?.[department] ?? 0;
                    const pc = PRODUCT_TYPE_COLORS[job.productType] || PRODUCT_TYPE_COLORS.FAB;
                    const barColor = job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6';
                    return (
                        <div key={job.id} className={`border rounded p-2.5 hover:brightness-110 transition-all ${pc.bg} ${pc.border}`}>
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <span className={`text-[11px] font-mono font-bold ${pc.text}`}>{job.id}</span>
                                <span className="text-[9px] font-mono text-[#888]">{job.weldingPoints}pt</span>
                            </div>
                            <p className="text-[11px] text-slate-200 truncate font-medium">{job.name}</p>
                            {/* Mini progress bar */}
                            <div className="mt-1.5 h-1 bg-[#0a0a0a] border border-[#333] rounded-sm overflow-hidden">
                                <div className="h-full transition-all" style={{ width: `${progress}%`, backgroundColor: barColor }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// ALERTS VIEW
// ─────────────────────────────────────────────────────────────────

function AlertsView({ alerts, allAlerts, departmentStatus }: {
    alerts: SupervisorAlert[]; allAlerts: SupervisorAlert[];
    departmentStatus: ReturnType<typeof getDepartmentStatus>;
}) {
    const totalBlocked = departmentStatus.reduce((s, d) => s + d.totalBlockedPoints, 0);
    const feed = alerts.length > 0 ? alerts : allAlerts;

    return (
        <div className="p-6 overflow-y-auto h-full space-y-6 max-w-4xl mx-auto">
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Active Alerts', value: allAlerts.length, icon: <BellRing className="w-5 h-5" />, color: 'text-sky-300' },
                    { label: 'Depts Affected', value: departmentStatus.filter(d => d.activeAlerts > 0).length, icon: <ShieldAlert className="w-5 h-5" />, color: 'text-slate-300' },
                    { label: 'Blocked Points', value: Math.round(totalBlocked), icon: <AlertTriangle className="w-5 h-5" />, color: 'text-rose-300' },
                ].map(stat => (
                    <div key={stat.label} className="bg-[#1a1a1a] rounded-lg border border-[#333] p-4">
                        <p className="text-[10px] uppercase tracking-wider text-[#666] font-bold">{stat.label}</p>
                        <div className="mt-2 flex items-end justify-between">
                            <span className={`text-3xl font-bold font-mono ${stat.color}`}>{stat.value}</span>
                            <span className="opacity-40">{stat.icon}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="space-y-3">
                {feed.length === 0 && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300 font-mono">No active delays reported.</div>}
                {feed.map(alert => (
                    <div key={alert.id} className="bg-[#1a1a1a] rounded-lg border border-[#333] p-4 hover:border-[#555] transition-colors">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-mono text-sky-300 font-bold">{alert.jobId}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#222] text-[#888] border border-[#333]">{alert.department}</span>
                            {alert.isSpecialPurchase && <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold inline-flex items-center gap-1"><Package className="w-3 h-3" /> SP</span>}
                            {alert.isCsiNotReceived && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold inline-flex items-center gap-1"><FileX2 className="w-3 h-3" /> CSI</span>}
                            {alert.isOutOfStock && <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold inline-flex items-center gap-1"><PackageX className="w-3 h-3" /> OOS</span>}
                        </div>
                        <p className="text-sm text-slate-300 truncate">{alert.jobName}</p>
                        <p className="mt-2 text-xs text-[#999] leading-relaxed">{alert.reason}</p>
                        <div className="mt-3 flex items-center justify-between text-[10px] text-[#555] font-mono">
                            <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" /> Est. {new Date(alert.estimatedResolutionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            <span>{alert.daysBlocked} business day{alert.daysBlocked === 1 ? '' : 's'}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}


// ─────────────────────────────────────────────────────────────────
// FUTURE WORK VIEW
// ─────────────────────────────────────────────────────────────────

const PULL_REASONS = [
    'Job arrived early',
    'Customer priority change',
    'Material available ahead of schedule',
    'Capacity available now',
    'Other',
] as const;

function FutureWorkView({
    jobs,
    department,
    onPullToQueue,
}: {
    jobs: Job[];
    department: Department;
    onPullToQueue: (jobId: string, reason: string) => Promise<void> | void;
}) {
    const nowMs = new Date().getTime();
    const [searchTerm, setSearchTerm] = useState('');
    const [pullingJobId, setPullingJobId] = useState<string | null>(null);
    const [selectedReason, setSelectedReason] = useState<string>(PULL_REASONS[0]);
    const [customReason, setCustomReason] = useState('');
    const [isPulling, setIsPulling] = useState(false);

    const filtered = useMemo(() => {
        if (!searchTerm.trim()) return jobs;
        const q = searchTerm.toLowerCase();
        return jobs.filter(j =>
            j.id.toLowerCase().includes(q) ||
            j.name.toLowerCase().includes(q) ||
            (j.description || '').toLowerCase().includes(q)
        );
    }, [jobs, searchTerm]);

    const handlePull = async () => {
        if (!pullingJobId) return;
        const reason = selectedReason === 'Other' ? customReason.trim() || 'Other' : selectedReason;
        setIsPulling(true);
        try {
            await onPullToQueue(pullingJobId, reason);
            setPullingJobId(null);
            setSelectedReason(PULL_REASONS[0]);
            setCustomReason('');
        } finally {
            setIsPulling(false);
        }
    };

    return (
        <div className="p-6 overflow-y-auto h-full space-y-4 max-w-4xl mx-auto">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]" />
                <input
                    type="text"
                    placeholder="Search by WO#, job name, or description..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-[#1a1a1a] border border-[#333] rounded-lg text-sm text-slate-200 placeholder-[#555] focus:outline-none focus:border-sky-600/50 focus:ring-1 focus:ring-sky-600/20 transition-all font-mono"
                />
                {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-slate-300 transition-colors">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-[#555]">
                    <Eye className="w-12 h-12 mb-4 opacity-30" />
                    {searchTerm ? (
                        <p className="text-sm font-mono uppercase tracking-wider">No jobs matching &quot;{searchTerm}&quot;</p>
                    ) : (
                        <>
                            <p className="text-sm font-mono uppercase tracking-wider">No upcoming jobs for {department}</p>
                            <p className="text-xs text-[#444] mt-2">Jobs will appear here once scheduled for this department</p>
                        </>
                    )}
                </div>
            ) : (
                <>
                    <p className="text-[11px] text-[#666] font-mono uppercase tracking-wider">
                        {filtered.length} upcoming job{filtered.length !== 1 ? 's' : ''} heading to {department}
                        {searchTerm && <span className="text-sky-500"> - filtered</span>}
                    </p>
                    {filtered.map(job => {
                        const schedule = job.departmentSchedule || job.remainingDepartmentSchedule;
                        const arrivalDate = schedule?.[department]?.start ? new Date(schedule[department].start) : null;
                        const daysUntil = arrivalDate ? Math.ceil((arrivalDate.getTime() - nowMs) / 86400000) : null;
                        const showingPull = pullingJobId === job.id;
                        return (
                            <div key={job.id} className={`bg-gradient-to-b border rounded-lg overflow-hidden transition-colors ${showingPull ? 'border-amber-600/60 from-[#222] to-[#1c1c1c]' : job.currentDepartment === department ? 'border-emerald-400 ring-2 ring-emerald-400/40 shadow-[0_0_20px_rgba(52,211,153,0.3)] from-emerald-950/30 to-[#1c1c1c]' : 'border-[#333] hover:border-[#555] from-[#222] to-[#1c1c1c]'}`}>
                                <div className="h-1 w-full" style={{ backgroundColor: job.productType === 'FAB' ? '#0ea5e9' : job.productType === 'DOORS' ? '#f59e0b' : '#8b5cf6' }} />
                                <div className="p-4 flex items-center gap-4">
                                    <div className="shrink-0 w-14 h-14 rounded bg-[#111] border border-[#333] flex flex-col items-center justify-center shadow-inner">
                                        {daysUntil !== null ? (
                                            <><span className={`text-lg font-mono font-bold ${daysUntil <= 3 ? 'text-sky-400' : 'text-slate-400'}`}>{daysUntil}</span><span className="text-[8px] text-[#666] uppercase">days</span></>
                                        ) : <span className="text-[10px] text-[#555]">TBD</span>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-[10px] font-mono font-bold text-[#666]">{job.id}</span>
                                            {job.currentDepartment === department ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 font-bold shadow-[0_0_8px_rgba(52,211,153,0.25)]">🔄 IN DEPT — Swap Available</span>
                                            ) : (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#111] border border-[#333] text-[#888]">Now: {job.currentDepartment}</span>
                                            )}
                                        </div>
                                        <h4 className="font-bold text-slate-200 text-sm font-serif truncate">{job.name}</h4>
                                        <div className="flex gap-3 mt-1 text-[10px] text-[#666] font-mono">
                                            {arrivalDate && <span>Arrives: {arrivalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                                            <span>Due: {new Date(job.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                        </div>
                                    </div>
                                    <div className="shrink-0 flex items-center gap-3">
                                        <div className="px-2 py-1 rounded bg-[#111] border border-[#333] shadow-inner">
                                            <span className="text-sky-400 text-sm font-mono font-bold">{job.weldingPoints}</span>
                                            <span className="text-[8px] text-[#666] ml-0.5">pt</span>
                                        </div>
                                        <button
                                            onClick={() => setPullingJobId(showingPull ? null : job.id)}
                                            title="Pull to today's queue"
                                            className={`p-2 rounded-lg border transition-all text-xs font-bold ${showingPull ? 'bg-amber-600/20 border-amber-600/50 text-amber-400' : 'border-[#444] text-[#666] hover:text-amber-400 hover:border-amber-600/40 hover:bg-amber-900/20'}`}
                                        >
                                            <ArrowDownToLine className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {showingPull && (
                                    <div className="px-4 pb-4 pt-1 border-t border-amber-800/30 bg-amber-950/20">
                                        <div className="flex items-center gap-2 mb-2">
                                            <ArrowDownToLine className="w-3.5 h-3.5 text-amber-400" />
                                            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Pull to {department} Queue</span>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap gap-1.5">
                                                {PULL_REASONS.map(reason => (
                                                    <button
                                                        key={reason}
                                                        onClick={() => { setSelectedReason(reason); if (reason !== 'Other') setCustomReason(''); }}
                                                        className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-all ${selectedReason === reason ? 'bg-amber-600/30 text-amber-300 border-amber-600/50' : 'bg-[#111] text-[#888] border-[#333] hover:border-[#555] hover:text-slate-200'}`}
                                                    >
                                                        {reason}
                                                    </button>
                                                ))}
                                            </div>
                                            {selectedReason === 'Other' && (
                                                <input
                                                    type="text"
                                                    placeholder="Describe reason..."
                                                    value={customReason}
                                                    onChange={e => setCustomReason(e.target.value)}
                                                    className="w-full px-3 py-1.5 bg-[#111] border border-[#333] rounded text-[11px] text-slate-200 placeholder-[#555] focus:outline-none focus:border-amber-600/50"
                                                    autoFocus
                                                />
                                            )}
                                            <div className="flex gap-2 pt-1">
                                                <button
                                                    onClick={handlePull}
                                                    disabled={isPulling || (selectedReason === 'Other' && !customReason.trim())}
                                                    className="flex-1 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                                                >
                                                    {isPulling ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                                                    {isPulling ? 'Pulling...' : 'Confirm Pull'}
                                                </button>
                                                <button
                                                    onClick={() => setPullingJobId(null)}
                                                    className="px-3 py-1.5 rounded border border-[#444] text-[#888] text-[10px] font-bold uppercase hover:text-slate-200 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}
