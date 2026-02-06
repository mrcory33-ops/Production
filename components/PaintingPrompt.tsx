'use client';

import { Job } from '@/types';
import { Paintbrush, X } from 'lucide-react';
import { useState } from 'react';

interface PaintingPromptProps {
    harmonicJobs: Job[];
    onConfirm: (jobsRequiringPainting: Set<string>) => void;
    onSkip: () => void;
}

export default function PaintingPrompt({ harmonicJobs, onConfirm, onSkip }: PaintingPromptProps) {
    const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());

    const toggleJob = (jobId: string) => {
        const newSet = new Set(selectedJobs);
        if (newSet.has(jobId)) {
            newSet.delete(jobId);
        } else {
            newSet.add(jobId);
        }
        setSelectedJobs(newSet);
    };

    const handleConfirm = () => {
        onConfirm(selectedJobs);
    };

    if (harmonicJobs.length === 0) {
        onSkip();
        return null;
    }

    return (
        <div className="fixed inset-0 bg-slate-950/90 z-50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="glass-panel rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl border border-slate-700">
                {/* Header */}
                <div className="p-6 border-b border-slate-700/50 bg-gradient-to-r from-purple-950/30 to-slate-900/30">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center border border-purple-500/20">
                                <Paintbrush className="w-6 h-6 text-purple-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white">Painting Required?</h2>
                                <p className="text-sm text-slate-400">Select HARMONIC jobs that need off-site painting</p>
                            </div>
                        </div>
                        <button
                            onClick={onSkip}
                            className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Job List */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-3">
                        {harmonicJobs.map((job) => (
                            <label
                                key={job.id}
                                className="flex items-start gap-4 p-4 rounded-xl border border-slate-700 hover:border-purple-500/50 hover:bg-slate-800/40 cursor-pointer transition-all group"
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedJobs.has(job.id)}
                                    onChange={() => toggleJob(job.id)}
                                    className="mt-1 w-5 h-5 rounded border-slate-600 text-purple-500 focus:ring-purple-500 focus:ring-offset-slate-900 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono text-sm font-bold text-purple-400">{job.id}</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border bg-purple-500/10 text-purple-400 border-purple-500/20">
                                            HARMONIC
                                        </span>
                                    </div>
                                    <div className="font-semibold text-white text-sm truncate group-hover:text-purple-100 transition-colors">
                                        {job.name}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        {job.weldingPoints} pts • Due {job.dueDate.toLocaleDateString()}
                                    </div>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-700/50 bg-slate-900/40">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-400">
                            {selectedJobs.size} of {harmonicJobs.length} jobs selected
                            {selectedJobs.size > 0 && (
                                <span className="ml-2 text-purple-400 font-medium">
                                    (+8-9 days assembly time each)
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={onSkip}
                                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium"
                            >
                                Skip
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2 rounded-lg flex items-center shadow-lg shadow-purple-500/20 transition-all hover:scale-105 active:scale-95"
                            >
                                <Paintbrush className="h-4 w-4 mr-2" />
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
