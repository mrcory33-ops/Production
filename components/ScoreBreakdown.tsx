import React from 'react';
import { getScoringWeights } from '@/lib/scoringConfig';

interface ScoreBreakdownProps {
    score: number;
    factors?: Record<string, number>;
}

export default function ScoreBreakdown({ score, factors }: ScoreBreakdownProps) {
    // Default to empty object if undefined
    const safeFactors = factors || {};
    const weights = getScoringWeights();

    // Helper to get helper label
    const getLabel = (key: string) => {
        // Check built-in keys
        if (weights[key as keyof typeof weights]) {
            return (weights[key as keyof typeof weights] as any).label || key;
        }
        // Check custom factors
        const custom = weights.customFactors?.find(f => f.id === key);
        if (custom) return custom.label || key;

        return key.replace(/([A-Z])/g, ' $1').trim(); // Fallback camelCase to words
    };

    const activeFactors = Object.entries(safeFactors)
        .filter(([_, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]); // Highest points first

    return (
        <div className="min-w-[200px] p-2 bg-slate-800 text-white rounded shadow-xl text-xs z-50">
            <div className="flex justify-between items-center mb-2 border-b border-slate-600 pb-1">
                <span className="font-semibold text-slate-300">Urgency Score</span>
                <span className="text-lg font-bold text-blue-400">{Math.round(score)}</span>
            </div>

            <div className="space-y-1">
                {activeFactors.length === 0 ? (
                    <div className="text-slate-400 italic">No active factors</div>
                ) : (
                    activeFactors.map(([key, value]) => (
                        <div key={key} className="flex justify-between items-center">
                            <span className="text-slate-300 capitalize">{getLabel(key)}</span>
                            <span className="font-mono text-green-400">+{Math.round(value)}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
