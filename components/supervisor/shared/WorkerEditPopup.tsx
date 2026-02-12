import React, { useState } from 'react';
import { WorkerProfile } from '../types';
import {
    X, Plus, Check, MessageSquare,
} from 'lucide-react';

// Suggested qualifications — users can also add custom ones
const SUGGESTED_QUALIFICATIONS = [
    'TIG Welding', 'MIG Welding', 'Stick Welding',
    'Blueprint Reading', 'Forklift Certified', 'Crane Operator',
    'Laser Cutting', 'Press Brake', 'Shear',
    'Assembly', 'Grinding', 'Layout',
    'Paint Prep', 'Quality Check', 'Lead Hand',
];

export default function WorkerEditPopup({ worker, onSave, onClose }: {
    worker: WorkerProfile;
    onSave: (updated: WorkerProfile) => void;
    onClose: () => void;
}) {
    const [selectedQuals, setSelectedQuals] = useState<string[]>(worker.qualifications || worker.strengths || []);
    const [comments, setComments] = useState(worker.comments || worker.notes || '');
    const [customQual, setCustomQual] = useState('');

    const addQual = (q: string) => {
        const trimmed = q.trim();
        if (trimmed && !selectedQuals.includes(trimmed)) {
            setSelectedQuals(prev => [...prev, trimmed]);
        }
    };

    const removeQual = (q: string) => {
        setSelectedQuals(prev => prev.filter(x => x !== q));
    };

    const toggleQual = (q: string) => {
        selectedQuals.includes(q) ? removeQual(q) : addQual(q);
    };

    const handleAddCustom = () => {
        if (customQual.trim()) {
            addQual(customQual.trim());
            setCustomQual('');
        }
    };

    const handleSave = () => {
        onSave({
            ...worker,
            qualifications: selectedQuals,
            strengths: selectedQuals, // keep legacy field in sync
            comments,
        });
    };

    // Combine suggested + any custom ones already on the worker
    const allSuggestions = [...new Set([...SUGGESTED_QUALIFICATIONS, ...selectedQuals])];

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-[#1a1a1a] border border-[#444] rounded-xl shadow-2xl w-[480px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-5 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] sticky top-0 z-10">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-sky-900/40 border border-sky-700/50 flex items-center justify-center text-sky-300 font-bold text-sm">
                                {worker.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white font-serif">{worker.name}</h3>
                                <p className="text-[10px] text-[#666] uppercase tracking-wider font-mono">Edit Worker Profile</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 text-[#666] hover:text-white transition-colors rounded hover:bg-[#333]">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Current Qualifications */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Check className="w-3.5 h-3.5" /> Active Qualifications
                        <span className="text-[9px] font-mono text-[#555] ml-auto">{selectedQuals.length} assigned</span>
                    </h4>
                    {selectedQuals.length > 0 ? (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {selectedQuals.map(q => (
                                <span key={q} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 shadow-[0_0_8px_rgba(52,211,153,0.15)]">
                                    ✓ {q}
                                    <button onClick={() => removeQual(q)} className="ml-0.5 text-emerald-500 hover:text-rose-400 transition-colors">
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-[#555] mb-3">No qualifications assigned yet</p>
                    )}

                    {/* Add custom qualification */}
                    <div className="flex gap-2">
                        <input
                            value={customQual}
                            onChange={e => setCustomQual(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                            placeholder="Add custom qualification..."
                            className="flex-1 bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-xs text-white placeholder-[#555] focus:border-sky-500/50 focus:outline-none"
                        />
                        <button onClick={handleAddCustom} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-xs font-bold text-white transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Suggested Qualifications */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Quick Add</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {SUGGESTED_QUALIFICATIONS.filter(q => !selectedQuals.includes(q)).map(q => (
                            <button key={q} onClick={() => addQual(q)}
                                className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#111] text-[#666] border border-[#333] hover:text-emerald-300 hover:border-emerald-700/50 hover:bg-emerald-900/20 transition-all">
                                + {q}
                            </button>
                        ))}
                        {SUGGESTED_QUALIFICATIONS.filter(q => !selectedQuals.includes(q)).length === 0 && (
                            <p className="text-[10px] text-[#555]">All suggested qualifications assigned</p>
                        )}
                    </div>
                </div>

                {/* Comments */}
                <div className="p-5 border-b border-[#333]">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5" /> Comments
                    </h4>
                    <textarea
                        value={comments}
                        onChange={e => setComments(e.target.value)}
                        placeholder="Notes about this worker..."
                        rows={3}
                        className="w-full bg-[#111] border border-[#333] rounded-lg px-4 py-3 text-sm text-white placeholder-[#555] focus:border-sky-500/50 focus:outline-none resize-none"
                    />
                </div>

                {/* Footer */}
                <div className="p-5 flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#444] text-sm text-[#888] hover:text-white hover:border-[#666] transition-all">
                        Cancel
                    </button>
                    <button onClick={handleSave} className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm font-bold text-white transition-colors shadow-lg">
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
}
