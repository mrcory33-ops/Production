import { db } from './firebase';
import { scheduleAllJobs, trackJobProgress, alignBatchCohorts } from './scheduler';
import { collection, doc, writeBatch, getDocs, query, where, Timestamp, setDoc } from 'firebase/firestore';
import { JCSJobDocument, JCSJobSummary, Job, ScheduleInsights } from '@/types';
import { DEPT_ORDER } from './departmentConfig';
import { ENABLE_JCS_STRICT_STALE_CLEANUP } from './featureFlags';

// Collection reference
const jobsCollection = collection(db, 'jobs');
const jcsComponentsCollection = collection(db, 'jcs_components');
const jcsImportsCollection = collection(db, 'jcs_imports');
const ACTIVE_JOB_STATUSES: Job['status'][] = ['PENDING', 'IN_PROGRESS', 'HOLD'];
const JCS_FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;

const removeUndefined = (value: any): any => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (value instanceof Date) return value;
    if (Array.isArray(value)) {
        return value.map(item => removeUndefined(item)).filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        Object.entries(value).forEach(([key, val]) => {
            const cleaned = removeUndefined(val);
            if (cleaned !== undefined) {
                result[key] = cleaned;
            }
        });
        return result;
    }
    return value;
};

/**
 * Synchronizes the mapped jobs from CSV with Firestore.
 * Strategy:
 * 1. Fetch existing jobs from Firestore
 * 2. Identify NEW jobs (schedule with capacity-aware algorithm)
 * 3. Identify EXISTING jobs (preserve schedule, track progress)
 * 4. Identify COMPLETED jobs (missing from CSV)
 * 5. Batch write all updates
 */
export const syncJobsInput = async (parsedJobs: Job[]): Promise<{
    added: number;
    updated: number;
    completed: number;
    dueDateChanged: Job[];  // Jobs with due date changes needing reschedule
    ahead: Job[];           // Jobs that jumped ahead of schedule
    insights: ScheduleInsights | null; // Schedule analysis from the pipeline
}> => {
    const CHUNK_SIZE = 450; // Firestore batch limit is 500, keeping it safe

    let addedCount = 0;
    let updatedCount = 0;
    let completedCount = 0;
    const dueDateChangedJobs: Job[] = [];
    const aheadJobs: Job[] = [];

    // 1. Fetch existing active jobs
    console.log("Fetching existing active jobs...");
    const activeJobsQuery = query(jobsCollection, where("status", "in", ["PENDING", "IN_PROGRESS", "HOLD"]));
    const snapshot = await getDocs(activeJobsQuery);

    const existingJobsMap = new Map<string, Job>();
    snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        existingJobsMap.set(docSnap.id, {
            ...data,
            dueDate: data.dueDate instanceof Timestamp ? data.dueDate.toDate() : new Date(data.dueDate),
            updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(data.updatedAt),
            scheduledStartDate: data.scheduledStartDate instanceof Timestamp ? data.scheduledStartDate.toDate() : data.scheduledStartDate ? new Date(data.scheduledStartDate) : undefined,
            lastDepartmentChange: data.lastDepartmentChange instanceof Timestamp ? data.lastDepartmentChange.toDate() : data.lastDepartmentChange ? new Date(data.lastDepartmentChange) : undefined,
            previousDueDate: data.previousDueDate instanceof Timestamp ? data.previousDueDate.toDate() : data.previousDueDate ? new Date(data.previousDueDate) : undefined,
        } as Job);
    });

    // 2. Separate NEW jobs from EXISTING jobs
    const newJobs: Job[] = [];
    const existingJobs: Job[] = [];
    const csvJobIds = new Set<string>();

    parsedJobs.forEach(job => {
        csvJobIds.add(job.id);
        if (existingJobsMap.has(job.id)) {
            existingJobs.push(job);
        } else {
            newJobs.push(job);
        }
    });

    console.log(`Analysis: ${newJobs.length} new jobs, ${existingJobs.length} existing jobs`);

    // 3. Schedule NEW jobs only (with capacity awareness)
    let scheduledNewJobs: Job[] = [];
    let scheduleInsights: ScheduleInsights | null = null;
    if (newJobs.length > 0) {
        console.log("Scheduling new jobs with capacity-aware algorithm...");
        const existingJobsArray = Array.from(existingJobsMap.values());
        const result = scheduleAllJobs(newJobs, existingJobsArray);
        scheduledNewJobs = result.jobs;
        scheduleInsights = result.insights;
        addedCount = scheduledNewJobs.length;
    }

    // 4. Track progress for EXISTING jobs (preserve their schedules)
    const updatedExistingJobs: Job[] = [];
    const jobsNeedingReschedule: Job[] = []; // Jobs that moved backward and need fresh schedules
    existingJobs.forEach(csvJob => {
        const previousJob = existingJobsMap.get(csvJob.id);
        if (previousJob) {
            // Preserve schedule, track progress
            const trackedJob = trackJobProgress(csvJob, previousJob);

            // Detect backward department movement (job sent back to earlier dept)
            const prevDeptIndex = DEPT_ORDER.indexOf(previousJob.currentDepartment);
            const newDeptIndex = DEPT_ORDER.indexOf(trackedJob.currentDepartment);
            const movedBackward = prevDeptIndex >= 0 && newDeptIndex >= 0 && newDeptIndex < prevDeptIndex;

            // Also check if current dept is earlier than earliest scheduled dept
            const fullSchedule = previousJob.departmentSchedule;
            let earliestScheduledIndex = Infinity;
            if (fullSchedule) {
                for (const dept of Object.keys(fullSchedule)) {
                    const idx = DEPT_ORDER.indexOf(dept as any);
                    if (idx >= 0 && idx < earliestScheduledIndex) earliestScheduledIndex = idx;
                }
            }
            const deptBeforeSchedule = newDeptIndex >= 0 && earliestScheduledIndex !== Infinity && newDeptIndex < earliestScheduledIndex;

            if (movedBackward || deptBeforeSchedule) {
                // Job moved backward — needs a completely fresh schedule
                console.log(`🔄 Job ${csvJob.id} moved backward: ${previousJob.currentDepartment} → ${trackedJob.currentDepartment}. Rescheduling.`);
                jobsNeedingReschedule.push(trackedJob);
            } else {
                // Build remaining schedule: strip departments the job has already completed
                const currentDeptIndex = DEPT_ORDER.indexOf(trackedJob.currentDepartment);
                let remainingSchedule = previousJob.remainingDepartmentSchedule;

                if (fullSchedule && currentDeptIndex >= 0) {
                    const remaining: Record<string, { start: string; end: string }> = {};
                    for (const [dept, window] of Object.entries(fullSchedule)) {
                        const deptIndex = DEPT_ORDER.indexOf(dept as any);
                        // Keep current department and all future departments
                        if (deptIndex >= currentDeptIndex) {
                            remaining[dept] = window;
                        }
                    }
                    if (Object.keys(remaining).length > 0) {
                        remainingSchedule = remaining;
                    }
                }

                const updatedJob = {
                    ...trackedJob,
                    // PRESERVE existing schedule fields
                    scheduledStartDate: previousJob.scheduledStartDate,
                    scheduledEndDate: previousJob.scheduledEndDate,
                    departmentSchedule: previousJob.departmentSchedule,
                    remainingDepartmentSchedule: remainingSchedule,
                    scheduledDepartmentByDate: previousJob.scheduledDepartmentByDate,
                    isOverdue: previousJob.isOverdue,
                    schedulingConflict: previousJob.schedulingConflict,
                };

                updatedExistingJobs.push(updatedJob);
                updatedCount++;

                // Collect jobs with special conditions for user notification
                if (trackedJob.dueDateChanged && trackedJob.needsReschedule) {
                    dueDateChangedJobs.push(updatedJob);
                }
                if (trackedJob.progressStatus === 'AHEAD') {
                    aheadJobs.push(updatedJob);
                }
            }
        }
    });

    // 4b. Reschedule jobs that moved backward (treat as new jobs for scheduling)
    if (jobsNeedingReschedule.length > 0) {
        console.log(`Rescheduling ${jobsNeedingReschedule.length} jobs that moved backward...`);
        const allKnownJobs = [...Array.from(existingJobsMap.values()), ...updatedExistingJobs];
        const rescheduled = scheduleAllJobs(jobsNeedingReschedule, allKnownJobs);
        scheduledNewJobs = [...scheduledNewJobs, ...rescheduled.jobs];
        addedCount += 0; // Don't count as "added" — they're existing jobs being rescheduled
        updatedCount += rescheduled.jobs.length;
    }

    // 5. Identify COMPLETED jobs (missing from CSV)
    const idsToComplete: string[] = [];
    existingJobsMap.forEach((job, id) => {
        if (!csvJobIds.has(id)) {
            idsToComplete.push(id);
            completedCount++;
        }
    });

    console.log(`Sync Analysis: ${scheduledNewJobs.length + updatedExistingJobs.length} to save, ${idsToComplete.length} to close.`);
    console.log(`📅 Due date changes: ${dueDateChangedJobs.length}, 🚀 Ahead of schedule: ${aheadJobs.length}`);

    // 6. Execute Batches
    const jobsToSave = [...scheduledNewJobs, ...updatedExistingJobs];
    const alignedJobsToSave = alignBatchCohorts(jobsToSave);

    // Define a union type for operations
    type BatchOp =
        | { type: 'set'; data: Job }
        | { type: 'update'; id: string; data: { status: string; updatedAt: Date } };

    const allOps: BatchOp[] = [
        ...alignedJobsToSave.map(job => ({ type: 'set' as const, data: job })),
        ...idsToComplete.map(id => ({ type: 'update' as const, id, data: { status: 'COMPLETED', updatedAt: new Date() } }))
    ];

    for (let i = 0; i < allOps.length; i += CHUNK_SIZE) {
        const chunk = allOps.slice(i, i + CHUNK_SIZE);
        const newBatch = writeBatch(db);

        chunk.forEach(op => {
            if (op.type === 'set') {
                const ref = doc(jobsCollection, op.data.id);
                const cleaned = removeUndefined(op.data);
                newBatch.set(ref, cleaned, { merge: true });
            } else {
                const ref = doc(jobsCollection, op.id);
                const cleaned = removeUndefined(op.data);
                newBatch.update(ref, cleaned);
            }
        });

        await newBatch.commit();
        console.log(`Committed batch ${Math.ceil(i / CHUNK_SIZE) + 1}`);
    }

    return {
        added: addedCount,
        updated: updatedCount,
        completed: completedCount,
        dueDateChanged: dueDateChangedJobs,
        ahead: aheadJobs,
        insights: scheduleInsights
    };
};

const toMillis = (value: unknown): number | null => {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof (value as any)?.toDate === 'function') {
        const parsed = (value as any).toDate();
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed.getTime();
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

type BatchOp =
    | { type: 'set'; ref: any; data: Record<string, any>; merge?: boolean }
    | { type: 'update'; ref: any; data: Record<string, any> };

const commitInChunks = async (ops: BatchOp[], chunkSize = 450) => {
    for (let i = 0; i < ops.length; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach((op) => {
            const cleaned = removeUndefined(op.data);
            if (op.type === 'set') {
                batch.set(op.ref, cleaned, { merge: op.merge ?? false });
            } else {
                batch.update(op.ref, cleaned);
            }
        });
        await batch.commit();
    }
};

export const syncJCSData = async (
    summaries: JCSJobSummary[],
    options?: { allowAutoClearStale?: boolean }
): Promise<{
    importId: string;
    upsertedJobs: number;
    staleDocsMarked: number;
    jobsMarkedStale: number;
    jobsAutoCleared: number;
    unmatchedJobIds: string[];
}> => {
    if (!summaries.length) {
        throw new Error('JCS sync requires at least one parsed job summary.');
    }

    const importId = doc(jcsImportsCollection).id;
    const importRef = doc(jcsImportsCollection, importId);
    const now = new Date();
    const nowIso = now.toISOString();
    const allowAutoClearStale = options?.allowAutoClearStale === true && ENABLE_JCS_STRICT_STALE_CLEANUP;

    await setDoc(importRef, {
        status: 'running',
        source: 'upload-jcs',
        startedAt: nowIso,
        totalSummaries: summaries.length,
        allowAutoClearStaleRequested: options?.allowAutoClearStale === true,
        allowAutoClearStaleEffective: allowAutoClearStale,
    });

    try {
        // Active jobs are the only ones we mutate for stale flags in v1.
        const activeJobsSnap = await getDocs(query(jobsCollection, where('status', 'in', ACTIVE_JOB_STATUSES)));
        const activeJobsMeta = new Map<string, { missingCount: number }>();
        activeJobsSnap.forEach((snap) => {
            const data = snap.data() as Partial<Job>;
            activeJobsMeta.set(snap.id, {
                missingCount: typeof data.jcsMissingImportCount === 'number' ? data.jcsMissingImportCount : 0,
            });
        });

        // Look up latest successful import age to guard strict cleanup.
        const importHistorySnap = await getDocs(jcsImportsCollection);
        let latestSuccessMs: number | null = null;
        importHistorySnap.forEach((snap) => {
            const data = snap.data() as any;
            if (data.status !== 'success') return;
            const ts = toMillis(data.completedAt || data.finishedAt || data.startedAt);
            if (ts === null) return;
            latestSuccessMs = latestSuccessMs === null ? ts : Math.max(latestSuccessMs, ts);
        });
        const latestImportFresh = latestSuccessMs === null ? true : (now.getTime() - latestSuccessMs) <= JCS_FRESHNESS_WINDOW_MS;

        const existingJcsDocs = await getDocs(jcsComponentsCollection);
        const seenJobIds = new Set<string>();
        const unmatchedJobIds: string[] = [];
        const ops: BatchOp[] = [];

        // Upsert latest parsed summaries
        summaries.forEach((summary) => {
            seenJobIds.add(summary.jobId);

            const jcsDoc: JCSJobDocument = {
                jobId: summary.jobId,
                project: summary.project,
                codeSort: summary.codeSort,
                components: summary.components,
                poSummary: summary.poSummary,
                counts: {
                    totalPOs: summary.totalPOs,
                    receivedPOs: summary.receivedPOs,
                    openPOs: summary.openPOs,
                    overduePOs: summary.overduePOs,
                },
                lastSeenImportId: importId,
                importedAt: nowIso,
                stale: false,
            };

            ops.push({
                type: 'set',
                ref: doc(jcsComponentsCollection, summary.jobId),
                data: jcsDoc,
                merge: true,
            });

            if (activeJobsMeta.has(summary.jobId)) {
                ops.push({
                    type: 'set',
                    ref: doc(jobsCollection, summary.jobId),
                    data: {
                        openPOs: summary.hasOpenPOs,
                        closedPOs: summary.hasClosedPOs,
                        jcsLastUpdated: now,
                        jcsDataState: 'live',
                        jcsLastSeenImportId: importId,
                        jcsMissingImportCount: 0,
                        updatedAt: now,
                    },
                    merge: true,
                });
            } else {
                unmatchedJobIds.push(summary.jobId);
            }
        });

        let staleDocsMarked = 0;
        let jobsMarkedStale = 0;
        let jobsAutoCleared = 0;

        // Mark stale docs not present in this import.
        existingJcsDocs.forEach((snap) => {
            const jobId = snap.id;
            if (seenJobIds.has(jobId)) return;

            staleDocsMarked += 1;
            ops.push({
                type: 'set',
                ref: doc(jcsComponentsCollection, jobId),
                data: {
                    stale: true,
                    staleSince: nowIso,
                },
                merge: true,
            });

            const existingJob = activeJobsMeta.get(jobId);
            if (!existingJob) return;

            jobsMarkedStale += 1;
            const nextMissingCount = existingJob.missingCount + 1;

            const shouldAutoClear =
                allowAutoClearStale &&
                latestImportFresh &&
                nextMissingCount >= 2;

            if (shouldAutoClear) {
                jobsAutoCleared += 1;
                ops.push({
                    type: 'set',
                    ref: doc(jobsCollection, jobId),
                    data: {
                        openPOs: false,
                        closedPOs: false,
                        jcsDataState: 'none',
                        jcsMissingImportCount: 0,
                        updatedAt: now,
                    },
                    merge: true,
                });
                return;
            }

            ops.push({
                type: 'set',
                ref: doc(jobsCollection, jobId),
                data: {
                    jcsDataState: 'stale',
                    jcsMissingImportCount: nextMissingCount,
                    updatedAt: now,
                },
                merge: true,
            });
        });

        await commitInChunks(ops);

        await setDoc(importRef, {
            status: 'success',
            completedAt: new Date().toISOString(),
            upsertedJobs: summaries.length,
            staleDocsMarked,
            jobsMarkedStale,
            jobsAutoCleared,
            unmatchedJobIds,
            latestImportFresh,
        }, { merge: true });

        return {
            importId,
            upsertedJobs: summaries.length,
            staleDocsMarked,
            jobsMarkedStale,
            jobsAutoCleared,
            unmatchedJobIds,
        };
    } catch (error: any) {
        await setDoc(importRef, {
            status: 'failed',
            failedAt: new Date().toISOString(),
            error: String(error?.message || error),
        }, { merge: true });
        throw error;
    }
};
