import { db } from './firebase';
import { scheduleJobs } from './scheduler';
import { collection, doc, writeBatch, getDocs, query, where, Timestamp } from 'firebase/firestore';
import { Job } from '@/types';

// Collection reference
const jobsCollection = collection(db, 'jobs');

/**
 * Synchronizes the mapped jobs from CSV with Firestore.
 * Strategy:
 * 1. Batch write new/updated jobs from CSV.
 * 2. Identify jobs in Firestore that are NOT in the CSV (but were previously Active) and mark them COMPLETED.
 */
export const syncJobsInput = async (parsedJobs: Job[]): Promise<{ added: number; updated: number; completed: number }> => {
    const batch = writeBatch(db);
    const CHUNK_SIZE = 450; // Firestore batch limit is 500, keeping it safe
    let operationCount = 0;

    let addedCount = 0;
    let updatedCount = 0;
    let completedCount = 0;

    // 1. Prepare Writes (Upsert)
    const csvJobIds = new Set<string>();

    // We need to fetch existing jobs to know if we are adding or updating (for stats only, Firestore set with merge handles logic)
    // For exact counts, we can just assume 'set' is fine. 
    // But to detect "missing", we MUST fetch current active jobs.

    console.log("Fetching existing active jobs...");
    const activeJobsQuery = query(jobsCollection, where("status", "in", ["PENDING", "IN_PROGRESS", "HOLD"]));
    const snapshot = await getDocs(activeJobsQuery);
    const existingActiveJobIds = new Set<string>();
    snapshot.forEach((doc: any) => existingActiveJobIds.add(doc.id));

    // Arrays to hold operations
    const jobsToSave: Job[] = [];
    const idsToComplete: string[] = [];

    // A. Process Input Jobs
    // Run Scheduling Algorithm
    console.log("Running Scheduling Algorithm...");
    const scheduledJobs = scheduleJobs(parsedJobs);

    scheduledJobs.forEach(job => {
        csvJobIds.add(job.id);
        jobsToSave.push(job);

        if (existingActiveJobIds.has(job.id)) {
            updatedCount++;
        } else {
            addedCount++;
        }
    });

    // B. Identify Missing Jobs (To Mark Complete)
    existingActiveJobIds.forEach(id => {
        if (!csvJobIds.has(id)) {
            idsToComplete.push(id);
            completedCount++;
        }
    });

    console.log(`Sync Analysis: ${jobsToSave.length} to save, ${idsToComplete.length} to close.`);

    // Execute Batches
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
