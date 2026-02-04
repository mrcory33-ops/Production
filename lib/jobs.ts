import { db } from './firebase';
import { scheduleAllJobs, trackJobProgress } from './scheduler';
import { collection, doc, writeBatch, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Job } from '@/types';

// Collection reference
const jobsCollection = collection(db, 'jobs');

/**
 * Synchronizes the mapped jobs from CSV with Firestore.
 * Strategy:
 * 1. Fetch existing jobs from Firestore
 * 2. Identify NEW jobs (schedule with capacity-aware algorithm)
 * 3. Identify EXISTING jobs (preserve schedule, track progress)
 * 4. Identify COMPLETED jobs (missing from CSV)
 * 5. Batch write all updates
 */
export const syncJobsInput = async (parsedJobs: Job[]): Promise<{ added: number; updated: number; completed: number }> => {
    const batch = writeBatch(db);
    const CHUNK_SIZE = 450; // Firestore batch limit is 500, keeping it safe
    let operationCount = 0;

    let addedCount = 0;
    let updatedCount = 0;
    let completedCount = 0;

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
    if (newJobs.length > 0) {
        console.log("Scheduling new jobs with capacity-aware algorithm...");
        const existingJobsArray = Array.from(existingJobsMap.values());
        scheduledNewJobs = scheduleAllJobs(newJobs, existingJobsArray);
        addedCount = scheduledNewJobs.length;
    }

    // 4. Track progress for EXISTING jobs (preserve their schedules)
    const updatedExistingJobs: Job[] = [];
    existingJobs.forEach(csvJob => {
        const previousJob = existingJobsMap.get(csvJob.id);
        if (previousJob) {
            // Preserve schedule, track progress
            const trackedJob = trackJobProgress(csvJob, previousJob);
            updatedExistingJobs.push({
                ...trackedJob,
                // PRESERVE existing schedule fields
                scheduledStartDate: previousJob.scheduledStartDate,
                scheduledEndDate: previousJob.scheduledEndDate,
                departmentSchedule: previousJob.departmentSchedule,
                scheduledDepartmentByDate: previousJob.scheduledDepartmentByDate,
                isOverdue: previousJob.isOverdue,
                schedulingConflict: previousJob.schedulingConflict,
            });
            updatedCount++;
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

    console.log(`Sync Analysis: ${scheduledNewJobs.length + updatedExistingJobs.length} to save, ${idsToComplete.length} to close. `);

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
                newBatch.set(ref, op.data, { merge: true });
            } else {
                const ref = doc(jobsCollection, op.id);
                newBatch.update(ref, op.data);
            }
        });

        await newBatch.commit();
        console.log(`Committed batch ${Math.ceil(i / CHUNK_SIZE) + 1}`);
    }

    return { added: addedCount, updated: updatedCount, completed: completedCount };
};

