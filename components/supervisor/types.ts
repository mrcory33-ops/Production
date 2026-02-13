import { Department, Job, SupervisorAlert, WeldingSubStage } from '@/types';

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export type NavView = 'plan' | 'alerts' | 'future';

export interface WorkerProfile {
    name: string;
    strengths: string[];  // legacy field
    qualifications?: string[];  // e.g. ["TIG Welding", "Blueprint Reading", "Forklift Certified"]
    comments?: string;
    notes?: string;
    position?: number;  // display order (lower = first)
}

export type ProductFilter = 'ALL' | 'FAB' | 'DOORS' | 'HARMONIC';

// CrewDeck-specific department slots (splits Engineering into 2 sub-teams)
export type SupervisorScheduleSlot = Department | 'Engineering F/H' | 'Engineering D';

export const SUPERVISOR_SCHEDULE_SLOTS: { label: string; slot: SupervisorScheduleSlot; dept: Department }[] = [
    { label: 'Engineering F/H', slot: 'Engineering F/H', dept: 'Engineering' },
    { label: 'Engineering D', slot: 'Engineering D', dept: 'Engineering' },
    { label: 'Laser', slot: 'Laser', dept: 'Laser' },
    { label: 'Press Brake', slot: 'Press Brake', dept: 'Press Brake' },
    { label: 'Welding', slot: 'Welding', dept: 'Welding' },
    { label: 'Polishing', slot: 'Polishing', dept: 'Polishing' },
    { label: 'Assembly', slot: 'Assembly', dept: 'Assembly' },
];

export const getSlotDept = (slot: SupervisorScheduleSlot): Department =>
    SUPERVISOR_SCHEDULE_SLOTS.find(s => s.slot === slot)?.dept || slot as Department;

// Product type color mapping
export const PRODUCT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
    FAB: { bg: 'bg-sky-900/40', text: 'text-sky-300', border: 'border-sky-700/50', label: 'FAB' },
    DOORS: { bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-700/50', label: 'DOORS' },
    HARMONIC: { bg: 'bg-violet-900/40', text: 'text-violet-300', border: 'border-violet-700/50', label: 'HARMONIC' },
};

// ─────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────

export const toDate = (value: unknown): Date | null => {
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
export const normalizeScheduleDates = (
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

// ─────────────────────────────────────────────────────────────────
// SHARED PROP TYPES — used by department views
// ─────────────────────────────────────────────────────────────────

export interface DeptViewProps {
    jobs: Job[];
    department: Department;
    selectedSlot: SupervisorScheduleSlot;
    roster: WorkerProfile[];
    rosterLoading: boolean;
    showAddWorker: boolean;
    newWorkerName: string;
    onNewWorkerNameChange: (v: string) => void;
    onAddWorker: () => void;
    onRemoveWorker: (p: WorkerProfile) => void;
    onSetShowAddWorker: (v: boolean) => void;
    onEditWorker: (w: WorkerProfile) => void;
    editingWorker: WorkerProfile | null;
    onUpdateWorkerProfile: (old: WorkerProfile, updated: WorkerProfile) => void;
    onCancelEditWorker: () => void;
    onAssignWorker: (jobId: string, worker: string) => void;
    onUnassignWorker: (jobId: string, worker: string) => void;
    onProgressUpdate: (jobId: string, pct: number) => void;
    onStationProgressUpdate: (jobId: string, stage: WeldingSubStage, pct: number) => void;
    onAssignToPress: (jobId: string) => void;
    onRemoveFromPress: (jobId: string) => void;
    savingProgress: string | null;
    assigningJob: string | null;
    onSetAssigningJob: (v: string | null) => void;
    alerts: SupervisorAlert[];
    onReportIssue: (jobId: string) => void;
    onWorkerPositionChange: (worker: WorkerProfile, position: number) => void;
    onOpenPODetails?: (job: Job) => void;
}
