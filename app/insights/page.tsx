'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { Job } from '@/types';
import { calculateDailyLoads, detectBottlenecks, DailyLoad } from '@/lib/analytics';
import { addDays, startOfWeek, endOfWeek, format, isSameDay } from 'date-fns';
import { AlertTriangle, TrendingUp, Calendar, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function InsightsPage() {
    const [loading, setLoading] = useState(true);
    const [loads, setLoads] = useState<DailyLoad[]>([]);
    const [bottlenecks, setBottlenecks] = useState<any[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch active jobs
                const q = query(
                    collection(db, 'jobs'),
                    where('status', 'in', ['PENDING', 'IN_PROGRESS']),
                    limit(200)
                );

                const snapshot = await getDocs(q);
                const jobs: Job[] = [];
                snapshot.forEach(doc => {
                    const data = doc.data() as Job;
                    // Ensure dates are Dates
                    if (data.scheduledStartDate && data.departmentSchedule) {
                        jobs.push({
                            ...data,
                            // Use raw data, assuming analytics helper handles casting or we cast here
                            // analytics helper expects Job object.
                            // Quick cast for safety:
                            // @ts-ignore
                            departmentSchedule: data.departmentSchedule
                        });
                    }
                });

                // Calculate loads for next 30 days
                const start = new Date();
                const end = addDays(start, 30);
                const dailyLoads = calculateDailyLoads(jobs, start, end);
                const alerts = detectBottlenecks(dailyLoads); // Uses department-specific capacity

                setLoads(dailyLoads);
                setBottlenecks(alerts);
            } catch (error) {
                console.error("Analytics Error", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const departments = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-sans">
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-8 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold text-white">Production Insights</h1>
                        <p className="text-slate-400 text-sm">Capacity Analysis & Bottleneck Detection</p>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Left Column: Bottlenecks */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="glass-panel p-6 rounded-xl border border-red-500/20 bg-red-950/10">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                            Critical Bottlenecks
                        </h3>

                        {loading ? (
                            <div className="animate-pulse h-20 bg-slate-800/50 rounded"></div>
                        ) : bottlenecks.length === 0 ? (
                            <div className="text-emerald-400 text-sm flex items-center gap-2 bg-emerald-950/20 p-3 rounded border border-emerald-500/20">
                                <TrendingUp className="w-4 h-4" />
                                No capacity issues detected.
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                {bottlenecks.map((alert, idx) => (
                                    <div key={idx} className="bg-slate-900/80 p-3 rounded border border-red-500/30 shadow-sm">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-bold text-red-200 text-sm">{alert.department}</span>
                                            <span className="text-xs text-red-400 font-mono">{format(alert.date, 'MMM dd')}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs">
                                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                <div className="h-full bg-red-500 w-full animate-pulse"></div>
                                            </div>
                                            <span className="text-red-300 font-bold">+{Math.round(alert.overload)} pts</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Capacity Chart */}
                <div className="lg:col-span-2">
                    <div className="glass-panel p-6 rounded-xl">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-cyan-500" />
                            30-Day Capacity Forecast
                        </h3>

                        {loading ? (
                            <div className="h-64 flex items-center justify-center text-slate-500">Loading forecast...</div>
                        ) : (
                            <div className="overflow-x-auto pb-4 custom-scrollbar">
                                <div className="min-w-[800px]">
                                    {/* Chart Header */}
                                    <div className="grid grid-cols-[100px_1fr] gap-4 mb-2 border-b border-slate-700 pb-2">
                                        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider text-right pr-2">Dept</div>
                                        <div className="flex justify-between text-xs text-slate-500 px-1">
                                            {loads.filter((_, i) => i % 2 === 0).map((load, i) => (
                                                <span key={i} className="w-8 text-center">{format(load.date, 'dd')}</span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Rows */}
                                    {departments.map(dept => (
                                        <div key={dept} className="grid grid-cols-[100px_1fr] gap-4 mb-3 items-center hover:bg-white/5 rounded transition-colors p-1">
                                            <div className="text-xs font-medium text-slate-300 text-right pr-2">{dept}</div>
                                            <div className="flex justify-between gap-0.5 h-8 relative">
                                                {/* Capacity Line */}
                                                <div className="absolute top-0 left-0 right-0 h-full pointer-events-none opacity-10 border-t border-b border-slate-500 border-dashed"></div>

                                                {loads.map((load, i) => {
                                                    // @ts-ignore
                                                    const points = load.departments[dept] || 0;
                                                    const intensity = Math.min(points / 200, 1.5); // 1.0 = 100% cap

                                                    let colorClass = 'bg-slate-700';
                                                    if (points > 0) colorClass = 'bg-cyan-600/50';
                                                    if (points > 150) colorClass = 'bg-orange-500/70';
                                                    if (points > 200) colorClass = 'bg-red-500';

                                                    return (
                                                        <div key={i} className="flex-1 flex flex-col justify-end h-full relative group">
                                                            <div
                                                                className={`w-full rounded-sm transition-all ${colorClass}`}
                                                                style={{ height: `${Math.min((points / 300) * 100, 100)}%` }}
                                                            ></div>

                                                            {/* Tooltip */}
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 z-10 pointer-events-none">
                                                                {format(load.date, 'M/d')}: {Math.round(points)} pts
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="mt-4 flex gap-4 text-xs text-slate-500 justify-center">
                            <span className="flex items-center"><span className="w-2 h-2 rounded bg-cyan-600/50 mr-2"></span>Normal Load</span>
                            <span className="flex items-center"><span className="w-2 h-2 rounded bg-orange-500/70 mr-2"></span>Heavy (75%+)</span>
                            <span className="flex items-center"><span className="w-2 h-2 rounded bg-red-500 mr-2"></span>Over Capacity (100%+)</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
