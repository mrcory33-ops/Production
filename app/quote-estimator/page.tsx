'use client';

import { useEffect, useState } from 'react';
import { Job } from '@/types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import QuoteEstimator from '@/components/QuoteEstimator';

const toDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
};

export default function QuoteEstimatorPage() {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const jobsSnapshot = await getDocs(collection(db, 'jobs'));
                const jobsData = jobsSnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                    createdAt: toDate(doc.data().createdAt) || new Date(),
                    updatedAt: toDate(doc.data().updatedAt) || new Date(),
                    dueDate: toDate(doc.data().dueDate) || new Date(),
                    schedule: doc.data().schedule || {},
                })) as unknown as Job[];

                setJobs(jobsData);
            } catch (error) {
                console.error('Error fetching jobs:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchJobs();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-700 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-slate-400">Loading current schedule...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-700 py-8">
            <QuoteEstimator existingJobs={jobs} />
        </div>
    );
}
