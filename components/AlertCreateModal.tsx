'use client';

import { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { AlertTriangle, Search, X } from 'lucide-react';
import { Job } from '@/types';
import { createAlert } from '@/lib/supervisorAlerts';

interface AlertCreateModalProps {
    isOpen: boolean;
    jobs: Job[];
    onClose: () => void;
    onCreated?: () => void;
}

const toDateInput = (date: Date) => format(date, 'yyyy-MM-dd');

export default function AlertCreateModal({
    isOpen,
    jobs,
    onClose,
    onCreated
}: AlertCreateModalProps) {
    const [jobQuery, setJobQuery] = useState('');
    const [selectedJobId, setSelectedJobId] = useState('');
    const [reason, setReason] = useState('');
    const [estimatedResolutionDate, setEstimatedResolutionDate] = useState(toDateInput(addDays(new Date(), 1)));
    const [reportedBy, setReportedBy] = useState('Supervisor');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedJob = useMemo(
        () => jobs.find(job => job.id === selectedJobId) || null,
        [jobs, selectedJobId]
    );

    const matches = useMemo(() => {
        const query = jobQuery.trim().toLowerCase();
        if (!query) return jobs.slice(0, 8);
        return jobs
            .filter(job =>
                job.id.toLowerCase().includes(query) ||
                job.name.toLowerCase().includes(query) ||
                (job.salesOrder || '').toLowerCase().includes(query)
            )
            .slice(0, 8);
    }, [jobQuery, jobs]);

    const resetForm = () => {
        setJobQuery('');
        setSelectedJobId('');
        setReason('');
        setEstimatedResolutionDate(toDateInput(addDays(new Date(), 1)));
        setReportedBy('Supervisor');
        setError(null);
    };

    const handleClose = () => {
        if (saving) return;
        resetForm();
        onClose();
    };

    const handleSubmit = async () => {
        if (!selectedJob) {
            setError('Select a work order.');
            return;
        }
        if (!reason.trim()) {
            setError('Reason is required.');
            return;
        }
        if (!estimatedResolutionDate) {
            setError('Estimated resolution date is required.');
            return;
        }
        if (!reportedBy.trim()) {
            setError('Reported by is required.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await createAlert({
                jobId: selectedJob.id,
                department: selectedJob.currentDepartment,
                reason: reason.trim(),
                estimatedResolutionDate: new Date(estimatedResolutionDate),
                jobName: selectedJob.name,
                salesOrder: selectedJob.salesOrder,
                reportedBy: reportedBy.trim()
            });
            onCreated?.();
            handleClose();
        } catch (createError) {
            console.error('Failed to create alert', createError);
            setError('Failed to create alert. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                    <div>
                        <h2 className="text-lg font-bold text-white">Report Issue</h2>
                        <p className="text-xs text-slate-400">Submit a shop-floor delay for manager review</p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={saving}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Work Order</label>
                        <div className="mt-1 rounded-xl border border-slate-700 bg-slate-950">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
                                <Search className="w-4 h-4 text-slate-500" />
                                <input
                                    value={jobQuery}
                                    onChange={(e) => setJobQuery(e.target.value)}
                                    placeholder="Search WO#, job name, or SO#"
                                    className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
                                />
                            </div>
                            <div className="max-h-44 overflow-y-auto">
                                {matches.map(job => (
                                    <button
                                        key={job.id}
                                        onClick={() => {
                                            setSelectedJobId(job.id);
                                            setJobQuery(`${job.id} - ${job.name}`);
                                        }}
                                        className={`w-full px-3 py-2 text-left border-b border-slate-900 last:border-b-0 transition-colors ${selectedJobId === job.id ? 'bg-cyan-900/30' : 'hover:bg-slate-800/70'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm font-mono text-cyan-300">{job.id}</span>
                                            <span className="text-[10px] text-slate-500">{job.currentDepartment}</span>
                                        </div>
                                        <div className="text-xs text-slate-300 truncate">{job.name}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Department</label>
                            <div className="mt-1 px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-sm text-white">
                                {selectedJob?.currentDepartment || 'Select a WO first'}
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Est. Resolution</label>
                            <input
                                type="date"
                                value={estimatedResolutionDate}
                                onChange={(e) => setEstimatedResolutionDate(e.target.value)}
                                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-sm text-white outline-none focus:border-cyan-500"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Reported By</label>
                            <input
                                value={reportedBy}
                                onChange={(e) => setReportedBy(e.target.value)}
                                className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-sm text-white outline-none focus:border-cyan-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Reason</label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Describe the blocker, parts delay, machine issue, QA hold, etc."
                            rows={4}
                            className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-700 bg-slate-950 text-sm text-white outline-none resize-y focus:border-cyan-500"
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-950/25 text-red-300 text-xs">
                            <AlertTriangle className="w-4 h-4" />
                            {error}
                        </div>
                    )}
                </div>

                <div className="px-5 py-4 border-t border-slate-800 flex justify-end gap-2">
                    <button
                        onClick={handleClose}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                    >
                        {saving ? 'Saving...' : 'Create Alert'}
                    </button>
                </div>
            </div>
        </div>
    );
}
