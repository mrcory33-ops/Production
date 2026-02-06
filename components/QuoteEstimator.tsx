'use client';

import { useState, useEffect } from 'react';
import { Job } from '@/types';
import {
    QuoteInput,
    QuoteEstimate,
    FeasibilityCheck,
    BigRockInput,
    convertDollarToPoints,
    calculateQuotePoints,
    simulateQuoteSchedule,
    checkAdvancedFeasibility,
} from '@/lib/quoteEstimator';
import { format } from 'date-fns';

interface QuoteEstimatorProps {
    existingJobs: Job[];
}

export default function QuoteEstimator({ existingJobs }: QuoteEstimatorProps) {
    const [totalValue, setTotalValue] = useState<string>('');
    const [totalQuantity, setTotalQuantity] = useState<string>('');
    const [hasBigRocks, setHasBigRocks] = useState(false);
    const [bigRocks, setBigRocks] = useState<BigRockInput[]>([]);
    const [isREF, setIsREF] = useState(false);
    const [engineeringDate, setEngineeringDate] = useState<string>('');
    const [mode, setMode] = useState<'EARLIEST' | 'TARGET'>('EARLIEST');
    const [targetDate, setTargetDate] = useState<string>('');
    const [estimate, setEstimate] = useState<QuoteEstimate | null>(null);
    const [feasibility, setFeasibility] = useState<FeasibilityCheck | null>(null);
    const [loading, setLoading] = useState(false);

    // Auto-calculate points for Big Rocks
    useEffect(() => {
        setBigRocks((prev) =>
            prev.map((br) => ({
                ...br,
                points: convertDollarToPoints(br.value),
            }))
        );
    }, [bigRocks.map((br) => br.value).join(',')]);

    const addBigRock = () => {
        setBigRocks([...bigRocks, { value: 0, points: 0 }]);
    };

    const removeBigRock = (index: number) => {
        setBigRocks(bigRocks.filter((_, i) => i !== index));
    };

    const updateBigRockValue = (index: number, value: string) => {
        const numValue = parseFloat(value) || 0;
        setBigRocks(
            bigRocks.map((br, i) => (i === index ? { ...br, value: numValue } : br))
        );
    };

    const calculateEstimate = async () => {
        const totalValueNum = parseFloat(totalValue);
        const totalQuantityNum = parseInt(totalQuantity);

        if (!engineeringDate || !Number.isFinite(totalValueNum) || !Number.isFinite(totalQuantityNum)) {
            alert('Please fill in all required fields');
            return;
        }
        if (totalValueNum <= 0 || totalQuantityNum <= 0) {
            alert('Total value and quantity must be greater than 0');
            return;
        }
        if (mode === 'TARGET' && !targetDate) {
            alert('Please select a target date');
            return;
        }

        if (hasBigRocks) {
            const bigRockValueSum = bigRocks.reduce((sum, br) => sum + (Number(br.value) || 0), 0);
            if (bigRocks.length > totalQuantityNum) {
                alert('Big Rock count cannot exceed total quantity');
                return;
            }
            if (bigRockValueSum > totalValueNum) {
                alert('Big Rock value cannot exceed total job value');
                return;
            }
        }

        setLoading(true);

        try {
            const input: QuoteInput = {
                totalValue: totalValueNum,
                totalQuantity: totalQuantityNum,
                bigRocks: hasBigRocks ? bigRocks : [],
                isREF,
                engineeringReadyDate: new Date(engineeringDate),
                targetDate: mode === 'TARGET' && targetDate ? new Date(targetDate) : undefined,
            };

            const result = await simulateQuoteSchedule(input, existingJobs);
            setEstimate(result);

            if (mode === 'TARGET' && targetDate) {
                const feasibilityResult = await checkAdvancedFeasibility(input, existingJobs);
                setFeasibility(feasibilityResult);
            } else {
                setFeasibility(null);
            }
        } catch (error) {
            console.error('Error calculating estimate:', error);
            alert('Failed to calculate estimate');
        } finally {
            setLoading(false);
        }
    };

    const pointsCalc = totalValue
        ? calculateQuotePoints({
            totalValue: parseFloat(totalValue) || 0,
            totalQuantity: parseInt(totalQuantity) || 0,
            bigRocks: hasBigRocks ? bigRocks : [],
            isREF,
            engineeringReadyDate: new Date(),
        })
        : null;

    return (
        <div className="max-w-5xl mx-auto p-6">
            <div className="bg-white rounded-lg shadow-lg p-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">ðŸ“Š FAB Quote Estimator</h1>
                <p className="text-gray-600 mb-8">
                    Estimate completion dates for prospective FAB jobs
                </p>

                {/* Input Form */}
                <div className="space-y-6">
                    {/* Total Job */}
                    <div className="border-b pb-6">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">Total Job</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Total Job Value ($) *
                                </label>
                                <input
                                    type="number"
                                    value={totalValue}
                                    onChange={(e) => setTotalValue(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="100000"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Total Quantity (items) *
                                </label>
                                <input
                                    type="number"
                                    value={totalQuantity}
                                    onChange={(e) => setTotalQuantity(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="25"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Big Rocks */}
                    <div className="border-b pb-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-gray-800">Big Rocks (Optional)</h2>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={hasBigRocks}
                                    onChange={(e) => {
                                        setHasBigRocks(e.target.checked);
                                        if (!e.target.checked) setBigRocks([]);
                                    }}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">Job contains Big Rock items</span>
                            </label>
                        </div>

                        {hasBigRocks && (
                            <div className="space-y-3">
                                {bigRocks.map((br, index) => (
                                    <div key={index} className="flex items-center gap-3">
                                        <span className="text-sm font-medium text-gray-600 w-24">
                                            Big Rock {index + 1}:
                                        </span>
                                        <div className="flex-1 flex items-center gap-2">
                                            <span className="text-gray-500">$</span>
                                            <input
                                                type="number"
                                                value={br.value || ''}
                                                onChange={(e) => updateBigRockValue(index, e.target.value)}
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                placeholder="15000"
                                            />
                                            <span className="text-sm text-gray-500 w-32">
                                                â†’ Est. {br.points?.toFixed(1) || 0} pts
                                            </span>
                                            <button
                                                onClick={() => removeBigRock(index)}
                                                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            >
                                                âœ•
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    onClick={addBigRock}
                                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                                >
                                    + Add Big Rock
                                </button>

                                {pointsCalc && hasBigRocks && bigRocks.length > 0 && (
                                    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                                        <p className="text-sm text-gray-700">
                                            <strong>Remaining:</strong> ${pointsCalc.remainingValue.toLocaleString()}{' '}
                                            across {Math.max(0, (parseInt(totalQuantity) || 0) - bigRocks.length)} items â†’ Est.{' '}
                                            {pointsCalc.remainingPoints.toFixed(1)} pts
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Job Type */}
                    <div className="border-b pb-6">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">Job Type</h2>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isREF}
                                onChange={(e) => setIsREF(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">REF (Refrigeration/Specialty)</span>
                        </label>
                    </div>

                    {/* Timing */}
                    <div className="border-b pb-6">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4">Timing</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Engineering Ready By *
                                </label>
                                <input
                                    type="date"
                                    value={engineeringDate}
                                    onChange={(e) => setEngineeringDate(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            <div className="space-y-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        checked={mode === 'EARLIEST'}
                                        onChange={() => setMode('EARLIEST')}
                                        className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="text-sm font-medium text-gray-700">
                                        Calculate Earliest Completion
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        checked={mode === 'TARGET'}
                                        onChange={() => setMode('TARGET')}
                                        className="w-4 h-4 text-blue-600 focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="text-sm font-medium text-gray-700">
                                        Check Target Date Feasibility
                                    </span>
                                </label>

                                {mode === 'TARGET' && (
                                    <div className="ml-6">
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Target Date
                                        </label>
                                        <input
                                            type="date"
                                            value={targetDate}
                                            onChange={(e) => setTargetDate(e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Calculate Button */}
                    <button
                        onClick={calculateEstimate}
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Calculating...' : 'Calculate Estimate'}
                    </button>
                </div>

                {/* Results */}
                {estimate && (
                    <div className="mt-8 border-t pt-8">
                        <h2 className="text-2xl font-bold text-gray-900 mb-6">ðŸ“‹ Estimate Results</h2>

                        <div className="space-y-6">
                            {/* Summary */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-600">Est. Welding Points</p>
                                        <p className="text-2xl font-bold text-gray-900">
                                            {estimate.totalPoints.toFixed(1)} pts
                                        </p>
                                        {estimate.isBigRock && (
                                            <span className="inline-block mt-2 px-3 py-1 bg-orange-100 text-orange-800 text-xs font-semibold rounded-full">
                                                BIG ROCK
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-600">Urgency Score</p>
                                        <p className="text-2xl font-bold text-gray-900">{estimate.urgencyScore} pts</p>
                                        {isREF && (
                                            <span className="inline-block mt-2 px-3 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                                                REF
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {estimate.bigRockPoints > 0 && (
                                    <div className="mt-4 pt-4 border-t border-blue-200">
                                        <p className="text-sm text-gray-700">
                                            <strong>Breakdown:</strong> {estimate.bigRockPoints.toFixed(1)} pts (Big
                                            Rocks) + {estimate.remainingPoints.toFixed(1)} pts (
                                            {estimate.remainingQuantity} items)
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Dates */}
                            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                                <p className="text-sm text-gray-600 mb-2">
                                    {mode === 'EARLIEST' ? 'ðŸ“… Earliest Completion' : 'ðŸ“… Projected Completion'}
                                </p>
                                <p className="text-3xl font-bold text-gray-900">
                                    {format(estimate.estimatedCompletion, 'MMMM d, yyyy')}
                                </p>
                            </div>

                            {/* Advanced Feasibility Check */}
                            {feasibility && mode === 'TARGET' && (
                                <div className="space-y-4">
                                    <h3 className="text-xl font-bold text-gray-900">Feasibility Analysis</h3>

                                    {/* Recommendation Banner */}
                                    <div className={`border-2 rounded-lg p-6 ${feasibility.recommendation === 'ACCEPT' ? 'bg-green-50 border-green-500' :
                                        feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'bg-yellow-50 border-yellow-500' :
                                            feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'bg-orange-50 border-orange-500' :
                                                'bg-red-50 border-red-500'
                                        }`}>
                                        <div className="flex items-start gap-4">
                                            <span className="text-4xl">
                                                {feasibility.recommendation === 'ACCEPT' ? 'âœ…' :
                                                    feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'âš ï¸' :
                                                        feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'ðŸ”§' : 'âŒ'}
                                            </span>
                                            <div className="flex-1">
                                                <p className="text-2xl font-bold text-gray-900 mb-2">
                                                    {feasibility.recommendation.replace(/_/g, ' ')}
                                                </p>
                                                <p className="text-gray-700">{feasibility.explanation}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tier 1: As-Is */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="text-2xl">{feasibility.asIs.achievable ? 'âœ…' : 'âŒ'}</span>
                                            <h4 className="text-lg font-semibold text-gray-900">Tier 1: As-Is Schedule</h4>
                                        </div>
                                        {feasibility.asIs.achievable ? (
                                            <p className="text-sm text-gray-700">
                                                Can complete by <strong>{feasibility.asIs.completionDate && format(feasibility.asIs.completionDate, 'MMMM d, yyyy')}</strong> without any changes.
                                            </p>
                                        ) : (
                                            <div className="space-y-2">
                                                <p className="text-sm text-gray-700">
                                                    Cannot fit into current schedule as-is.
                                                </p>
                                                {feasibility.asIs.bottlenecks.length > 0 && (
                                                    <div className="mt-2">
                                                        <p className="text-sm font-medium text-gray-700">Bottlenecks:</p>
                                                        <ul className="list-disc list-inside text-sm text-gray-600">
                                                            {feasibility.asIs.bottlenecks.map((b, i) => (
                                                                <li key={i}>{b}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Tier 2: With Moves */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="text-2xl">{feasibility.withMoves.achievable ? 'âœ…' : 'âŒ'}</span>
                                            <h4 className="text-lg font-semibold text-gray-900">Tier 2: With Job Movements</h4>
                                        </div>
                                        {feasibility.withMoves.achievable ? (
                                            <div className="space-y-3">
                                                <p className="text-sm text-gray-700">
                                                    Can complete by <strong>{feasibility.withMoves.completionDate && format(feasibility.withMoves.completionDate, 'MMMM d, yyyy')}</strong> by moving jobs with available buffer.
                                                </p>
                                                {feasibility.withMoves.jobsToMove.length > 0 && (
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-700 mb-2">
                                                            Jobs to move ({feasibility.withMoves.totalJobsAffected} total):
                                                        </p>
                                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                                            {feasibility.withMoves.jobsToMove.map((move, i) => (
                                                                <div key={i} className="bg-gray-50 p-3 rounded text-xs">
                                                                    <p className="font-medium text-gray-900">{move.jobName}</p>
                                                                    <p className="text-gray-600">
                                                                        {move.department}: {format(move.originalDate, 'MMM d')} â†’ {format(move.newDate, 'MMM d')}
                                                                    </p>
                                                                    <p className="text-gray-500">
                                                                        Due: {format(move.dueDate, 'MMM d')} (Buffer: {move.bufferDays} days)
                                                                    </p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-700">
                                                Cannot achieve target even with job movements.
                                            </p>
                                        )}
                                    </div>

                                    {/* Tier 3: With OT */}
                                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="text-2xl">{feasibility.withOT.achievable ? 'âœ…' : 'âŒ'}</span>
                                            <h4 className="text-lg font-semibold text-gray-900">Tier 3: With Overtime</h4>
                                        </div>
                                        {feasibility.withOT.achievable ? (
                                            <div className="space-y-2">
                                                {feasibility.withOT.completionDate ? (
                                                    <>
                                                        <p className="text-sm text-gray-700">
                                                            Can complete by <strong>{format(feasibility.withOT.completionDate, 'MMMM d, yyyy')}</strong> using 1000 pts/week capacity.
                                                        </p>
                                                        {feasibility.withOT.otWeeks.length > 0 && (
                                                            <p className="text-sm text-gray-600">
                                                                OT needed in {feasibility.withOT.otWeeks.length} week(s)
                                                            </p>
                                                        )}
                                                    </>
                                                ) : (
                                                    <p className="text-sm text-green-700 font-medium">
                                                        âœ“ No overtime needed - achievable with moves above
                                                    </p>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-gray-700">
                                                Cannot achieve target even with overtime.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Timeline */}
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800 mb-4">Department Timeline</h3>
                                <div className="space-y-2">
                                    {estimate.timeline.map((dept) => (
                                        <div
                                            key={dept.department}
                                            className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
                                        >
                                            <span className="w-32 font-medium text-gray-700">{dept.department}:</span>
                                            <span className="text-sm text-gray-600">
                                                {format(dept.startDate, 'MMM d')} - {format(dept.endDate, 'MMM d')}
                                            </span>
                                            <span className="text-sm text-gray-500">({dept.duration} days)</span>
                                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                <div
                                                    className="bg-blue-500 h-2 rounded-full"
                                                    style={{ width: `${(dept.duration / 10) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

