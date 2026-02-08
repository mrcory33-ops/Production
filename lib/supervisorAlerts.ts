import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    increment,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
    type QueryDocumentSnapshot,
    type DocumentData
} from 'firebase/firestore';
import { db } from './firebase';
import { AlertAdjustmentStrategy, Department, DepartmentLiveStatus, Job, SupervisorAlert } from '@/types';

const supervisorAlertsCollection = collection(db, 'supervisorAlerts');

const ALL_DEPARTMENTS: Department[] = [
    'Engineering',
    'Laser',
    'Press Brake',
    'Welding',
    'Polishing',
    'Assembly'
];

const toIsoString = (value: unknown, fallback: string): string => {
    if (!value) return fallback;

    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object' && value !== null) {
        const maybeTimestamp = value as { toDate?: () => Date };
        if (typeof maybeTimestamp.toDate === 'function') {
            const parsed = maybeTimestamp.toDate();
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return fallback;
    return parsed.toISOString();
};

const toStartOfDayIso = (value: string | Date): string => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    parsed.setHours(0, 0, 0, 0);
    return parsed.toISOString();
};

const calculateBusinessDaysUntil = (resolutionIso: string, from: Date = new Date()): number => {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(resolutionIso);
    end.setHours(0, 0, 0, 0);

    if (Number.isNaN(end.getTime()) || end <= start) return 0;

    let days = 0;
    const cursor = new Date(start);
    while (cursor < end) {
        cursor.setDate(cursor.getDate() + 1);
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) days++;
    }
    return days;
};

const normalizeAlertDoc = (docSnap: QueryDocumentSnapshot<DocumentData>): SupervisorAlert => {
    const data = docSnap.data();
    const nowIso = new Date().toISOString();
    const estimatedResolutionDate = toIsoString(data.estimatedResolutionDate, nowIso);
    const createdAt = toIsoString(data.createdAt, nowIso);
    const updatedAt = toIsoString(data.updatedAt, createdAt);
    const resolvedAt = data.resolvedAt ? toIsoString(data.resolvedAt, updatedAt) : undefined;
    const status = data.status === 'resolved' ? 'resolved' : 'active';
    const daysBlocked = typeof data.daysBlocked === 'number'
        ? data.daysBlocked
        : calculateBusinessDaysUntil(estimatedResolutionDate);
    const adjustmentCount = typeof data.adjustmentCount === 'number' ? data.adjustmentCount : undefined;
    const lastAdjustmentAt = data.lastAdjustmentAt ? toIsoString(data.lastAdjustmentAt, updatedAt) : undefined;
    const lastAdjustmentSelectedStartDate = data.lastAdjustmentSelectedStartDate
        ? toIsoString(data.lastAdjustmentSelectedStartDate, updatedAt)
        : undefined;
    const lastAdjustmentStrategy =
        data.lastAdjustmentStrategy === 'direct' ||
            data.lastAdjustmentStrategy === 'move_jobs' ||
            data.lastAdjustmentStrategy === 'ot'
            ? data.lastAdjustmentStrategy
            : undefined;
    const lastAdjustmentReason = typeof data.lastAdjustmentReason === 'string'
        ? data.lastAdjustmentReason
        : undefined;
    const lastAdjustmentMovedJobIds = Array.isArray(data.lastAdjustmentMovedJobIds)
        ? data.lastAdjustmentMovedJobIds.map((id: unknown) => String(id))
        : undefined;
    const lastAdjustmentOtSummary = typeof data.lastAdjustmentOtSummary === 'string'
        ? data.lastAdjustmentOtSummary
        : undefined;
    const additionalJobIds = Array.isArray(data.additionalJobIds)
        ? data.additionalJobIds.map((id: unknown) => String(id))
        : undefined;
    const additionalJobNames = Array.isArray(data.additionalJobNames)
        ? data.additionalJobNames.map((n: unknown) => String(n))
        : undefined;

    return {
        id: docSnap.id,
        jobId: String(data.jobId || ''),
        department: (data.department || 'Engineering') as Department,
        reason: String(data.reason || ''),
        estimatedResolutionDate,
        additionalJobIds,
        additionalJobNames,
        jobName: String(data.jobName || 'Unknown Job'),
        salesOrder: data.salesOrder ? String(data.salesOrder) : undefined,
        status,
        reportedBy: String(data.reportedBy || 'Supervisor'),
        daysBlocked,
        createdAt,
        updatedAt,
        resolvedAt,
        adjustmentCount,
        lastAdjustmentAt,
        lastAdjustmentSelectedStartDate,
        lastAdjustmentStrategy,
        lastAdjustmentReason,
        lastAdjustmentMovedJobIds,
        lastAdjustmentOtSummary
    };
};

export interface CreateAlertInput {
    jobId: string;
    department: Department;
    reason: string;
    estimatedResolutionDate: string | Date;
    jobName: string;
    salesOrder?: string;
    reportedBy: string;
    additionalJobIds?: string[];
    additionalJobNames?: string[];
}

export interface UpdateAlertInput {
    reason?: string;
    estimatedResolutionDate?: string | Date;
    reportedBy?: string;
}

export interface RecordAlertAdjustmentInput {
    selectedStartDate: string | Date;
    strategy: AlertAdjustmentStrategy;
    reason: string;
    movedJobIds: string[];
    otSummary?: string;
}

export const createAlert = async (data: CreateAlertInput): Promise<SupervisorAlert> => {
    const ref = doc(supervisorAlertsCollection);
    const nowIso = new Date().toISOString();
    const estimatedResolutionDate = toStartOfDayIso(data.estimatedResolutionDate);

    const alert: SupervisorAlert = {
        id: ref.id,
        jobId: data.jobId,
        department: data.department,
        reason: data.reason.trim(),
        estimatedResolutionDate,
        additionalJobIds: data.additionalJobIds?.length ? data.additionalJobIds : undefined,
        additionalJobNames: data.additionalJobNames?.length ? data.additionalJobNames : undefined,
        jobName: data.jobName,
        salesOrder: data.salesOrder,
        status: 'active',
        reportedBy: data.reportedBy.trim(),
        daysBlocked: calculateBusinessDaysUntil(estimatedResolutionDate),
        createdAt: nowIso,
        updatedAt: nowIso
    };

    await setDoc(ref, alert);
    return alert;
};

export const updateAlert = async (id: string, data: UpdateAlertInput): Promise<void> => {
    const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString()
    };

    if (typeof data.reason === 'string') patch.reason = data.reason.trim();
    if (typeof data.reportedBy === 'string') patch.reportedBy = data.reportedBy.trim();
    if (data.estimatedResolutionDate) {
        const estimatedResolutionDate = toStartOfDayIso(data.estimatedResolutionDate);
        patch.estimatedResolutionDate = estimatedResolutionDate;
        patch.daysBlocked = calculateBusinessDaysUntil(estimatedResolutionDate);
    }

    await updateDoc(doc(supervisorAlertsCollection, id), patch);
};

export const resolveAlert = async (id: string): Promise<void> => {
    const nowIso = new Date().toISOString();
    await updateDoc(doc(supervisorAlertsCollection, id), {
        status: 'resolved',
        resolvedAt: nowIso,
        updatedAt: nowIso,
        daysBlocked: 0
    });
};

export const deleteAlert = async (id: string): Promise<void> => {
    await deleteDoc(doc(supervisorAlertsCollection, id));
};

export const extendAlert = async (id: string, newDate: string | Date): Promise<void> => {
    const estimatedResolutionDate = toStartOfDayIso(newDate);
    await updateDoc(doc(supervisorAlertsCollection, id), {
        estimatedResolutionDate,
        daysBlocked: calculateBusinessDaysUntil(estimatedResolutionDate),
        updatedAt: new Date().toISOString()
    });
};

export const recordAlertAdjustment = async (
    id: string,
    data: RecordAlertAdjustmentInput
): Promise<void> => {
    const nowIso = new Date().toISOString();
    await updateDoc(doc(supervisorAlertsCollection, id), {
        adjustmentCount: increment(1),
        lastAdjustmentAt: nowIso,
        lastAdjustmentSelectedStartDate: toStartOfDayIso(data.selectedStartDate),
        lastAdjustmentStrategy: data.strategy,
        lastAdjustmentReason: data.reason,
        lastAdjustmentMovedJobIds: data.movedJobIds,
        lastAdjustmentOtSummary: data.otSummary || '',
        updatedAt: nowIso
    });
};

export const subscribeToAlerts = (callback: (alerts: SupervisorAlert[]) => void): (() => void) => {
    const q = query(supervisorAlertsCollection, orderBy('createdAt', 'desc'));

    return onSnapshot(q, (snapshot) => {
        const alerts = snapshot.docs.map(normalizeAlertDoc).map((alert) => {
            if (alert.status === 'active') {
                return {
                    ...alert,
                    daysBlocked: calculateBusinessDaysUntil(alert.estimatedResolutionDate)
                };
            }
            return alert;
        });
        callback(alerts);
    });
};

export const getActiveAlerts = async (): Promise<SupervisorAlert[]> => {
    const q = query(
        supervisorAlertsCollection,
        where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(normalizeAlertDoc).map((alert) => ({
        ...alert,
        daysBlocked: calculateBusinessDaysUntil(alert.estimatedResolutionDate)
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const getDepartmentStatus = (
    alerts: SupervisorAlert[],
    jobs: Job[]
): DepartmentLiveStatus[] => {
    const activeAlerts = alerts.filter((alert) => alert.status === 'active');
    const jobsById = new Map<string, Job>();
    for (const job of jobs) jobsById.set(job.id, job);

    return ALL_DEPARTMENTS.map((department) => {
        const deptAlerts = activeAlerts.filter((alert) => alert.department === department);
        const allJobIds = deptAlerts.flatMap((alert) => [alert.jobId, ...(alert.additionalJobIds || [])]);
        const blockedJobs = Array.from(new Set(allJobIds));

        let totalBlockedPoints = 0;
        for (const jobId of blockedJobs) {
            totalBlockedPoints += jobsById.get(jobId)?.weldingPoints || 0;
        }

        let topIssue: string | undefined;
        if (deptAlerts.length > 0) {
            const reasonCounts = new Map<string, number>();
            for (const alert of deptAlerts) {
                const key = alert.reason.trim() || 'General delay';
                reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
            }

            const mostCommon = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            topIssue = mostCommon?.[0];
        }

        return {
            department,
            activeAlerts: deptAlerts.length,
            blockedJobs,
            totalBlockedPoints: Math.round(totalBlockedPoints),
            topIssue
        };
    });
};
