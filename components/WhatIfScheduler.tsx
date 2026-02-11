'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
} from '@/lib/whatIfScheduler';
import { BIG_ROCK_CONFIG } from '@/lib/scoringConfig';
import type { ParsedSalesAcknowledgment } from '@/lib/parseSalesAcknowledgment';
import { format } from 'date-fns';

interface QuoteEstimatorProps {
    existingJobs: Job[];
}

export default function WhatIfScheduler({ existingJobs }: QuoteEstimatorProps) {
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

    // PDF upload state
    const [parsedPdf, setParsedPdf] = useState<ParsedSalesAcknowledgment | null>(null);
    const [pdfUploading, setPdfUploading] = useState(false);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);

    const handlePdfUpload = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setPdfError('Please upload a PDF file');
            return;
        }
        setPdfUploading(true);
        setPdfError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/api/parse-pdf', { method: 'POST', body: formData });
            const result = await res.json();

            if (!res.ok) {
                setPdfError(result.error || 'Failed to parse PDF');
                return;
            }

            const data: ParsedSalesAcknowledgment = result.data;
            setParsedPdf(data);

            // Auto-fill form fields
            setTotalValue(data.orderSubTotal.toString());
            setTotalQuantity(data.totalQuantity.toString());

            // Auto-detect Big Rocks (items whose individual welding points ≥ BIG_ROCK_CONFIG.threshold)
            const bigRockThresholdDollars = BIG_ROCK_CONFIG.threshold * 650; // reverse the $/point ratio
            const detectedBigRocks = data.lineItems
                .filter(item => item.extension >= bigRockThresholdDollars)
                .map(item => ({
                    value: item.extension,
                    points: convertDollarToPoints(item.extension),
                }));

            if (detectedBigRocks.length > 0) {
                setHasBigRocks(true);
                setBigRocks(detectedBigRocks);
            }

            // Auto-set target date from ship date
            if (data.scheduledDate) {
                const parsed = new Date(data.scheduledDate);
                if (!isNaN(parsed.getTime())) {
                    setMode('TARGET');
                    setTargetDate(format(parsed, 'yyyy-MM-dd'));
                }
            }

            // Clear any previous results
            setEstimate(null);
            setFeasibility(null);
        } catch (err) {
            console.error('PDF upload error:', err);
            setPdfError('Failed to upload and parse PDF');
        } finally {
            setPdfUploading(false);
        }
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.items?.[0]?.type === 'application/pdf') setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) { setIsDragging(false); dragCounterRef.current = 0; }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragCounterRef.current = 0;
        const file = e.dataTransfer.files?.[0];
        if (file) handlePdfUpload(file);
    }, [handlePdfUpload]);

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
        <div className="min-h-screen bg-[#181818] py-12 px-4 sm:px-6">
            <div className="max-w-4xl mx-auto">
                <div className="bg-[#1e1e1e] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden border border-[#333]">
                    {/* Header Section */}
                    <div className="bg-gradient-to-r from-[#1e1e1e] via-[#262626] to-[#1e1e1e] px-8 py-10 text-white relative overflow-hidden border-b border-[#383838]">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full blur-[120px] opacity-[0.05] -mr-32 -mt-32"></div>
                        <h1 className="text-3xl font-extrabold tracking-tight mb-2 text-white">What If Scheduler</h1>
                        <p className="text-[#aaa] text-lg max-w-lg">
                            Enterprise-grade scheduling and point estimation for prospective fabrication jobs.
                        </p>
                    </div>

                    <div className="p-8 lg:p-12">
                        {/* Input Form */}
                        <div className="space-y-10">
                            {/* Sales Acknowledgment PDF Upload */}
                            <section>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-1 h-6 bg-amber-500 rounded-full"></div>
                                    <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">Quick Import</h2>
                                </div>

                                <div
                                    onDragEnter={handleDragEnter}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`relative cursor-pointer border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200 ${isDragging
                                        ? 'border-amber-500 bg-amber-500/10 scale-[1.01]'
                                        : parsedPdf
                                            ? 'border-emerald-600/50 bg-emerald-950/20 hover:border-emerald-500/70'
                                            : 'border-[#444] hover:border-[#666] bg-[#242424] hover:bg-[#2a2a2a]'
                                        }`}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handlePdfUpload(file);
                                            e.target.value = '';
                                        }}
                                    />

                                    {pdfUploading ? (
                                        <div className="flex flex-col items-center gap-3">
                                            <svg className="animate-spin h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            <p className="text-sm text-amber-400 font-bold">Parsing sales acknowledgment…</p>
                                        </div>
                                    ) : parsedPdf ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                                            </div>
                                            <p className="text-sm font-bold text-emerald-400">Imported: WO#{parsedPdf.workOrder}</p>
                                            <p className="text-xs text-[#888]">{parsedPdf.jobName} • {parsedPdf.lineItems.length} items • ${parsedPdf.orderSubTotal.toLocaleString()}</p>
                                            <p className="text-[10px] text-[#666] mt-1">Click or drop another PDF to replace</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="w-10 h-10 rounded-xl bg-[#333] flex items-center justify-center">
                                                <svg className="w-5 h-5 text-[#888]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                                            </div>
                                            <p className="text-sm font-semibold text-[#bbb]">Drop a Sales Acknowledgment PDF here</p>
                                            <p className="text-xs text-[#666]">or click to browse • Auto-fills all fields below</p>
                                        </div>
                                    )}
                                </div>

                                {pdfError && (
                                    <div className="mt-3 px-4 py-2.5 bg-red-950/30 border border-red-800/40 rounded-xl text-red-400 text-xs font-medium">
                                        {pdfError}
                                    </div>
                                )}

                                {/* Parsed Line Items Preview */}
                                {parsedPdf && parsedPdf.lineItems.length > 0 && (
                                    <div className="mt-4 bg-[#1e1e1e] border border-[#333] rounded-xl overflow-hidden">
                                        <div className="px-4 py-2.5 border-b border-[#333] flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-[#888]">Line Items ({parsedPdf.lineItems.length})</span>
                                            <span className="text-[10px] font-bold text-[#666]">Ship: {parsedPdf.scheduledDate}</span>
                                        </div>
                                        <div className="max-h-48 overflow-y-auto">
                                            {parsedPdf.lineItems.map((item, idx) => {
                                                const pts = convertDollarToPoints(item.extension);
                                                const isBigRock = pts >= BIG_ROCK_CONFIG.threshold;
                                                return (
                                                    <div key={idx} className={`flex items-center gap-3 px-4 py-2 text-xs border-b border-[#2a2a2a] last:border-0 ${isBigRock ? 'bg-amber-950/20' : ''}`}>
                                                        <span className="font-mono text-[#666] w-7 shrink-0">{item.itemNumber.replace('S', '')}</span>
                                                        <span className="text-[#bbb] flex-1 truncate">{item.description}</span>
                                                        <span className="text-[#888] shrink-0">×{item.quantity}</span>
                                                        <span className="text-[#aaa] font-mono shrink-0 w-20 text-right">${item.extension.toLocaleString()}</span>
                                                        <span className={`font-mono shrink-0 w-14 text-right ${isBigRock ? 'text-amber-400 font-bold' : 'text-[#666]'}`}>{pts.toFixed(1)}pt</span>
                                                        {isBigRock && <span className="text-[8px] font-black uppercase px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">BR</span>}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </section>

                            {/* Section: Job Fundamentals */}
                            <section>
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-1 h-6 bg-[#aaa] rounded-full"></div>
                                    <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">Job Fundamentals</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-[#bbb]">
                                            Total Job Value ($)
                                        </label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#888]">$</span>
                                            <input
                                                type="number"
                                                value={totalValue}
                                                onChange={(e) => setTotalValue(e.target.value)}
                                                className="w-full pl-8 pr-4 py-3 bg-[#2a2a2a] border border-[#444] rounded-xl text-white focus:ring-2 focus:ring-[#666] focus:border-[#666] transition-all outline-none placeholder-[#666]"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-[#bbb]">
                                            Total Quantity (Items)
                                        </label>
                                        <input
                                            type="number"
                                            value={totalQuantity}
                                            onChange={(e) => setTotalQuantity(e.target.value)}
                                            className="w-full px-4 py-3 bg-[#2a2a2a] border border-[#444] rounded-xl text-white focus:ring-2 focus:ring-[#666] focus:border-[#666] transition-all outline-none placeholder-[#666]"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Section: Item Complexity */}
                            <section className="bg-[#242424] rounded-2xl p-6 border border-[#383838]">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-1 h-6 bg-[#aaa] rounded-full"></div>
                                        <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">Item Complexity</h2>
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
                                                className="w-5 h-5 border-[#555] rounded bg-[#333] text-[#bbb] focus:ring-[#666] transition-all"
                                            />
                                            <span className="text-sm font-medium text-[#bbb] group-hover:text-white transition-colors">Contains Big Rocks</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                checked={isREF}
                                                onChange={(e) => setIsREF(e.target.checked)}
                                                className="w-5 h-5 border-[#555] rounded bg-[#333] text-[#bbb] focus:ring-[#666] transition-all"
                                            />
                                            <span className="text-sm font-medium text-[#bbb] group-hover:text-white transition-colors">REF Speciality</span>
                                        </label>
                                    </div>
                                </div>

                                {hasBigRocks && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
                                        <div className="grid gap-3">
                                            {bigRocks.map((br, index) => (
                                                <div key={index} className="flex items-center gap-3 bg-[#2a2a2a] p-3 rounded-xl border border-[#383838]">
                                                    <div className="flex-1 flex items-center gap-3 px-2">
                                                        <span className="text-xs font-bold text-[#888] uppercase w-20">Rock {index + 1}</span>
                                                        <span className="text-[#888]">$</span>
                                                        <input
                                                            type="number"
                                                            value={br.value || ''}
                                                            onChange={(e) => updateBigRockValue(index, e.target.value)}
                                                            className="flex-1 min-w-0 bg-transparent py-1 font-medium text-white outline-none placeholder-[#555]"
                                                            placeholder="Value"
                                                        />
                                                        <span className="hidden sm:inline-block text-xs font-bold px-3 py-1 bg-[#333] text-[#ccc] rounded-lg border border-[#444]">
                                                            {br.points?.toFixed(1) || 0} PTS
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={() => removeBigRock(index)}
                                                        className="p-2 text-[#777] hover:text-red-400 transition-colors"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={addBigRock}
                                            className="w-full py-3 border-2 border-dashed border-[#444] rounded-xl text-[#999] hover:border-[#666] hover:text-[#ccc] hover:bg-[#2a2a2a] transition-all font-semibold text-sm"
                                        >
                                            + Add Big Rock Definition
                                        </button>

                                        {pointsCalc && hasBigRocks && bigRocks.length > 0 && (
                                            <div className="p-4 bg-gradient-to-r from-[#2a2a2a] to-[#333] rounded-xl text-white border border-[#444]">
                                                <p className="text-sm text-[#bbb]">
                                                    <strong className="text-[#ccc]">Remaining Scope:</strong> ${pointsCalc.remainingValue.toLocaleString()} across {Math.max(0, (parseInt(totalQuantity) || 0) - bigRocks.length)} items
                                                </p>
                                                <p className="text-lg font-bold mt-1 text-white">
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
                                    <div className="w-1 h-6 bg-[#aaa] rounded-full"></div>
                                    <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">Delivery Timing</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="block text-sm font-semibold text-[#bbb]">Engineering Ready Date</label>
                                            <input
                                                type="date"
                                                value={engineeringDate}
                                                onChange={(e) => setEngineeringDate(e.target.value)}
                                                className="w-full px-4 py-3 bg-[#2a2a2a] border border-[#444] rounded-xl text-white focus:ring-2 focus:ring-[#666] outline-none transition-all"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <label className="block text-sm font-semibold text-[#bbb]">Scheduling Mode</label>
                                        <div className="grid grid-cols-1 gap-3">
                                            <button
                                                onClick={() => setMode('EARLIEST')}
                                                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${mode === 'EARLIEST' ? 'border-[#777] bg-[#2a2a2a] text-white scale-[1.02]' : 'border-[#333] bg-[#242424] text-[#aaa] hover:border-[#444]'}`}
                                            >
                                                <span className="font-bold">Earliest Availability</span>
                                                {mode === 'EARLIEST' && <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.3)]"></div>}
                                            </button>
                                            <button
                                                onClick={() => setMode('TARGET')}
                                                className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${mode === 'TARGET' ? 'border-[#777] bg-[#2a2a2a] text-white scale-[1.02]' : 'border-[#333] bg-[#242424] text-[#aaa] hover:border-[#444]'}`}
                                            >
                                                <span className="font-bold">Specific Target Date</span>
                                                {mode === 'TARGET' && <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.3)]"></div>}
                                            </button>
                                        </div>
                                        {mode === 'TARGET' && (
                                            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                                <input
                                                    type="date"
                                                    value={targetDate}
                                                    onChange={(e) => setTargetDate(e.target.value)}
                                                    className="w-full px-4 py-3 bg-[#2a2a2a] border-2 border-[#555] rounded-xl text-white focus:ring-4 focus:ring-[#444] outline-none transition-all"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>

                            <button
                                onClick={calculateEstimate}
                                disabled={loading}
                                className="w-full py-5 bg-gradient-to-r from-[#444] to-[#555] hover:from-[#555] hover:to-[#666] text-white rounded-xl font-bold text-lg shadow-xl shadow-black/30 transition-all hover:-translate-y-1 active:scale-95 disabled:from-[#333] disabled:to-[#333] disabled:text-[#666] disabled:shadow-none disabled:translate-y-0 border border-[#666]"
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
                            <div className="mt-16 space-y-12 pt-12 border-t border-[#383838] animate-in fade-in slide-in-from-bottom-8 duration-500">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-3xl font-black text-white">Estimation Results</h2>
                                    <div className="flex gap-2">
                                        {estimate.isBigRock && (
                                            <span className="px-4 py-1.5 bg-[#333] text-[#ddd] text-[10px] font-black uppercase tracking-widest rounded-full border border-[#555]">Big Rock Class</span>
                                        )}
                                        {isREF && (
                                            <span className="px-4 py-1.5 bg-[#333] text-[#ddd] text-[10px] font-black uppercase tracking-widest rounded-full border border-[#555]">Ref Module</span>
                                        )}
                                    </div>
                                </div>

                                {/* Primary Metrics */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="bg-[#242424] p-6 rounded-2xl border border-[#383838] group hover:border-[#555] hover:bg-[#2a2a2a] transition-all">
                                        <p className="text-xs font-bold text-[#888] uppercase tracking-widest mb-4">Total Weld Points</p>
                                        <p className="text-4xl font-black text-white tracking-tight">{estimate.totalPoints.toFixed(1)}<span className="text-lg ml-1 text-[#888] font-medium">pts</span></p>
                                    </div>
                                    <div className="bg-[#242424] p-6 rounded-2xl border border-[#383838] group hover:border-[#555] hover:bg-[#2a2a2a] transition-all">
                                        <p className="text-xs font-bold text-[#888] uppercase tracking-widest mb-4">Urgency Factor</p>
                                        <p className="text-4xl font-black text-white tracking-tight">{estimate.urgencyScore.toFixed(0)}<span className="text-lg ml-1 text-[#888] font-medium">%</span></p>
                                    </div>
                                    <div className="bg-gradient-to-br from-[#333] to-[#444] p-8 rounded-2xl text-white border border-[#555]">
                                        <p className="text-xs font-bold text-[#bbb] uppercase tracking-widest mb-4">Projected Finish</p>
                                        <p className="text-2xl font-black leading-tight">
                                            {format(estimate.estimatedCompletion, 'MMM')} <span className="text-4xl">{format(estimate.estimatedCompletion, 'dd')}</span>
                                        </p>
                                        <p className="text-sm font-bold text-[#aaa] mt-1">{format(estimate.estimatedCompletion, 'yyyy')}</p>
                                    </div>
                                </div>

                                {/* Feasibility Drilldown */}
                                {feasibility && mode === 'TARGET' && (
                                    <section className="space-y-8">
                                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                            <svg className="w-6 h-6 text-[#aaa]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            Capacity & Feasibility Analysis
                                        </h3>

                                        {/* Master Recommendation Card */}
                                        <div className={`rounded-2xl p-px ${feasibility.recommendation === 'ACCEPT' ? 'bg-gradient-to-br from-emerald-500/50 to-emerald-700/50' :
                                            feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'bg-gradient-to-br from-amber-500/50 to-amber-700/50' :
                                                feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'bg-gradient-to-br from-orange-500/50 to-orange-700/50' :
                                                    'bg-gradient-to-br from-[#444] to-[#666]'
                                            }`}>
                                            <div className="bg-[#1e1e1e] rounded-2xl p-8">
                                                <div className="flex flex-col md:flex-row md:items-center gap-6">
                                                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${feasibility.recommendation === 'ACCEPT' ? 'bg-emerald-500/20 text-emerald-400' :
                                                        feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? 'bg-amber-500/20 text-amber-400' :
                                                            feasibility.recommendation === 'ACCEPT_WITH_OT' ? 'bg-orange-500/20 text-orange-400' :
                                                                'bg-[#333] text-[#aaa]'
                                                        }`}>
                                                        <span className="text-3xl">
                                                            {feasibility.recommendation === 'ACCEPT' ? '✓' :
                                                                feasibility.recommendation === 'ACCEPT_WITH_MOVES' ? '!' :
                                                                    feasibility.recommendation === 'ACCEPT_WITH_OT' ? '+' : '✕'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <h4 className="text-2xl font-black text-white leading-none mb-2">
                                                            {feasibility.recommendation.replace(/_/g, ' ')}
                                                        </h4>
                                                        <p className="text-[#bbb] font-medium leading-relaxed max-w-2xl">{feasibility.explanation}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Tiers Grid */}
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                            {/* Tier 1 */}
                                            <div className="bg-[#242424] border border-[#383838] rounded-2xl p-6 relative overflow-hidden group hover:border-[#555] transition-all">
                                                <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:scale-110 transition-transform">
                                                    <span className="text-5xl font-black text-white">01</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.asIs.achievable ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-[#555]'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-[#888]">As-Is Schedule</span>
                                                </div>
                                                <p className="text-sm font-bold text-[#ccc] mb-2">Completion Status:</p>
                                                <p className="text-sm text-[#bbb]">
                                                    {feasibility.asIs.achievable
                                                        ? `Achievable by ${format(feasibility.asIs.completionDate!, 'MMM dd')}`
                                                        : 'Capacity overflow detected'
                                                    }
                                                </p>
                                                {feasibility.asIs.bottlenecks.length > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-[#383838] space-y-2">
                                                        <span className="text-[10px] font-black uppercase text-[#888]">Capacity Bottlenecks</span>
                                                        {feasibility.asIs.bottlenecks.map((b, i) => (
                                                            <div key={i} className="flex items-center justify-between bg-[#1e1e1e] px-3 py-2 rounded-lg border border-[#333]">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                                    <span className="text-xs font-bold text-[#ccc]">{b.department}</span>
                                                                    <span className="text-[10px] text-[#888]">+{b.delayDays}d delay</span>
                                                                </div>
                                                                <span className="text-[10px] font-bold text-amber-400">
                                                                    Available {format(b.firstAvailableDate, 'MMM dd')}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Tier 2 */}
                                            <div className="bg-[#242424] border border-[#383838] rounded-2xl p-6 relative overflow-hidden group hover:border-[#555] transition-all">
                                                <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:scale-110 transition-transform">
                                                    <span className="text-5xl font-black text-white">02</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.withMoves.achievable ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-[#555]'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-[#888]">Adaptive Re-routing</span>
                                                </div>
                                                <p className="text-sm font-bold text-[#ccc] mb-2">Affected Scale:</p>
                                                <p className="text-sm text-[#bbb]">
                                                    {feasibility.withMoves.achievable
                                                        ? `${feasibility.withMoves.totalJobsAffected} jobs • ${Math.round(feasibility.withMoves.capacityFreed)} pts freed`
                                                        : 'Moves alone not sufficient'
                                                    }
                                                </p>
                                                {feasibility.withMoves.achievable && feasibility.withMoves.completionDate && (
                                                    <p className="text-xs text-emerald-400 font-bold mt-2">✓ Complete by {format(feasibility.withMoves.completionDate, 'MMM dd')}</p>
                                                )}
                                            </div>

                                            {/* Tier 3 */}
                                            <div className="bg-[#2a2a2a] border border-[#444] rounded-2xl p-6 relative overflow-hidden group hover:border-[#666] transition-all">
                                                <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:scale-110 transition-transform">
                                                    <span className="text-5xl font-black text-white">03</span>
                                                </div>
                                                <div className="flex items-center gap-2 mb-6">
                                                    <div className={`w-2 h-2 rounded-full ${feasibility.withOT.achievable ? 'bg-orange-500 shadow-[0_0_8px_#f97316]' : 'bg-[#555]'}`}></div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-[#888]">Overtime Required</span>
                                                </div>
                                                {feasibility.withOT.recommendedTier ? (
                                                    <>
                                                        <p className="text-sm font-bold text-[#ccc] mb-1">Recommended: Tier {feasibility.withOT.recommendedTier}</p>
                                                        <p className="text-sm text-[#bbb]">
                                                            {feasibility.withOT.otWeeks.length > 0
                                                                ? `${feasibility.withOT.otWeeks[0]?.tierLabel}`
                                                                : 'No additional OT weeks needed'}
                                                        </p>
                                                        {feasibility.withOT.otWeeks.length > 0 && (
                                                            <div className="mt-3 pt-3 border-t border-[#383838] space-y-1.5">
                                                                <span className="text-[9px] font-black uppercase text-[#666] tracking-wider">OT needed only during:</span>
                                                                {feasibility.withOT.otWeeks.map((ot, i) => (
                                                                    <div key={i} className="flex items-center justify-between text-[10px]">
                                                                        <span className="text-orange-300 font-medium">{ot.department} — wk of {format(new Date(ot.weekKey), 'MMM dd')}</span>
                                                                        <span className="text-[#888]">+{ot.excess}pts over base</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
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
                                <div className="bg-[#242424] rounded-2xl p-8 lg:p-10 border border-[#383838]">
                                    <h3 className="text-xl font-black text-white uppercase tracking-tight mb-8">Execution Roadmap</h3>
                                    <div className="grid gap-4">
                                        {estimate.timeline.map((dept, idx) => (
                                            <div key={dept.department} className="flex flex-col sm:flex-row sm:items-center gap-4 bg-[#2a2a2a] p-4 rounded-xl border border-[#383838] group hover:border-[#555] transition-all">
                                                <div className="sm:w-36 shrink-0">
                                                    <span className="text-xs font-black text-[#777] uppercase tracking-widest block mb-1">Process {idx + 1}</span>
                                                    <span className="font-bold text-[#ccc] text-sm">{dept.department}</span>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between text-[10px] font-black uppercase text-[#888] mb-2">
                                                        <span>{format(dept.startDate, 'MMM dd')} Launch</span>
                                                        <span>{dept.duration} Shop Days</span>
                                                        <span>{format(dept.endDate, 'MMM dd')} Handoff</span>
                                                    </div>
                                                    <div className="h-3 bg-[#333] rounded-full overflow-hidden relative">
                                                        <div
                                                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#666] to-[#999] rounded-full group-hover:from-[#888] group-hover:to-[#bbb] transition-colors duration-500"
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

                <p className="text-center text-[#777] text-xs mt-8 font-medium">
                    &copy; {new Date().getFullYear()} EMJAC Manufacturing Systems &bull; V7.3.0 Engine &bull; All Rights Reserved
                </p>
            </div>
        </div>
    );
}
