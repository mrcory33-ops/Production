import React, { useState } from 'react';
import { ScoringWeights, ScoringFactor, getScoringWeights, updateScoringWeights } from '@/lib/scoringConfig';
import { X, Plus, Trash2, Save, RotateCcw } from 'lucide-react';

interface ScoringConfigPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void; // Parent should re-calculate scores
}

const FACTOR_LABELS: Record<string, string> = {
    dueDateProximity: 'Due Date Proximity',
    fastShip: 'Fast Ship Bonus',
    slippageRisk: 'Slippage Risk',
    stallPenalty: 'Stall Penalty',
    bigRock: 'Big Rock Weight',
    refJob: 'REF Job Bonus',
    harmonicProduct: 'Harmonic Product',
};

export default function ScoringConfigPanel({ isOpen, onClose, onSave }: ScoringConfigPanelProps) {
    const [weights, setWeights] = useState<ScoringWeights>(() => JSON.parse(JSON.stringify(getScoringWeights())));
    const [activeTab, setActiveTab] = useState<'defaults' | 'custom'>('defaults');

    if (!isOpen) return null;

    const handleSave = () => {
        if (weights) {
            updateScoringWeights(weights);
            onSave();
            onClose();
        }
    };

    const updateFactor = (key: keyof ScoringWeights, updates: Partial<ScoringFactor>) => {
        setWeights(prev => {
            return {
                ...prev,
                [key]: { ...prev[key], ...updates }
            };
        });
    };

    const updateCustomFactor = (id: string, updates: Partial<ScoringFactor>) => {
        setWeights(prev => {
            if (!prev.customFactors) return prev;
            return {
                ...prev,
                customFactors: prev.customFactors.map(f => f.id === id ? { ...f, ...updates } : f)
            };
        });
    };

    const addCustomFactor = () => {
        const newFactor: ScoringFactor = {
            id: `custom_${Date.now()}`,
            label: 'New Factor',
            type: 'bonus',
            bonusPoints: 10,
            matchCondition: '',
            enabled: true
        };

        setWeights(prev => {
            return {
                ...prev,
                customFactors: [...(prev.customFactors || []), newFactor]
            };
        });
        setActiveTab('custom');
    };

    const removeCustomFactor = (id: string) => {
        setWeights(prev => {
            if (!prev.customFactors) return prev;
            return {
                ...prev,
                customFactors: prev.customFactors.filter(f => f.id !== id)
            };
        });
    };

    const renderFactorInputs = (factor: ScoringFactor, onChange: (updates: Partial<ScoringFactor>) => void, isCustom = false) => {
        return (
            <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                {!isCustom && (
                    <div className="col-span-2 flex items-center gap-2 mb-2">
                        <input
                            type="checkbox"
                            checked={factor.enabled !== false}
                            onChange={(e) => onChange({ enabled: e.target.checked })}
                            className="rounded border-slate-300"
                        />
                        <span className="font-medium text-slate-700">{factor.enabled !== false ? 'Enabled' : 'Disabled'}</span>
                    </div>
                )}

                {isCustom && (
                    <div className="col-span-2 grid grid-cols-1 gap-2 mb-2 p-2 bg-slate-50 rounded border border-slate-100">
                        <div className="flex flex-col">
                            <label className="text-xs text-slate-500 mb-1">Factor Name</label>
                            <input
                                type="text"
                                value={factor.label || ''}
                                onChange={(e) => onChange({ label: e.target.value })}
                                className="border border-slate-200 rounded px-2 py-1"
                            />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs text-slate-500 mb-1">Match Text (Description/Notes)</label>
                            <input
                                type="text"
                                value={factor.matchCondition || ''}
                                onChange={(e) => onChange({ matchCondition: e.target.value })}
                                placeholder="e.g. VIP"
                                className="border border-slate-200 rounded px-2 py-1 font-mono text-xs"
                            />
                        </div>
                    </div>
                )}

                {/* Conditional Inputs based on factor fields */}
                {factor.maxPoints !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Max Points</label>
                        <input
                            type="number"
                            value={factor.maxPoints}
                            onChange={(e) => onChange({ maxPoints: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
                {factor.bonusPoints !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Bonus Points</label>
                        <input
                            type="number"
                            value={factor.bonusPoints}
                            onChange={(e) => onChange({ bonusPoints: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
                {factor.daysThreshold !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Days Threshold</label>
                        <input
                            type="number"
                            value={factor.daysThreshold}
                            onChange={(e) => onChange({ daysThreshold: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
                {factor.pointsThreshold !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Points Threshold</label>
                        <input
                            type="number"
                            value={factor.pointsThreshold}
                            onChange={(e) => onChange({ pointsThreshold: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
                {factor.pointsPerDayLate !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Pts/Day Late</label>
                        <input
                            type="number"
                            value={factor.pointsPerDayLate}
                            onChange={(e) => onChange({ pointsPerDayLate: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
                {factor.pointsPerDayStalled !== undefined && (
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-500 mb-1">Pts/Day Stalled</label>
                        <input
                            type="number"
                            value={factor.pointsPerDayStalled}
                            onChange={(e) => onChange({ pointsPerDayStalled: Number(e.target.value) })}
                            className="border border-slate-200 rounded px-2 py-1"
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-[500] flex justify-end">
            <div className="w-[450px] bg-white h-full shadow-2xl flex flex-col animate-slide-in-right">
                {/* Header */}
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Scoring Configuration</h2>
                        <p className="text-xs text-slate-500">Adjust how job urgency is calculated</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded text-slate-500">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200">
                    <button
                        className={`flex-1 py-3 text-sm font-medium ${activeTab === 'defaults' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
                        onClick={() => setActiveTab('defaults')}
                    >
                        Standard Factors
                    </button>
                    <button
                        className={`flex-1 py-3 text-sm font-medium ${activeTab === 'custom' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
                        onClick={() => setActiveTab('custom')}
                    >
                        Custom Factors ({weights?.customFactors?.length || 0})
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {activeTab === 'defaults' && Object.entries(weights).map(([key, val]) => {
                        if (key === 'customFactors') return null;
                        const factor = val as ScoringFactor;

                        return (
                            <div key={key} className={`border rounded-lg p-3 ${factor.enabled !== false ? 'border-slate-300 bg-white' : 'border-slate-100 bg-slate-50 opacity-75'}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <h3 className="font-semibold text-slate-700">{FACTOR_LABELS[key] || key}</h3>
                                </div>
                                {renderFactorInputs(factor, (updates) => updateFactor(key as keyof ScoringWeights, updates))}
                            </div>
                        );
                    })}

                    {activeTab === 'custom' && (
                        <div className="space-y-4">
                            {weights.customFactors?.map((factor) => (
                                <div key={factor.id} className="border border-indigo-100 bg-indigo-50/30 rounded-lg p-3 relative group">
                                    <button
                                        onClick={() => removeCustomFactor(factor.id!)}
                                        className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Remove Factor"
                                    >
                                        <Trash2 size={16} />
                                    </button>

                                    <div className="flex items-center gap-2 mb-2">
                                        <input
                                            type="checkbox"
                                            checked={factor.enabled !== false}
                                            onChange={(e) => updateCustomFactor(factor.id!, { enabled: e.target.checked })}
                                            className="rounded border-slate-300"
                                        />
                                        <span className="font-semibold text-indigo-900">{factor.label || 'Unnamed Factor'}</span>
                                    </div>

                                    {renderFactorInputs(factor, (updates) => updateCustomFactor(factor.id!, updates), true)}
                                </div>
                            ))}

                            <button
                                onClick={addCustomFactor}
                                className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 flex items-center justify-center gap-2 transition-colors"
                            >
                                <Plus size={18} />
                                Add Custom Factor
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
                    <button
                        onClick={() => setWeights(JSON.parse(JSON.stringify(getScoringWeights())))}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium"
                    >
                        <RotateCcw size={16} /> Reset
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-indigo-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700 flex items-center gap-2"
                        >
                            <Save size={16} /> Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
