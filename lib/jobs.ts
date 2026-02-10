import { db } from './firebase';
import { scheduleAllJobs, trackJobProgress } from './scheduler';
import { collection, doc, writeBatch, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Job, ScheduleInsights } from '@/types';
import { DEPT_ORDER } from './departmentConfig';

// Collection reference
const jobsCollection = collection(db, 'jobs');

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
    existingJobs.forEach(csvJob => {
        const previousJob = existingJobsMap.get(csvJob.id);
        if (previousJob) {
            // Preserve schedule, track progress
            const trackedJob = trackJobProgress(csvJob, previousJob);

            // Build remaining schedule: strip departments the job has already completed
            const currentDeptIndex = DEPT_ORDER.indexOf(trackedJob.currentDepartment);
            const fullSchedule = previousJob.departmentSchedule;
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
    });

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

    // Define a union type for operations
    type BatchOp =
        | { type: 'set'; data: Job }
        | { type: 'update'; id: string; data: { status: string; updatedAt: Date } };

    const allOps: BatchOp[] = [
        ...jobsToSave.map(job => ({ type: 'set' as const, data: job })),
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
