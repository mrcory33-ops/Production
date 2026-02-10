'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, writeBatch, onSnapshot, Timestamp, deleteField, type WriteBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Job, Department, ScheduleInsights, SupervisorAlert } from '@/types';
import {
    applyRemainingSchedule,
    scheduleJobs,
    scheduleAllJobs,
    addWorkDays,
    subtractWorkDays,
    planAlertAdjustment,
    suggestReschedule,
    RescheduleSuggestion
} from '@/lib/scheduler';
import { DEPARTMENT_CONFIG, PRODUCT_TYPE_ICONS, DEPT_ORDER } from '@/lib/departmentConfig';
import { addDays, differenceInCalendarDays, format, startOfDay, differenceInDays } from 'date-fns';
import { AlertTriangle, Calendar, Filter, Maximize, Minimize, Activity, Upload, Trash2, FileDown, SlidersHorizontal, Calculator, MessageSquareWarning, Bell, ShieldAlert, CheckSquare } from 'lucide-react';
import Link from 'next/link';
import CustomGanttTable from './CustomGanttTable';
import DepartmentAnalyticsPanel from './DepartmentAnalyticsPanel';
import ExportModal from './export/ExportModal';
import ScoringConfigPanel from './ScoringConfigPanel';
import ScheduleInsightsPanel from './ScheduleInsightsPanel';
import AlertManagementPanel from './AlertManagementPanel';
import RescheduleSuggestionPopover from './RescheduleSuggestionPopover';
import CompletedJobsPanel from './CompletedJobsPanel';
import { calculateUrgencyScore } from '@/lib/scoring';
import { deleteAlert, extendAlert, recordAlertAdjustment, resolveAlert, subscribeToAlerts, updateAlert } from '@/lib/supervisorAlerts';



const toDate = (value: any): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeSchedule = (
    schedule?: Record<string, { start: any; end: any }>
): Record<string, { start: string; end: string }> | undefined => {
    if (!schedule) return undefined;
    const normalized: Record<string, { start: string; end: string }> = {};
    Object.entries(schedule).forEach(([dept, dates]) => {
        const start = toDate((dates as any).start);
        const end = toDate((dates as any).end);
        if (!start || !end) return;
        normalized[dept] = { start: start.toISOString(), end: end.toISOString() };
    });
    return Object.keys(normalized).length ? normalized : undefined;
};

const scaleSchedule = (
    schedule: Record<string, { start: string; end: string }>,
    newStart: Date,
    newEnd: Date
) => {
    const entries = Object.entries(schedule)
        .map(([dept, dates]) => ({
            dept,
            start: startOfDay(new Date(dates.start)),
            end: startOfDay(new Date(dates.end))
        }))
        .filter(entry => !isNaN(entry.start.getTime()) && !isNaN(entry.end.getTime()))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (!entries.length) return {};

    const totalDays = Math.max(1, differenceInCalendarDays(newEnd, newStart) + 1);
    const deptCount = entries.length;

    const updated: Record<string, { start: string; end: string }> = {};

    if (totalDays < deptCount) {
        // Not enough days: overlap departments by mapping multiple to the same day
        entries.forEach((entry, idx) => {
            const dayIndex = Math.floor((idx * totalDays) / deptCount);
            const day = addDays(newStart, dayIndex);
            updated[entry.dept] = { start: day.toISOString(), end: day.toISOString() };
        });
        return updated;
    }

    // Enough days: give each dept at least 1 day, distribute remaining by original proportions
    const originalDurations = entries.map(e => Math.max(1, differenceInCalendarDays(e.end, e.start) + 1));
    const totalOriginal = originalDurations.reduce((sum, d) => sum + d, 0);
    const baseDays = new Array(deptCount).fill(1);
    const remaining = totalDays - deptCount;

    if (remaining > 0) {
        const weighted = originalDurations.map(d => (d / totalOriginal) * remaining);
        const extra = weighted.map(w => Math.floor(w));
        const extraUsed = extra.reduce((sum, d) => sum + d, 0);

        // Distribute leftover days by largest fractional remainder
        const remainders = weighted.map((w, i) => ({ i, r: w - extra[i] }))
            .sort((a, b) => b.r - a.r);
        let leftover = remaining - extraUsed;
        let idx = 0;
        while (leftover > 0) {
            extra[remainders[idx].i] += 1;
            leftover--;
            idx = (idx + 1) % remainders.length;
        }

        for (let i = 0; i < deptCount; i++) {
            baseDays[i] += extra[i];
        }
    }

    let cursor = new Date(newStart);
    entries.forEach((entry, i) => {
        const start = new Date(cursor);
        const end = addDays(start, baseDays[i] - 1);
        updated[entry.dept] = { start: start.toISOString(), end: end.toISOString() };
        cursor = addDays(end, 1);
    });

    return updated;
};

const shiftScheduleDates = (
    schedule: Record<string, { start: string; end: string }> | undefined,
    deltaDays: number
) => {
    if (!schedule) return undefined;
    const updated: Record<string, { start: string; end: string }> = {};
    Object.entries(schedule).forEach(([dept, dates]) => {
        const s = new Date(dates.start);
        const e = new Date(dates.end);

        if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            const start = startOfDay(addDays(s, deltaDays));
            const end = startOfDay(addDays(e, deltaDays));
            updated[dept] = { start: start.toISOString(), end: end.toISOString() };
        }
    });
    return updated;
};

const shiftScheduleByWorkdayDelta = (
    schedule: Record<string, { start: string; end: string }> | undefined,
    deltaWorkDays: number
) => {
    if (!schedule) return undefined;
    if (deltaWorkDays === 0) return { ...schedule };

    const updated: Record<string, { start: string; end: string }> = {};
    Object.entries(schedule).forEach(([dept, dates]) => {
        const s = startOfDay(new Date(dates.start));
        const e = startOfDay(new Date(dates.end));
        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;

        const start = deltaWorkDays >= 0
            ? addWorkDays(s, deltaWorkDays)
            : subtractWorkDays(s, Math.abs(deltaWorkDays));
        const end = deltaWorkDays >= 0
            ? addWorkDays(e, deltaWorkDays)
            : subtractWorkDays(e, Math.abs(deltaWorkDays));

        updated[dept] = { start: start.toISOString(), end: end.toISOString() };
    });

    return Object.keys(updated).length ? updated : undefined;
};

const getEarliestScheduleDate = (job: Job) => {
    const schedules = [
        job.remainingDepartmentSchedule,
        job.departmentSchedule
    ].filter(Boolean) as Record<string, { start: string; end: string }>[];

    const dates: Date[] = [];
    schedules.forEach(schedule => {
        Object.values(schedule).forEach(({ start }) => {
            const d = startOfDay(new Date(start));
            if (!isNaN(d.getTime())) dates.push(d);
        });
    });

    if (dates.length) {
        return new Date(Math.min(...dates.map(d => d.getTime())));
    }

    const fallback = job.forecastStartDate || job.scheduledStartDate || job.dueDate;
    return startOfDay(fallback);
};

const getLatestScheduleDate = (job: Job) => {
    const schedules = [
        job.remainingDepartmentSchedule,
        job.departmentSchedule
    ].filter(Boolean) as Record<string, { start: string; end: string }>[];

    const dates: Date[] = [];
    schedules.forEach(schedule => {
        Object.values(schedule).forEach(({ end }) => {
            const d = startOfDay(new Date(end));
            if (!isNaN(d.getTime())) dates.push(d);
        });
    });

    if (dates.length) {
        return new Date(Math.max(...dates.map(d => d.getTime())));
    }

    const fallback = job.forecastDueDate || job.scheduledEndDate || job.dueDate;
    return startOfDay(fallback);
};

const getSalesOrderFromWorkOrder = (workOrder?: string) => {
    if (!workOrder) return undefined;
    const digits = String(workOrder).replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(0, 5);
    return undefined;
};

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

const MIN_COL_WIDTH = 32;
const MAX_COL_WIDTH = 64;
const ZOOM_STEPS = 200;
const FIRESTORE_BATCH_CHUNK_SIZE = 450;

const commitBatchedWrites = async (mutations: Array<(batch: WriteBatch) => void>) => {
    for (let i = 0; i < mutations.length; i += FIRESTORE_BATCH_CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = mutations.slice(i, i + FIRESTORE_BATCH_CHUNK_SIZE);
        chunk.forEach((mutation) => mutation(batch));
        await batch.commit();
    }
};

export default function MasterSchedule() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(66);
    const [showSmallRocks, setShowSmallRocks] = useState(true);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);
    const [today] = useState(() => startOfDay(new Date()));
    const [visibleDepartments, setVisibleDepartments] = useState<Set<Department>>(new Set(DEPT_ORDER));
    const [splitByProductType, setSplitByProductType] = useState(false);
    const [selectedDates, setSelectedDates] = useState<Date[]>([]);
    const [showActiveOnly, setShowActiveOnly] = useState(false);
    const [selectedProductTypes, setSelectedProductTypes] = useState<Set<string>>(new Set(['FAB', 'DOORS', 'HARMONIC']));
    const [minPoints, setMinPoints] = useState<number>(1);
    const [maxPoints, setMaxPoints] = useState<number>(0); // 0 = no max
    const [dueStart, setDueStart] = useState<string>('');
    const [dueEnd, setDueEnd] = useState<string>('');
    const [dateFilterMode, setDateFilterMode] = useState<'DUE' | 'SCHEDULED'>('DUE');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
    const [priorityListIdByDept, setPriorityListIdByDept] = useState<Record<string, string>>({});
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isScoringConfigOpen, setIsScoringConfigOpen] = useState(false);
    const [scheduleInsights, setScheduleInsights] = useState<ScheduleInsights | null>(null);
    const [showInsights, setShowInsights] = useState(false);
    const [supervisorAlerts, setSupervisorAlerts] = useState<SupervisorAlert[]>([]);
    const [showAlertPanel, setShowAlertPanel] = useState(false);
    const [rescheduleSuggestion, setRescheduleSuggestion] = useState<RescheduleSuggestion | null>(null);
    const [completedJobs, setCompletedJobs] = useState<Job[]>([]);
    const [showCompletedPanel, setShowCompletedPanel] = useState(false);

    const columnWidth = useMemo(() => {
        const t = Math.min(1, Math.max(0, zoomLevel / ZOOM_STEPS));
        const eased = t * t * (3 - 2 * t); // smoothstep easing
        return Math.round(MIN_COL_WIDTH + (MAX_COL_WIDTH - MIN_COL_WIDTH) * eased);
    }, [zoomLevel]);

    // Handle segment date updates
    const handleSegmentUpdate = async (
        jobId: string,
        department: Department,
        newStart: Date,
        newEnd: Date
    ) => {
        try {
            // Find the job
            const job = jobs.find(j => j.id === jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            const normalizedStart = startOfDay(newStart);
            const normalizedEnd = startOfDay(newEnd);

            // Update both departmentSchedule and remainingDepartmentSchedule
            const updatedDepartmentSchedule = {
                ...(job.departmentSchedule || {}),
                [department]: {
                    start: normalizedStart.toISOString(),
                    end: normalizedEnd.toISOString()
                }
            };

            const baseRemainingSchedule = (() => {
                if (job.remainingDepartmentSchedule && Object.keys(job.remainingDepartmentSchedule).length > 0) {
                    return job.remainingDepartmentSchedule;
                }
                if (job.status === 'IN_PROGRESS') {
                    const computed = applyRemainingSchedule(job, today).remainingDepartmentSchedule;
                    if (computed && Object.keys(computed).length > 0) return computed;
                }
                return job.departmentSchedule || {};
            })();

            const updatedRemainingSchedule = {
                ...baseRemainingSchedule,
                [department]: {
                    start: normalizedStart.toISOString(),
                    end: normalizedEnd.toISOString()
                }
            };

            // Update in Firebase
            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, removeUndefined({
                departmentSchedule: updatedDepartmentSchedule,
                remainingDepartmentSchedule: updatedRemainingSchedule,
                updatedAt: new Date()
            }));

            // Update local state
            setJobs(prevJobs =>
                prevJobs.map(j =>
                    j.id === jobId
                        ? {
                            ...j,
                            departmentSchedule: updatedDepartmentSchedule,
                            remainingDepartmentSchedule: updatedRemainingSchedule
                        }
                        : j
                )
            );

            console.log(`✅ Updated ${department} schedule for ${job.name}: ${format(newStart, 'M/d')} - ${format(newEnd, 'M/d')}`);
        } catch (error) {
            console.error('Error updating segment:', error);
            alert('Failed to update schedule. Please try again.');
        }
    };

    const handleJobShiftUpdate = async (jobId: string, deltaDays: number) => {
        try {
            const job = jobs.find(j => j.id === jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            const shiftSchedule = (schedule?: Record<string, { start: string; end: string }>) => {
                if (!schedule) return undefined;
                const updated: Record<string, { start: string; end: string }> = {};
                Object.entries(schedule).forEach(([dept, dates]) => {
                    const start = startOfDay(addDays(new Date(dates.start), deltaDays));
                    const end = startOfDay(addDays(new Date(dates.end), deltaDays));
                    updated[dept] = { start: start.toISOString(), end: end.toISOString() };
                });
                return updated;
            };

            const updatedDepartmentSchedule = shiftSchedule(job.departmentSchedule);
            const updatedRemainingSchedule = shiftSchedule(job.remainingDepartmentSchedule);

            const allStarts = [
                ...(updatedDepartmentSchedule ? Object.values(updatedDepartmentSchedule) : []),
                ...(updatedRemainingSchedule ? Object.values(updatedRemainingSchedule) : [])
            ].map(d => new Date(d.start));

            const newScheduledStartDate = allStarts.length
                ? new Date(Math.min(...allStarts.map(d => d.getTime())))
                : job.scheduledStartDate;

            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, removeUndefined({
                departmentSchedule: updatedDepartmentSchedule || job.departmentSchedule,
                remainingDepartmentSchedule: updatedRemainingSchedule || job.remainingDepartmentSchedule,
                scheduledStartDate: newScheduledStartDate || null,
                updatedAt: new Date()
            }));

            setJobs(prevJobs =>
                prevJobs.map(j =>
                    j.id === jobId
                        ? {
                            ...j,
                            departmentSchedule: updatedDepartmentSchedule || j.departmentSchedule,
                            remainingDepartmentSchedule: updatedRemainingSchedule || j.remainingDepartmentSchedule,
                            scheduledStartDate: newScheduledStartDate || j.scheduledStartDate
                        }
                        : j
                )
            );
        } catch (error) {
            console.error('Error shifting job schedule:', error);
            alert('Failed to shift schedule. Please try again.');
        }
    };

    const handleJobRangeUpdate = async (jobId: string, newStart: Date, newEnd: Date) => {
        try {
            const job = jobs.find(j => j.id === jobId);
            if (!job) {
                console.error('Job not found:', jobId);
                return;
            }

            const baseSchedule = job.departmentSchedule || {};
            const baseRemaining = job.remainingDepartmentSchedule || baseSchedule;

            const updatedDepartmentSchedule = scaleSchedule(baseSchedule, startOfDay(newStart), startOfDay(newEnd));
            const updatedRemainingSchedule = scaleSchedule(baseRemaining, startOfDay(newStart), startOfDay(newEnd));

            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, {
                departmentSchedule: updatedDepartmentSchedule,
                remainingDepartmentSchedule: updatedRemainingSchedule,
                scheduledStartDate: startOfDay(newStart),
                forecastStartDate: startOfDay(newStart),
                forecastDueDate: startOfDay(newEnd),
                updatedAt: new Date()
            });

            setJobs(prevJobs =>
                prevJobs.map(j =>
                    j.id === jobId
                        ? {
                            ...j,
                            departmentSchedule: updatedDepartmentSchedule,
                            remainingDepartmentSchedule: updatedRemainingSchedule,
                            scheduledStartDate: startOfDay(newStart),
                            forecastStartDate: startOfDay(newStart),
                            forecastDueDate: startOfDay(newEnd)
                        }
                        : j
                )
            );
        } catch (error) {
            console.error('Error updating job range:', error);
            alert('Failed to update job range. Please try again.');
        }
    };

    const handlePriorityUpdate = async (jobId: string, dept: Department, value: number | null) => {
        try {
            const job = jobs.find(j => j.id === jobId);
            if (!job) return;

            const listId = priorityListIdByDept[dept] || new Date().toISOString();
            const nextPriority = { ...(job.priorityByDept || {}) };

            if (value === null || Number.isNaN(value)) {
                delete nextPriority[dept];
            } else {
                nextPriority[dept] = {
                    value,
                    setAt: new Date().toISOString(),
                    listId
                };
            }

            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, {
                priorityByDept: Object.keys(nextPriority).length ? nextPriority : deleteField(),
                updatedAt: new Date()
            });

            setJobs(prev =>
                prev.map(j =>
                    j.id === jobId
                        ? { ...j, priorityByDept: Object.keys(nextPriority).length ? nextPriority : undefined }
                        : j
                )
            );
        } catch (error) {
            console.error('Failed to update priority:', error);
        }
    };

    const handleNoGapsToggle = async (jobId: string, noGaps: boolean) => {
        try {
            const jobRef = doc(db, 'jobs', jobId);
            await updateDoc(jobRef, {
                noGaps,
                updatedAt: new Date()
            });

            // Update local state and re-schedule
            setJobs(prev => {
                const updated = prev.map(j =>
                    j.id === jobId ? { ...j, noGaps } : j
                );
                // Re-schedule all jobs to apply gap changes
                return scheduleAllJobs(updated).jobs;
            });
        } catch (error) {
            console.error('Failed to toggle noGaps:', error);
        }
    };

    const handleResetPriorityList = async (dept: Department) => {
        try {
            const listId = new Date().toISOString();
            setPriorityListIdByDept(prev => ({ ...prev, [dept]: listId }));

            const mutations: Array<(batch: WriteBatch) => void> = [];
            const updatedJobs: Job[] = jobs.map(job => {
                if (!job.priorityByDept?.[dept]) return job;
                const next = { ...job.priorityByDept };
                delete next[dept];
                const ref = doc(db, 'jobs', job.id);
                const priorityByDept = Object.keys(next).length ? next : deleteField();
                mutations.push((batch) => batch.update(ref, { priorityByDept }));
                return { ...job, priorityByDept: Object.keys(next).length ? next : undefined };
            });

            if (mutations.length > 0) {
                await commitBatchedWrites(mutations);
            }
            setJobs(updatedJobs);
        } catch (error) {
            console.error('Failed to reset priority list:', error);
        }
    };

    useEffect(() => {
        const handleFullScreenChange = () => {
            const isActive = document.fullscreenElement === containerRef.current;
            setIsFullScreen(isActive);
        };

        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
    }, []);

    const handleScoringSave = () => {
        // Recalculate scores for all jobs with new weights
        setJobs(prev => prev.map(job => {
            const urgency = calculateUrgencyScore(job);
            return {
                ...job,
                urgencyScore: urgency.score,
                urgencyFactors: urgency.factors
            };
        }));
    };

    const handleClearAll = async () => {
        if (!confirm('Are you sure you want to DELETE ALL displayed jobs? This cannot be undone.')) return;

        setLoading(true);
        try {
            const mutations: Array<(batch: WriteBatch) => void> = [];
            jobs.forEach(job => {
                // Safety check: only delete jobs we have IDs for
                if (!job.id) return;
                const ref = doc(db, 'jobs', job.id);
                mutations.push((batch) => batch.delete(ref));
            });

            const count = mutations.length;
            if (count > 0) {
                await commitBatchedWrites(mutations);
                setJobs([]);
                alert(`Successfully deleted ${count} jobs.`);
            }
        } catch (error) {
            console.error('Failed to clear jobs:', error);
            alert('Failed to delete jobs. See console for details.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const fetchJobs = async () => {
            try {
                const q = query(
                    collection(db, 'jobs'),
                    where('status', 'in', ['PENDING', 'IN_PROGRESS', 'HOLD'])
                );

                const snapshot = await getDocs(q);
                const fetched: Job[] = [];

                snapshot.forEach(docSnap => {
                    const data = docSnap.data() as Job;
                    const normalizedDepartmentSchedule = normalizeSchedule((data as any).departmentSchedule);
                    const normalizedRemainingSchedule = normalizeSchedule((data as any).remainingDepartmentSchedule);
                    fetched.push({
                        ...data,
                        dueDate: toDate(data.dueDate) || new Date(),
                        scheduledStartDate: toDate(data.scheduledStartDate),
                        forecastStartDate: toDate(data.forecastStartDate),
                        forecastDueDate: toDate(data.forecastDueDate),
                        previousDueDate: toDate(data.previousDueDate as any),
                        departmentSchedule: normalizedDepartmentSchedule,
                        remainingDepartmentSchedule: normalizedRemainingSchedule
                    });
                });

                // Clear stale priorities (>5 days)
                const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
                const now = Date.now();
                const staleUpdates: { id: string; updates: Record<string, any> }[] = [];

                const cleaned = fetched.map(job => {
                    // Default values
                    const jobWithDefaults = {
                        ...job,
                        productType: job.productType || 'FAB'
                    };

                    // Calculate initial urgency score
                    const urgency = calculateUrgencyScore(jobWithDefaults);
                    const jobWithScore = {
                        ...jobWithDefaults,
                        urgencyScore: urgency.score,
                        urgencyFactors: urgency.factors
                    };

                    if (!jobWithScore.priorityByDept) return jobWithScore;
                    const next = { ...jobWithScore.priorityByDept };
                    let changed = false;

                    Object.entries(next).forEach(([dept, data]) => {
                        const setAt = new Date(data.setAt).getTime();
                        if (!setAt || now - setAt > fiveDaysMs) {
                            delete next[dept as Department];
                            changed = true;
                        }
                    });

                    if (changed) {
                        staleUpdates.push({
                            id: job.id,
                            updates: { priorityByDept: Object.keys(next).length ? next : deleteField() }
                        });
                    }

                    return changed ? { ...jobWithScore, priorityByDept: Object.keys(next).length ? next : undefined } : jobWithScore;
                });

                if (staleUpdates.length) {
                    const mutations = staleUpdates.map(u => {
                        const ref = doc(db, 'jobs', u.id);
                        return (batch: WriteBatch) => batch.update(ref, u.updates);
                    });
                    await commitBatchedWrites(mutations);
                }

                setJobs(cleaned);
            } catch (err) {
                console.error('Failed to fetch jobs for planning', err);
            } finally {
                setLoading(false);
            }
        };

        fetchJobs();
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToAlerts((alerts) => {
            setSupervisorAlerts(alerts);
        });

        return () => unsubscribe();
    }, []);

    // Fetch completed jobs (last 30 days)
    useEffect(() => {
        const fetchCompleted = async () => {
            try {
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                const q = query(
                    collection(db, 'jobs'),
                    where('status', '==', 'COMPLETED'),
                    where('updatedAt', '>=', thirtyDaysAgo)
                );
                const snapshot = await getDocs(q);
                const completed: Job[] = [];
                snapshot.forEach(docSnap => {
                    const data = docSnap.data() as Job;
                    completed.push({
                        ...data,
                        dueDate: toDate(data.dueDate) || new Date(),
                        updatedAt: toDate((data as any).updatedAt) || new Date(),
                    });
                });
                // Sort by completion date descending
                completed.sort((a, b) => {
                    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                    return bTime - aTime;
                });
                setCompletedJobs(completed);
            } catch (err) {
                console.error('Failed to fetch completed jobs:', err);
            }
        };
        fetchCompleted();
    }, []);

    const activeSupervisorAlerts = useMemo(
        () => supervisorAlerts.filter(alert => alert.status === 'active'),
        [supervisorAlerts]
    );

    const alertsByJobId = useMemo(() => {
        const map: Record<string, SupervisorAlert[]> = {};
        for (const alert of activeSupervisorAlerts) {
            const allIds = [alert.jobId, ...(alert.additionalJobIds || [])];
            for (const id of allIds) {
                if (!map[id]) map[id] = [];
                map[id].push(alert);
            }
        }
        return map;
    }, [activeSupervisorAlerts]);

    const displayJobs = useMemo(() => {
        let filtered = showSmallRocks
            ? [...jobs]
            : jobs.filter(j => j.isPriority || (j.weldingPoints || 0) >= 60);

        // Filter by welding points range
        filtered = filtered.filter(j => {
            const pts = j.weldingPoints || 0;
            if (pts < minPoints) return false;
            if (maxPoints > 0 && pts > maxPoints) return false;
            return true;
        });

        // Filter by due date or scheduled range (if set)
        if (dueStart || dueEnd) {
            const start = dueStart ? startOfDay(new Date(dueStart)) : null;
            const end = dueEnd ? startOfDay(new Date(dueEnd)) : null;
            filtered = filtered.filter(j => {
                if (dateFilterMode === 'DUE') {
                    const d = startOfDay(new Date(j.dueDate));
                    if (start && d < start) return false;
                    if (end && d > end) return false;
                    return true;
                }

                const jobStart = getEarliestScheduleDate(j);
                const jobEnd = getLatestScheduleDate(j);
                if (start && jobEnd < start) return false;
                if (end && jobStart > end) return false;
                return true;
            });
        }

        // Search by job name, sales order, work order, or sales rep code
        const query = searchQuery.trim().toLowerCase();
        const queryDigits = query.replace(/\D/g, '');
        const isRepCodeQuery = /^[a-z]{2}$/.test(query);
        if (query) {
            const exactWorkOrder = jobs.find(j => String(j.id).toLowerCase() === query);
            if (exactWorkOrder) {
                filtered = filtered.filter(j => String(j.id).toLowerCase() === query);
            } else if (isRepCodeQuery) {
                filtered = filtered.filter(j => (j.salesRepCode || '').toLowerCase() === query);
            } else {
                filtered = filtered.filter(j => {
                    const name = (j.name || '').toLowerCase();
                    const workOrder = String(j.id || '').toLowerCase();
                    const salesOrder = (j.salesOrder || getSalesOrderFromWorkOrder(j.id) || '').toLowerCase();
                    const salesRepCode = (j.salesRepCode || '').toLowerCase();
                    if (queryDigits.length === 5) {
                        const woDigits = workOrder.replace(/\D/g, '');
                        if (
                            salesOrder.startsWith(queryDigits) ||
                            woDigits.startsWith(queryDigits) ||
                            salesRepCode.startsWith(queryDigits)
                        ) {
                            return true;
                        }
                    }
                    return (
                        name.includes(query) ||
                        salesOrder.includes(query) ||
                        workOrder.includes(query) ||
                        salesRepCode.includes(query)
                    );
                });
            }
        }

        // Filter by product type tabs
        if (selectedProductTypes.size > 0) {
            filtered = filtered.filter(j => selectedProductTypes.has(j.productType || 'FAB'));
        }

        // Filter by visible departments (REMOVED: Now handled by components for Pipeline View)
        // filtered = filtered.filter(job => {
        //     if (visibleDepartments.size === DEPT_ORDER.length) return true;
        //     return visibleDepartments.has(job.currentDepartment);
        // });

        return filtered
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
            .map(job => {
                if (job.remainingDepartmentSchedule) {
                    return job;
                }
                if (job.status === 'IN_PROGRESS') {
                    return applyRemainingSchedule(job, today);
                }
                return {
                    ...job,
                    forecastStartDate: job.scheduledStartDate ?? job.dueDate,
                    forecastDueDate: job.dueDate,
                    remainingDepartmentSchedule: job.departmentSchedule
                };
            });
    }, [jobs, showSmallRocks, today, selectedProductTypes, minPoints, maxPoints, dueStart, dueEnd, dateFilterMode, searchQuery]); // Removed visibleDepartments dependency

    useEffect(() => {
        if (!selectedJob) return;
        const updated = jobs.find(job => job.id === selectedJob.id);
        if (updated && updated !== selectedJob) {
            setSelectedJob(updated);
        }
    }, [jobs, selectedJob?.id]);

    useEffect(() => {
        if (!jobs.length) return;

        const cutoffDate = addDays(today, -45);
        const toShift = jobs
            .map(job => {
                const earliest = getEarliestScheduleDate(job);
                if (earliest >= cutoffDate) return null;

                const delta = differenceInDays(cutoffDate, earliest);
                if (delta <= 0) return null;

                const updatedDepartmentSchedule = shiftScheduleDates(job.departmentSchedule, delta);
                const updatedRemainingSchedule = shiftScheduleDates(job.remainingDepartmentSchedule, delta);
                const updatedForecastStart = job.forecastStartDate
                    ? addDays(startOfDay(job.forecastStartDate), delta)
                    : job.forecastStartDate;
                const updatedForecastDue = job.forecastDueDate
                    ? addDays(startOfDay(job.forecastDueDate), delta)
                    : job.forecastDueDate;
                const updatedScheduledStart = job.scheduledStartDate
                    ? addDays(startOfDay(job.scheduledStartDate), delta)
                    : job.scheduledStartDate;

                return {
                    jobId: job.id,
                    updates: {
                        departmentSchedule: updatedDepartmentSchedule || job.departmentSchedule,
                        remainingDepartmentSchedule: updatedRemainingSchedule || job.remainingDepartmentSchedule,
                        forecastStartDate: updatedForecastStart || null,
                        forecastDueDate: updatedForecastDue || null,
                        scheduledStartDate: updatedScheduledStart || null,
                        updatedAt: new Date()
                    }
                };
            })
            .filter(Boolean) as { jobId: string; updates: Record<string, any> }[];

        if (!toShift.length) return;

        const run = async () => {
            try {
                const shiftedByJobId = new Map<string, Record<string, any>>();
                const mutations = toShift.map(item => {
                    shiftedByJobId.set(item.jobId, item.updates);
                    const ref = doc(db, 'jobs', item.jobId);
                    const updates = removeUndefined(item.updates);
                    return (batch: WriteBatch) => batch.update(ref, updates);
                });
                await commitBatchedWrites(mutations);

                setJobs(prev =>
                    prev.map(job => {
                        const match = shiftedByJobId.get(job.id);
                        return match ? { ...job, ...match } : job;
                    })
                );
            } catch (error) {
                console.error('Failed to shift past jobs forward', error);
            }
        };

        run();
    }, [jobs, today]);

    // Calculate date range for chart
    const chartDateRange = useMemo(() => {
        const minStart = addDays(today, -7);
        if (!displayJobs.length) {
            return {
                startDate: minStart,
                endDate: addDays(today, 30)
            };
        }

        let earliest = today;
        let latest = addDays(today, 30);

        displayJobs.forEach(job => {
            // Use schedule windows so the chart always reflects actual segment dates.
            const jobStart = getEarliestScheduleDate(job);
            const jobEnd = getLatestScheduleDate(job);

            if (jobStart < earliest) earliest = jobStart;
            if (jobEnd > latest) latest = jobEnd;
        });

        // Add buffer
        return {
            startDate: addDays(earliest, -3) < minStart ? minStart : addDays(earliest, -3),
            endDate: addDays(latest, 7)
        };
    }, [displayJobs, today]);

    const handleToggleFullScreen = async () => {
        const container = containerRef.current;
        if (!container) return;

        const nextFullScreen = !isFullScreen;
        setIsFullScreen(nextFullScreen);

        if (nextFullScreen) {
            if (container.requestFullscreen) {
                try {
                    await container.requestFullscreen();
                } catch (err) {
                    console.warn('Fullscreen request failed', err);
                }
            }
        } else if (document.fullscreenElement) {
            try {
                await document.exitFullscreen();
            } catch (err) {
                console.warn('Exit fullscreen failed', err);
            }
        }
    };

    if (loading) {
        return <div className="text-cyan-500 animate-pulse">Loading Planning Board...</div>;
    }

    // Empty state check - if no displayJobs, we'll show empty message inside the full UI layout
    const hasJobs = displayJobs.length > 0;

    return (
        <div ref={containerRef} className="h-screen flex flex-col bg-slate-100 overflow-hidden text-slate-900">
            {/* Unified Tactile Control Deck */}
            <div className="w-full bg-slate-50 border-b border-slate-300 shadow-md z-20 shrink-0">
                <div className="max-w-[2400px] mx-auto p-2 space-y-2">

                    {/* Top Deck: Navigation & Scope */}
                    <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-sm flex items-center justify-between gap-4">

                        {/* Identity Island + Product Types */}
                        <div className="flex items-center gap-4 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-100">
                            <div className="flex items-center gap-3">
                                <h1 className="text-lg font-black tracking-tight text-slate-800 uppercase flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-600 shadow-sm"></span>
                                    Master Schedule
                                </h1>
                                <div className="h-4 w-px bg-slate-300 mx-1"></div>
                                <button
                                    onClick={() => setIsScoringConfigOpen(true)}
                                    className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-200 rounded-md transition-all active:scale-95"
                                    title="Configure Urgency Scoring"
                                >
                                    <SlidersHorizontal size={16} strokeWidth={2.5} />
                                </button>
                            </div>

                            <div className="h-6 w-px bg-slate-300"></div>

                            {/* Product Types (Embedded) */}
                            <div className="flex items-center gap-1">
                                {[
                                    { key: 'FAB', label: 'FAB' },
                                    { key: 'DOORS', label: 'Doors' },
                                    { key: 'HARMONIC', label: 'Harmonic' }
                                ].map(t => {
                                    const isSelected = selectedProductTypes.has(t.key);
                                    return (
                                        <button
                                            key={t.key}
                                            onClick={() => {
                                                const next = new Set(selectedProductTypes);
                                                if (next.has(t.key)) next.delete(t.key);
                                                else next.add(t.key);
                                                if (next.size === 0) setSelectedProductTypes(new Set(['FAB', 'DOORS', 'HARMONIC']));
                                                else setSelectedProductTypes(next);
                                            }}
                                            className={`px-3 py-1.5 text-[11px] font-bold rounded-md border transition-all ${isSelected
                                                ? 'bg-slate-800 border-slate-800 text-white shadow-md'
                                                : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 shadow-sm'
                                                }`}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Center Control Well: Departments + View Mode */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border-inner shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
                            {DEPT_ORDER.map(dept => {
                                const isVisible = visibleDepartments.has(dept);
                                return (
                                    <button
                                        key={dept}
                                        onClick={() => {
                                            const newSet = new Set(visibleDepartments);
                                            if (newSet.has(dept)) newSet.delete(dept);
                                            else newSet.add(dept);
                                            setVisibleDepartments(newSet);
                                        }}
                                        className={`px-3 py-1.5 text-[11px] font-black rounded-md border transition-all ${isVisible
                                            ? 'bg-black border-black text-white shadow-md translate-y-px'
                                            : 'bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 shadow-sm hover:shadow'
                                            }`}
                                    >
                                        {dept}
                                    </button>
                                );
                            })}

                            <div className="h-5 w-px bg-slate-300 mx-2"></div>

                            {/* View Mode Toggles */}
                            <button
                                onClick={() => setShowActiveOnly(false)}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${!showActiveOnly ? 'bg-white text-black shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                All Jobs
                            </button>
                            <button
                                onClick={() => setShowActiveOnly(true)}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${showActiveOnly ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Active
                            </button>
                        </div>
                    </div>

                    {/* Bottom Deck: Filters & Tools */}
                    <div className="flex items-center gap-2">

                        {/* Left Filter Group */}
                        <div className="flex-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm flex items-center gap-2">

                            {/* Search */}
                            <div className="relative group ml-1">
                                <span className="absolute left-2.5 top-1.5 text-slate-400"><Filter size={14} /></span>
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-8 pr-3 py-1.5 w-64 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-black focus:border-transparent transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]"
                                    placeholder="Search Job, SO, WO, or Sales Rep Code..."
                                />
                            </div>

                            <div className="h-6 w-px bg-slate-100 mx-1"></div>

                            {/* Date Filter */}
                            <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-100">
                                <button
                                    onClick={() => setDateFilterMode(dateFilterMode === 'DUE' ? 'SCHEDULED' : 'DUE')}
                                    className="px-2 py-1 text-[10px] font-black uppercase text-slate-500 hover:text-black border border-transparent hover:border-slate-200 rounded transition-all"
                                >
                                    {dateFilterMode === 'DUE' ? 'Due:' : 'Sched:'}
                                </button>
                                <input
                                    type="date"
                                    value={dueStart}
                                    onChange={(e) => setDueStart(e.target.value)}
                                    className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 w-28 shadow-sm"
                                />
                                <span className="text-slate-300 font-bold">-</span>
                                <input
                                    type="date"
                                    value={dueEnd}
                                    onChange={(e) => setDueEnd(e.target.value)}
                                    className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 w-28 shadow-sm"
                                />
                            </div>

                            <div className="h-6 w-px bg-slate-100 mx-1"></div>

                            {/* Points & Big Rocks */}
                            <div className="flex items-center gap-2">
                                <div className="flex items-center bg-slate-50 rounded-lg px-2 py-1 border border-slate-100">
                                    <span className="text-[10px] font-bold text-slate-400 mr-2">PTS</span>
                                    <input type="number" value={minPoints} onChange={(e) => setMinPoints(Math.max(1, Number(e.target.value) || 1))} className="w-10 bg-white border border-slate-200 rounded text-center text-xs shadow-sm" />
                                    <span className="text-slate-300 mx-1">-</span>
                                    <input type="number" value={maxPoints} onChange={(e) => setMaxPoints(Math.max(0, Number(e.target.value) || 0))} className="w-10 bg-white border border-slate-200 rounded text-center text-xs shadow-sm" />
                                </div>

                                <button
                                    onClick={() => setSplitByProductType(!splitByProductType)}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${splitByProductType ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-inner' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 shadow-sm'}`}
                                >
                                    Split Prod
                                </button>

                                <button
                                    onClick={() => setShowSmallRocks(!showSmallRocks)}
                                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all ${!showSmallRocks ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-inner ring-1 ring-amber-100' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 shadow-sm'}`}
                                >
                                    Big Rocks Only
                                </button>
                            </div>

                            {/* Contextual Action: New List */}
                            {showActiveOnly && visibleDepartments.size === 1 && (
                                <button
                                    onClick={() => handleResetPriorityList(Array.from(visibleDepartments)[0])}
                                    className="ml-auto px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-bold hover:bg-emerald-100 transition-all shadow-sm"
                                >
                                    + New List
                                </button>
                            )}

                        </div>

                        {/* Right Tools Island */}
                        <div className="bg-white rounded-xl border border-slate-200 p-1 shadow-sm flex items-center gap-1.5">

                            <Link href="/upload" className="p-1.5 text-slate-600 hover:text-black hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-200 transition-all" title="Import CSV">
                                <Upload size={16} />
                            </Link>

                            <Link href="/quote-estimator" className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-all" title="What If Scheduler">
                                <Calculator size={16} />
                            </Link>

                            <Link href="/supervisor" className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-100 transition-all" title="Supervisor Schedule">
                                <ShieldAlert size={16} />
                            </Link>

                            <button
                                onClick={async () => {
                                    // Generate insights from current jobs
                                    const { analyzeScheduleFromJobs } = await import('@/lib/scheduler');
                                    const insights = analyzeScheduleFromJobs(jobs, activeSupervisorAlerts);
                                    setScheduleInsights(insights);
                                    setShowInsights(true);
                                }}
                                className={`p-1.5 rounded-lg border transition-all ${scheduleInsights && (scheduleInsights.lateJobs.length > 0 || scheduleInsights.overloadedWeeks.length > 0)
                                    ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50 border-amber-200 bg-amber-50'
                                    : 'text-slate-600 hover:text-black hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                title="Schedule Insights"
                            >
                                <MessageSquareWarning size={16} />
                            </button>

                            <button
                                onClick={() => setShowAlertPanel(true)}
                                className={`relative p-1.5 rounded-lg border transition-all ${activeSupervisorAlerts.length > 0
                                    ? 'text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 bg-rose-50'
                                    : 'text-slate-600 hover:text-black hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                title="Alert Management"
                            >
                                <Bell size={16} />
                                {activeSupervisorAlerts.length > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-4 text-center">
                                        {activeSupervisorAlerts.length > 99 ? '99+' : activeSupervisorAlerts.length}
                                    </span>
                                )}
                            </button>

                            <button
                                onClick={() => setShowCompletedPanel(true)}
                                className={`relative p-1.5 rounded-lg border transition-all ${completedJobs.length > 0
                                    ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200 bg-emerald-50'
                                    : 'text-slate-600 hover:text-black hover:bg-slate-50 border-transparent hover:border-slate-200'
                                    }`}
                                title="Completed Jobs"
                            >
                                <CheckSquare size={16} />
                                {completedJobs.length > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold leading-4 text-center">
                                        {completedJobs.length > 99 ? '99+' : completedJobs.length}
                                    </span>
                                )}
                            </button>

                            <button onClick={() => setIsExportModalOpen(true)} className="p-1.5 text-slate-600 hover:text-black hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-200 transition-all" title="Export">
                                <FileDown size={16} />
                            </button>

                            <div className="h-4 w-px bg-slate-200 mx-0.5"></div>

                            {/* Zoom */}
                            <div className="flex items-center px-2">
                                <span className="text-[9px] font-bold text-slate-400 mr-2">ZOOM</span>
                                <input
                                    type="range"
                                    min="0"
                                    max={ZOOM_STEPS}
                                    value={zoomLevel}
                                    onChange={(e) => setZoomLevel(Number(e.target.value))}
                                    className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-black"
                                />
                            </div>

                            <div className="h-4 w-px bg-slate-200 mx-0.5"></div>

                            <button onClick={handleClearAll} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all" title="Clear All">
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative">

                {/* Left Panel: Gantt Chart */}
                <div
                    className="h-full overflow-hidden flex flex-col relative"
                    style={{ paddingRight: isAnalyticsOpen ? '320px' : '0' }}
                >
                    {hasJobs ? (
                        <CustomGanttTable
                            jobs={displayJobs}
                            startDate={chartDateRange.startDate}
                            endDate={chartDateRange.endDate}
                            columnWidth={columnWidth}
                            onJobClick={setSelectedJob}
                            selectedJob={selectedJob}
                            today={today}
                            onSegmentUpdate={handleSegmentUpdate}
                            onJobShiftUpdate={handleJobShiftUpdate}
                            onJobRangeUpdate={handleJobRangeUpdate}
                            onPriorityUpdate={handlePriorityUpdate}
                            onNoGapsToggle={handleNoGapsToggle}
                            priorityDepartment={showActiveOnly && visibleDepartments.size === 1 ? Array.from(visibleDepartments)[0] : undefined}
                            visibleDepartments={visibleDepartments}
                            showActiveOnly={showActiveOnly}
                            selectedDates={selectedDates}
                            onDateSelect={setSelectedDates}
                            alertsByJobId={alertsByJobId}
                            onRescheduleRequest={(jobId) => {
                                const job = jobs.find(j => j.id === jobId);
                                if (!job) return;
                                const suggestion = suggestReschedule(job, jobs);
                                setRescheduleSuggestion(suggestion);
                            }}
                        />
                    ) : (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="text-center p-8">
                                <div className="text-6xl mb-4">📋</div>
                                <h2 className="text-xl font-semibold text-slate-700 mb-2">No Jobs Scheduled</h2>
                                <p className="text-slate-500 mb-6 max-w-md">
                                    Import a CSV file to load jobs into the production scheduler.
                                </p>
                                <a
                                    href="/upload"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
                                >
                                    <Upload className="w-4 h-4" />
                                    Import Jobs
                                </a>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Panel: Analytics (Slide-Out) — hidden when Completed Jobs panel is open */}
                {!showCompletedPanel && (
                    <>
                        <aside
                            className={`absolute top-0 right-0 z-[9999] h-full w-[320px] border-l border-slate-300 transition-transform duration-300 ${isAnalyticsOpen ? 'translate-x-0 bg-white opacity-100' : 'translate-x-[320px] bg-slate-100 opacity-100'}`}
                            style={{ isolation: 'isolate' }}
                        >
                            <div className="relative h-full overflow-hidden bg-white">
                                <div className="absolute inset-0 bg-white z-40" />
                                <div className="relative z-50 h-full">
                                    <DepartmentAnalyticsPanel
                                        jobs={displayJobs}
                                        selectedDates={selectedDates}
                                        splitByProductType={splitByProductType}
                                        visibleDepartments={visibleDepartments}
                                    />
                                </div>
                            </div>
                        </aside>

                        {/* Slide-Out Tab */}
                        <button
                            onClick={() => setIsAnalyticsOpen(!isAnalyticsOpen)}
                            className={`absolute top-1/2 -translate-y-1/2 right-0 z-[10000] h-28 w-8 rounded-l-lg border border-slate-300 bg-white text-slate-500 hover:text-blue-600 transition-all shadow-md ${isAnalyticsOpen ? 'translate-x-0' : '-translate-x-8'}`}
                            title={isAnalyticsOpen ? 'Hide Analytics' : 'Show Analytics'}
                        >
                            <span className="block text-[10px] font-semibold tracking-widest rotate-90">
                                ANALYTICS
                            </span>
                        </button>
                    </>
                )}
            </div>

            <style jsx global>{`
                .gantt .grid-header { fill: transparent; stroke: rgba(148, 163, 184, 0.3); stroke-width: 1; }
                .gantt .grid-row { fill: transparent; stroke: rgba(148, 163, 184, 0.2); stroke-width: 1; }
                .gantt .row-line { stroke: rgba(148, 163, 184, 0.2); }
                .gantt .tick { stroke: rgba(148, 163, 184, 0.2); }
                .gantt text { fill: #475569; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
                .gantt-target { background: #f8fafc; }
                .gantt-target svg { width: auto !important; min-width: 100%; }
                .gantt .bar-label { fill: #1e293b; font-size: 12px; font-weight: 500; letter-spacing: 0.2px; }
                .gantt .bar-wrapper:hover .bar-label { fill: #000; }
                .gantt .bar-label.big { display: none; }
                .gantt-performance .bar-label { display: none; }
                .gantml-performance .gantt .bar-wrapper:hover .bar-label { display: none; }
                
                /* Department Colors for Multi-Segment Bars - PRESERVED */
                .gantt .bar-wrapper.dept-engineering .bar { fill: #3b82f6; }
                .gantt .bar-wrapper.dept-laser .bar { fill: #f97316; }
                .gantt .bar-wrapper.dept-press-brake .bar { fill: #eab308; }
                .gantt .bar-wrapper.dept-welding .bar { 
                    fill: #ef4444; 
                    stroke: #dc2626; 
                    stroke-width: 2;
                    filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.2));
                }
                .gantt .bar-wrapper.dept-polishing .bar { fill: #14b8a6; }
                .gantt .bar-wrapper.dept-assembly .bar { fill: #8b5cf6; }
                .gantt .bar-wrapper.dept-shipping .bar { fill: #6b7280; }

                /* Welding heartbeat highlight - Light Mode */
                .gantt .grid-row[data-dept="Welding"] { fill: rgba(239, 68, 68, 0.02); }
                
                .gantt-container .popup-wrapper { 
                    z-index: 9999 !important; 
                    background: white !important; 
                    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1) !important; 
                    border: 1px solid #e2e8f0 !important; 
                    padding: 0 !important;
                }

                .custom-scrollbar::-webkit-scrollbar { width: 12px; height: 12px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 6px; border: 2px solid #f1f5f9; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .custom-scrollbar::-webkit-scrollbar-corner { background: #f1f5f9; }
            `}</style>
            {isExportModalOpen && (
                <ExportModal
                    jobs={displayJobs}
                    onClose={() => setIsExportModalOpen(false)}
                />
            )}

            {isScoringConfigOpen && (
                <ScoringConfigPanel
                    isOpen={isScoringConfigOpen}
                    onClose={() => setIsScoringConfigOpen(false)}
                    onSave={handleScoringSave}
                />
            )}

            {showInsights && scheduleInsights && (
                <ScheduleInsightsPanel
                    insights={scheduleInsights}
                    onClose={() => setShowInsights(false)}
                />
            )}

            {showAlertPanel && (
                <AlertManagementPanel
                    alerts={supervisorAlerts}
                    jobs={jobs}
                    onClose={() => setShowAlertPanel(false)}
                    onResolve={async (alertId) => {
                        await resolveAlert(alertId);
                    }}
                    onExtend={async (alertId, newDate) => {
                        await extendAlert(alertId, new Date(newDate));
                    }}
                    onEdit={async (alertId, update) => {
                        await updateAlert(alertId, {
                            reason: update.reason,
                            estimatedResolutionDate: update.estimatedResolutionDate
                                ? new Date(update.estimatedResolutionDate)
                                : undefined
                        });
                    }}
                    onAdjust={async (alertRecord, mode, previewDecision, overrideDate) => {
                        try {
                            // If an override date is provided, create a modified alert targeting that date
                            const effectiveAlert = overrideDate
                                ? { ...alertRecord, estimatedResolutionDate: new Date(overrideDate).toISOString() }
                                : alertRecord;

                            let decision = mode === 'apply' && previewDecision
                                ? previewDecision
                                : planAlertAdjustment(jobs, effectiveAlert);

                            if (mode === 'apply') {
                                const liveDecision = planAlertAdjustment(jobs, effectiveAlert);
                                const previewShiftCount = decision.jobShifts.filter(shift => shift.workDays !== 0).length;
                                const liveShiftCount = liveDecision.jobShifts.filter(shift => shift.workDays !== 0).length;
                                if (
                                    liveDecision.success &&
                                    (
                                        !previewDecision ||
                                        previewShiftCount === 0 ||
                                        (liveDecision.selectedStartDate || liveDecision.requestedStartDate) !==
                                        (decision.selectedStartDate || decision.requestedStartDate) ||
                                        liveShiftCount !== previewShiftCount
                                    )
                                ) {
                                    decision = liveDecision;
                                }
                            }

                            if (!decision.success) {
                                return { success: false, message: decision.reason, decision };
                            }

                            if (mode === 'preview') {
                                return { success: true, message: decision.reason, decision };
                            }

                            const actionableShifts = decision.jobShifts.filter(shift => shift.workDays !== 0);
                            if (actionableShifts.length === 0) {
                                return {
                                    success: false,
                                    message: `No schedule change to apply. ${decision.reason}`,
                                    decision
                                };
                            }

                            const updatesByJobId = new Map<string, Partial<Job>>();
                            const updateMutations: Array<(batch: WriteBatch) => void> = [];

                            for (const shift of actionableShifts) {
                                const job = jobs.find(j => j.id === shift.jobId);
                                if (!job) continue;

                                const updatedDepartmentSchedule = shiftScheduleByWorkdayDelta(job.departmentSchedule, shift.workDays);
                                const updatedRemainingSchedule = shiftScheduleByWorkdayDelta(job.remainingDepartmentSchedule, shift.workDays);

                                const activeSchedule = (updatedRemainingSchedule && Object.keys(updatedRemainingSchedule).length > 0)
                                    ? updatedRemainingSchedule
                                    : (updatedDepartmentSchedule || job.departmentSchedule || job.remainingDepartmentSchedule);

                                let nextScheduledStartDate = job.scheduledStartDate;
                                let nextForecastStartDate = job.forecastStartDate;
                                let nextForecastDueDate = job.forecastDueDate;

                                if (activeSchedule) {
                                    const starts = Object.values(activeSchedule)
                                        .map(window => startOfDay(new Date(window.start)))
                                        .filter(date => !Number.isNaN(date.getTime()));
                                    const ends = Object.values(activeSchedule)
                                        .map(window => startOfDay(new Date(window.end)))
                                        .filter(date => !Number.isNaN(date.getTime()));

                                    if (starts.length > 0) {
                                        const earliestStart = new Date(Math.min(...starts.map(date => date.getTime())));
                                        nextScheduledStartDate = earliestStart;
                                        nextForecastStartDate = earliestStart;
                                    }
                                    if (ends.length > 0) {
                                        nextForecastDueDate = new Date(Math.max(...ends.map(date => date.getTime())));
                                    }
                                }

                                const updates = removeUndefined({
                                    departmentSchedule: updatedDepartmentSchedule || job.departmentSchedule,
                                    remainingDepartmentSchedule: updatedRemainingSchedule || job.remainingDepartmentSchedule,
                                    scheduledStartDate: nextScheduledStartDate || null,
                                    forecastStartDate: nextForecastStartDate || null,
                                    forecastDueDate: nextForecastDueDate || null,
                                    updatedAt: new Date()
                                });

                                const ref = doc(db, 'jobs', job.id);
                                updateMutations.push((batch) => batch.update(ref, updates));
                                updatesByJobId.set(job.id, updates);
                            }

                            if (updatesByJobId.size > 0) {
                                await commitBatchedWrites(updateMutations);
                                setJobs(prev =>
                                    prev.map(job =>
                                        updatesByJobId.has(job.id)
                                            ? { ...job, ...(updatesByJobId.get(job.id) as Partial<Job>) }
                                            : job
                                    )
                                );
                            }

                            const otSummary = decision.otRequirements && decision.otRequirements.length > 0
                                ? decision.otRequirements
                                    .map(requirement => `${requirement.department} ${requirement.weekKey}: Tier ${requirement.requiredTier}`)
                                    .join(', ')
                                : undefined;

                            await recordAlertAdjustment(alertRecord.id, {
                                selectedStartDate: decision.selectedStartDate || decision.requestedStartDate,
                                strategy: decision.strategy || 'direct',
                                reason: decision.reason,
                                movedJobIds: actionableShifts.map(shift => shift.jobId),
                                otSummary
                            });

                            // Send email notification for Special Purchase adjustments
                            if (alertRecord.isSpecialPurchase) {
                                const primaryJob = jobs.find(j => j.id === alertRecord.jobId);
                                const primaryShift = actionableShifts.find(s => s.jobId === alertRecord.jobId);
                                const updatedJob = primaryShift ? updatesByJobId.get(primaryShift.jobId) : undefined;
                                const newForecastDue = updatedJob?.forecastDueDate
                                    || primaryJob?.forecastDueDate
                                    || primaryJob?.dueDate;

                                fetch('/api/notify-sp-adjustment', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        jobId: alertRecord.jobId,
                                        jobName: alertRecord.jobName,
                                        salesRepCode: primaryJob?.salesRepCode || '',
                                        oldDueDate: primaryJob?.dueDate ? new Date(primaryJob.dueDate).toISOString() : undefined,
                                        newDueDate: newForecastDue ? new Date(newForecastDue).toISOString() : new Date().toISOString(),
                                        reason: alertRecord.reason,
                                        daysNeededAfterPO: alertRecord.daysNeededAfterPO,
                                        adjustmentStrategy: decision.strategy
                                    })
                                }).catch(err => console.error('SP email notification failed:', err));
                            }

                            return {
                                success: true,
                                message: `${decision.reason} Applied ${actionableShifts.length} shift${actionableShifts.length > 1 ? 's' : ''}.`,
                                decision
                            };
                        } catch (error) {
                            const message = error instanceof Error ? error.message : 'Adjust apply failed.';
                            return { success: false, message };
                        }
                    }}
                    onDelete={async (alertId) => {
                        await deleteAlert(alertId);
                    }}
                />
            )}

            {showCompletedPanel && (
                <CompletedJobsPanel
                    jobs={completedJobs}
                    onClose={() => setShowCompletedPanel(false)}
                />
            )}

            {rescheduleSuggestion && (
                <RescheduleSuggestionPopover
                    suggestion={rescheduleSuggestion}
                    onAccept={async (suggestion) => {
                        try {
                            const job = jobs.find(j => j.id === suggestion.jobId);
                            if (!job) return;

                            const updateMutations: Array<(batch: WriteBatch) => void> = [];
                            const updatesByJobId = new Map<string, Partial<Job>>();

                            // Update target job schedule
                            const targetUpdates = removeUndefined({
                                departmentSchedule: suggestion.suggestedSchedule,
                                needsReschedule: false,
                                dueDateChanged: false,
                                updatedAt: new Date()
                            });
                            const targetRef = doc(db, 'jobs', suggestion.jobId);
                            updateMutations.push((batch) => batch.update(targetRef, targetUpdates));
                            updatesByJobId.set(suggestion.jobId, targetUpdates);

                            // Apply Tier 2 job shifts
                            for (const shift of suggestion.jobShifts) {
                                const shiftJob = jobs.find(j => j.id === shift.jobId);
                                if (!shiftJob) continue;

                                const updatedDeptSched = shiftScheduleByWorkdayDelta(shiftJob.departmentSchedule, shift.workDays);
                                const updatedRemSched = shiftScheduleByWorkdayDelta(shiftJob.remainingDepartmentSchedule, shift.workDays);

                                const shiftUpdates = removeUndefined({
                                    departmentSchedule: updatedDeptSched || shiftJob.departmentSchedule,
                                    remainingDepartmentSchedule: updatedRemSched || shiftJob.remainingDepartmentSchedule,
                                    updatedAt: new Date()
                                });
                                const shiftRef = doc(db, 'jobs', shift.jobId);
                                updateMutations.push((batch) => batch.update(shiftRef, shiftUpdates));
                                updatesByJobId.set(shift.jobId, shiftUpdates);
                            }

                            await commitBatchedWrites(updateMutations);
                            setJobs(prev =>
                                prev.map(j =>
                                    updatesByJobId.has(j.id)
                                        ? { ...j, ...(updatesByJobId.get(j.id) as Partial<Job>) }
                                        : j
                                )
                            );
                            setRescheduleSuggestion(null);
                        } catch (error) {
                            console.error('Failed to apply reschedule suggestion:', error);
                        }
                    }}
                    onDismiss={async (jobId) => {
                        try {
                            const jobRef = doc(db, 'jobs', jobId);
                            await updateDoc(jobRef, {
                                needsReschedule: false,
                                dueDateChanged: false,
                                updatedAt: new Date()
                            });
                            setJobs(prev =>
                                prev.map(j =>
                                    j.id === jobId
                                        ? { ...j, needsReschedule: false, dueDateChanged: false }
                                        : j
                                )
                            );
                        } catch (error) {
                            console.error('Failed to dismiss reschedule:', error);
                        }
                        setRescheduleSuggestion(null);
                    }}
                />
            )}
        </div>
    );
}
