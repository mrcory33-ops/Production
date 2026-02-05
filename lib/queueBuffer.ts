import { Department, Job } from '@/types';
import { calculateQueueBuffer, DEPARTMENTS } from './scheduler';

// Queue Buffer Configuration
const QUEUE_BUFFER_DAYS = 2; // Target: 2-day work buffer per department

// Queue Buffer Status Type
export interface QueueBufferStatus {
    department: Department;
    daysQueued: number;
    targetDays: number;
    status: 'healthy' | 'warning' | 'critical';
    percentage: number;
}

/**
 * Get queue buffer status for all departments with health indicators
 * 
 * @param jobs - Scheduled jobs
 * @param fromDate - Date to start measuring from (default: today)
 * @returns Array of buffer status for each department
 */
export const getQueueBufferStatus = (
    jobs: Job[],
    fromDate: Date = new Date()
): QueueBufferStatus[] => {
    const queueDepth = calculateQueueBuffer(jobs, fromDate);
    const targetDays = QUEUE_BUFFER_DAYS;

    return DEPARTMENTS.map((dept: Department) => {
        const daysQueued = queueDepth[dept];
        const percentage = (daysQueued / targetDays) * 100;

        let status: 'healthy' | 'warning' | 'critical';
        if (daysQueued >= targetDays) {
            status = 'healthy';
        } else if (daysQueued >= targetDays * 0.5) {
            status = 'warning';
        } else {
            status = 'critical';
        }

        return {
            department: dept,
            daysQueued,
            targetDays,
            status,
            percentage
        };
    });
};
