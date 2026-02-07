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
        <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden">
                    {/* Header Section */}
                    <div className="bg-slate-900 px-8 py-10 text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-[100px] opacity-20 -mr-32 -mt-32"></div>
                        <h1 className="text-3xl font-extrabold tracking-tight mb-2">FAB Quote Estimator</h1>
                        <p className="text-slate-400 text-lg max-w-lg">
                            Enterprise-grade scheduling and point estimation for prospective fabrication jobs.
                        </p>
                    </div>

                    <div className="p-8 lg:p-12">
                        {/* Input Form */}
                        <div className="space-y-10">
                            {/* Section: Job Fundamentals */}
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
                                    <h2 className="text-xl font-bold text-black uppercase tracking-wider text-sm">Job Fundamentals</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-black">
                                            Total Job Value ($)
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                            <input
                                                type="number"
                                                value={totalValue}
                                                onChange={(e) => setTotalValue(e.target.value)}
                                                className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-black">
                                            Total Quantity (Items)
                                        </label>
                                        <input
                                            type="number"
                                            value={totalQuantity}
                                            onChange={(e) => setTotalQuantity(e.target.value)}
                                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Section: Item Complexity */}
                            <section className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
                                        <h2 className="text-xl font-bold text-black uppercase tracking-wider text-sm">Item Complexity</h2>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={hasBigRocks}
                                                onChange={(e) => {
                                                    setHasBigRocks(e.target.checked);
                                                    if (!e.target.checked) setBigRocks([]);
                                                }}
                                                className="w-5 h-5 border-slate-300 rounded text-indigo-600 focus:ring-indigo-500 transition-all"
                                            />
                                            <span className="text-sm font-medium text-black group-hover:text-black transition-colors">Contains Big Rocks</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={isREF}
                                                onChange={(e) => setIsREF(e.target.checked)}
                                                className="w-5 h-5 border-slate-300 rounded text-indigo-600 focus:ring-indigo-500 transition-all"
                                            />
                                            <span className="text-sm font-medium text-black group-hover:text-black transition-colors">REF Speciality</span>
                                        </label>
                                    </div>
                                </div>

                                {hasBigRocks && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                                        <div className="grid gap-3">
                                            {bigRocks.map((br, index) => (
                                                <div key={index} className="flex items-center gap-3 bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                                                    <div className="flex-1 flex items-center gap-3 px-2">
                                                        <span className="text-xs font-bold text-slate-400 uppercase w-20">Rock {index + 1}</span>
                                                        <span className="text-slate-400">$</span>
                                                        <input
                                                            type="number"
                                                            value={br.value || ''}
                                                            onChange={(e) => updateBigRockValue(index, e.target.value)}
                                                            className="flex-1 min-w-0 bg-transparent py-1 font-medium text-slate-900 outline-none"
                                                            placeholder="Value"
                                                        />
                                                        <span className="hidden sm:inline-block text-xs font-bold px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg">
                                                            {br.points?.toFixed(1) || 0} PTS
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={() => removeBigRock(index)}
                                                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={addBigRock}
                                            className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/30 transition-all font-semibold text-sm"
                                        >
                                            + Add Big Rock Definition
                                        </button>

                                        {pointsCalc && hasBigRocks && bigRocks.length > 0 && (
                                            <div className="p-4 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200">
                                                <p className="text-sm opacity-90">
                                                    <strong>Remaining Scope:</strong> ${pointsCalc.remainingValue.toLocaleString()} across {Math.max(0, (parseInt(totalQuantity) || 0) - bigRocks.length)} items
                                                </p>
                                                <p className="text-lg font-bold mt-1">
                                                    Estimated {pointsCalc.remainingPoints.toFixed(1)} Base Points
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>

                            {/* Section: Timeline Controls */}
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-1 h-6 bg-indigo-600 rounded-full"></div>
                                    <h2 className="text-xl font-bold text-black uppercase tracking-wider text-sm">Delivery Timing</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="block text-sm font-semibold text-black">Engineering Ready Date</label>
                                            <input
                                                type="date"
                                                value={engineeringDate}
                                                onChange={(e) => setEngineeringDate(e.target.value)}
                                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <label className="block text-sm font-semibold text-black">Scheduling Mode</label>
                                        <div className="grid grid-cols-1 gap-3">
                                            <button
                                                onClick={() => setMode('EARLIEST')}
                                                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${mode === 'EARLIEST' ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 scale-[1.02]' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'}`}
                                            >
                                                <span className="font-bold">Earliest Availability</span>
                                                {mode === 'EARLIEST' && <div className="w-2 h-2 bg-indigo-600 rounded-full shadow-[0_0_10px_indigo]"></div>}
                                            </button>
                                            <button
                                                onClick={() => setMode('TARGET')}
                                                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${mode === 'TARGET' ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 scale-[1.02]' : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'}`}
                                            >
                                                <span className="font-bold">Specific Target Date</span>
                                                {mode === 'TARGET' && <div className="w-2 h-2 bg-indigo-600 rounded-full shadow-[0_0_10px_indigo]"></div>}
                                            </button>
                                        </div>
                                        {mode === 'TARGET' && (
                                            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                                <input
                                                    type="date"
                                                    value={targetDate}
                                                    onChange={(e) => setTargetDate(e.target.value)}
                                                    className="w-full px-4 py-3 bg-white border-2 border-indigo-200 rounded-xl focus:ring-4 focus:ring-indigo-100 outline-none transition-all"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>

                            <button
                                onClick={calculateEstimate}
                                disabled={loading}
                                className="w-full py-5 bg-indigo-600 hover:bg-slate-900 text-white rounded-[1.25rem] font-bold text-lg shadow-xl shadow-indigo-100 transition-all hover:-translate-y-1 active:scale-95 disabled:bg-slate-200 disabled:shadow-none disabled:translate-y-0"
                            >
                                {loading ? (
                                    <div className="flex items-center justify-center gap-3">
                                        <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Simulating Shop Floor...
                                    </div>
                                ) : 'Generate Production Forecast'}
                            </button>
                        </div>

                        {/* Results Section */}
                        {estimate && (
                            <div className="mt-16 space-y-12 pt-12 border-t border-slate-100 animate-in fade-in slide-in-from-bottom-8 duration-500">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-3xl font-black text-black">Estimation Results</h2>
                                    <div className="flex gap-2">
                                        {estimate.isBigRock && (
                                            <span className="px-4 py-1.5 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-full">Big Rock Class</span>
                                        )}
                                        {isREF && (
                                            <span className="px-4 py-1.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">Ref Module</span>
                                        )}
                                    </div>
                                </div>

                                {/* Primary Metrics */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 group hover:bg-white hover:shadow-xl transition-all">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 italic">Total Weld Points</p>
                                        <p className="text-4xl font-black text-black tracking-tight">{estimate.totalPoints.toFixed(1)}<span className="text-lg ml-1 text-slate-500 font-medium">pts</span></p>
                                    </div>
                                    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 group hover:bg-white hover:shadow-xl transition-all">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 italic">Urgency Factor</p>
                                        <p className="text-4xl font-black text-black tracking-tight">{estimate.urgencyScore.toFixed(0)}<span className="text-lg ml-1 text-slate-500 font-medium">%</span></p>
                                    </div>
                                    <div className="bg-indigo-600 p-8 rounded-[2rem] text-white shadow-2xl shadow-indigo-200 col-span-1 md:col-span-1">
                                        <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest mb-4 italic">Projected Finish</p>
                                        <p className="text-2xl font-black leading-tight">
                                            {format(estimate.estimatedCompletion, 'MMM')} <span className="text-4xl">{format(estimate.estimatedCompletion, 'dd')}</span>
                                        </p>
                                        <p className="text-sm font-bold opacity-80 mt-1">{format(estimate.estimatedCompletion, 'yyyy')}</p>
                                    </div>
                                </div>

                                {/* Feasibility Drilldown */}
                                {feasibility && mode === 'TARGET' && (
                                    <section className="space-y-8">
                                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            Capacity & Feasibility Analysis
                                        </h3>

                                        {/* Master Recommendation Card */}
                                        <div className={`rounded-[2rem] p-1 ${feasibility.recommendation === 'ACCEPT' ? 'bg-gradient-to-br from-emerald-400 to-green-600' :
                                            feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'bg-gradient-to-br from-amber-400 to-yellow-600' :
                                                feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'bg-gradient-to-br from-orange-400 to-red-500' :
                                                    'bg-gradient-to-br from-slate-700 to-slate-900'
                                            }`}>
                                            <div className="bg-white rounded-[1.95rem] p-8">
                                                <div className="flex flex-col md:flex-row md:items-center gap-6">
                                                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${feasibility.recommendation === 'ACCEPT' ? 'bg-emerald-100 text-emerald-600' :
                                                        feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'bg-amber-100 text-amber-600' :
                                                            feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'bg-orange-100 text-orange-600' :
                                                                'bg-slate-100 text-slate-600'
                                                        }`}>
                                                        <span className="text-3xl">
                                                            {feasibility.recommendation === 'ACCEPT' ? '✓' :
                                                                feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? '!' :
                                                                    feasibility.recommendation === 'ACCEPT_WITH_OT' ? '+' : '✕'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <h4 className="text-2xl font-black text-slate-900 leading-none mb-2">
                                                            {feasibility.recommendation.replace(/_/g, ' ')}
                                                        </h4>
                                                        <p className="text-slate-600 font-medium leading-relaxed max-w-2xl">{feasibility.explanation}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tiers Grid */}
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                            {/* Tier 1 */}
                                            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                                    <span className="text-5xl font-black text-slate-900">01</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.asIs.achievable ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-slate-300'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">As-Is Schedule</span>
                                                </div>
                                                <p className="text-sm font-bold text-slate-900 mb-2">Completion Status:</p>
                                                <p className="text-sm text-slate-600">
                                                    {feasibility.asIs.achievable
                                                        ? `Achievable by ${format(feasibility.asIs.completionDate!, 'MMM dd')}`
                                                        : 'Capacity overflow detected'
                                                    }
                                                </p>
                                                {feasibility.asIs.bottlenecks.length > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-slate-200">
                                                        <span className="text-[10px] font-black uppercase text-slate-400">Primary Bottleneck</span>
                                                        <p className="text-xs font-bold text-red-600 mt-1">{feasibility.asIs.bottlenecks[0]}</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Tier 2 */}
                                            <div className="bg-white border-2 border-slate-100 rounded-3xl p-6 shadow-sm relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform text-slate-900">
                                                    <span className="text-5xl font-black">02</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.withMoves.achievable ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-slate-300'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-slate-400">Adaptive Re-routing</span>
                                                </div>
                                                <p className="text-sm font-bold text-slate-900 mb-2">Affected Scale:</p>
                                                <p className="text-sm text-slate-600">
                                                    {feasibility.withMoves.achievable
                                                        ? `${feasibility.withMoves.totalJobsAffected} jobs • ${Math.round(feasibility.withMoves.capacityFreed)} pts freed`
                                                        : 'Moves alone not sufficient'
                                                    }
                                                </p>
                                                {feasibility.withMoves.achievable && feasibility.withMoves.completionDate && (
                                                    <p className="text-xs text-emerald-600 font-bold mt-2">✓ Complete by {format(feasibility.withMoves.completionDate, 'MMM dd')}</p>
                                                )}
                                            </div>

                                            {/* Tier 3 */}
                                            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-white relative overflow-hidden group">
                                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                                                    <span className="text-5xl font-black text-white">03</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.withOT.achievable ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-slate-700'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-slate-500">Overtime Required</span>
                                                </div>
                                                {feasibility.withOT.recommendedTier ? (
                                                    <>
                                                        <p className="text-sm font-bold text-slate-300 mb-1">Recommended: Tier {feasibility.withOT.recommendedTier}</p>
                                                        <p className="text-sm text-slate-400">
                                                            {feasibility.withOT.otWeeks.length > 0
                                                                ? `${feasibility.withOT.otWeeks[0]?.tierLabel} · ${feasibility.withOT.otWeeks.length} week(s)`
                                                                : 'No additional OT weeks needed'}
                                                        </p>
                                                        {feasibility.withOT.achievable && feasibility.withOT.completionDate && (
                                                            <p className="text-xs text-emerald-400 font-bold mt-2">✓ Complete by {format(feasibility.withOT.completionDate, 'MMM dd')}</p>
                                                        )}
                                                        {!feasibility.withOT.achievable && feasibility.withOT.completionDate && (
                                                            <p className="text-xs text-red-400 font-bold mt-2">✕ Best possible: {format(feasibility.withOT.completionDate, 'MMM dd')}</p>
                                                        )}
                                                    </>
                                                ) : (
                                                    <p className="text-sm text-emerald-400 font-bold">No OT needed</p>
                                                )}
                                            </div>
                                        </div>
                                    </section>
                                )}

                                {/* Department Timeline Visualizer */}
                                <div className="bg-slate-50 rounded-[2.5rem] p-8 lg:p-10 border border-slate-100">
                                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-8">Execution Roadmap</h3>
                                    <div className="grid gap-4">
                                        {estimate.timeline.map((dept, idx) => (
                                            <div key={dept.department} className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white p-4 rounded-2xl shadow-sm group hover:shadow-md transition-all">
                                                <div className="sm:w-36 shrink-0">
                                                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Process {idx + 1}</span>
                                                    <span className="font-bold text-slate-900 text-sm">{dept.department}</span>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-2 italic">
                                                        <span>{format(dept.startDate, 'MMM dd')} Launch</span>
                                                        <span>{dept.duration} Shop Days</span>
                                                        <span>{format(dept.endDate, 'MMM dd')} Handoff</span>
                                                    </div>
                                                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
                                                        <div
                                                            className="absolute inset-y-0 left-0 bg-indigo-600 rounded-full group-hover:bg-slate-900 transition-colors duration-500"
                                                            style={{ width: `${Math.min(100, (dept.duration / 14) * 100)}%` }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <p className="text-center text-slate-400 text-xs mt-8 font-medium">
                    &copy; {new Date().getFullYear()} EMJAC Manufacturing Systems &bull; V7.3.0 Engine &bull; All Rights Reserved
                </p>
            </div>
        </div>
    );
}
