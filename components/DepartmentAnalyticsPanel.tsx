import React, { useMemo } from 'react';
import { Job, Department } from '@/types';
import { calculateDepartmentTotals } from '@/lib/analytics';
import { DEPARTMENT_CONFIG, DEPT_ORDER } from '@/lib/departmentConfig';
import { format } from 'date-fns';

interface DepartmentAnalyticsPanelProps {
    jobs: Job[];
    selectedDates: Date[];
    dateRange?: { start: Date; end: Date };
    splitByProductType?: boolean;
    visibleDepartments?: Set<Department>;
}

export default function DepartmentAnalyticsPanel({
    jobs,
    selectedDates,
    dateRange,
    splitByProductType = false,
    visibleDepartments
}: DepartmentAnalyticsPanelProps) {
    const totals = useMemo(() => {
        return calculateDepartmentTotals(jobs, selectedDates);
    }, [jobs, selectedDates]);

    const hasSelection = selectedDates.length > 0;

    // Calculate max value for bar scaling
    const maxPoints = Math.max(...Object.values(totals).map(d => d.total), 100);

    const sortedDates = useMemo(() => {
        return [...selectedDates].sort((a, b) => a.getTime() - b.getTime());
    }, [selectedDates]);

    return (
        <div className="h-full bg-slate-950 border-l border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-800 bg-slate-900/50">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-purple-500 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.4)]"></span>
                    Dept. Analytics
                </h2>
                {hasSelection ? (
                    <div className="mt-2 text-xs text-slate-400">
                        Selected: <span className="text-white font-mono font-semibold">
                            {sortedDates.length === 1
                                ? format(sortedDates[0], 'MMM d')
                                : `${format(sortedDates[0], 'MMM d')} - ${format(sortedDates[sortedDates.length - 1], 'MMM d')}`
                            }
                        </span>
                        <span className="ml-2 opacity-50">({sortedDates.length} days)</span>
                    </div>
                ) : (
                    <p className="text-xs text-slate-500 mt-1">Select dates in value stream header to view capacity.</p>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {hasSelection ? (
                    <div className="space-y-5">
                        {DEPT_ORDER.map(dept => {
                            // Filter by visible departments if specified
                            if (visibleDepartments && visibleDepartments.size > 0 && !visibleDepartments.has(dept)) {
                                return null;
                            }

                            const config = DEPARTMENT_CONFIG[dept];
                            const deptData = totals[dept] || { total: 0, byType: { FAB: 0, DOORS: 0, HARMONIC: 0 } };

                            const totalPoints = deptData.total;
                            const splitData = deptData.byType;

                            // Calculate daily average for context
                            const dailyAvg = totalPoints / selectedDates.length;
                            const capacity = config.dailyCapacity;
                            const capacityPct = (dailyAvg / capacity) * 100;

                            const isOverloaded = dailyAvg > capacity;
                            const isNearLimit = dailyAvg > capacity * 0.9;

                            let statusColor = config.color; // default
                            if (isOverloaded) statusColor = 'red';
                            else if (isNearLimit) statusColor = 'amber';

                            return (
                                <div key={dept} className="group">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-sm"
                                                style={{ backgroundColor: config.color }}
                                            ></div>
                                            <span className="text-xs font-semibold text-slate-300 group-hover:text-white transition-colors">
                                                {dept}
                                            </span>
                                        </div>
                                        <div className="text-xs font-mono text-slate-400">
                                            <span className={`font-bold ${isOverloaded ? 'text-red-400' : 'text-white'}`}>
                                                {Math.round(totalPoints)}
                                            </span>
                                            <span className="text-slate-600 ml-1">pts</span>
                                        </div>
                                    </div>

                                    {/* Progress Bar Container */}
                                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden relative flex">
                                        {splitByProductType ? (
                                            <>
                                                {/* FAB - Blue */}
                                                <div
                                                    className="h-full bg-blue-500 transition-all duration-500 hover:brightness-110"
                                                    style={{ width: `${(splitData.FAB / maxPoints) * 100}%` }}
                                                    title={`Fab: ${Math.round(splitData.FAB)}`}
                                                />
                                                {/* DOORS - Green */}
                                                <div
                                                    className="h-full bg-emerald-500 transition-all duration-500 hover:brightness-110"
                                                    style={{ width: `${(splitData.DOORS / maxPoints) * 100}%` }}
                                                    title={`Doors: ${Math.round(splitData.DOORS)}`}
                                                />
                                                {/* HARMONIC - Purple */}
                                                <div
                                                    className="h-full bg-violet-500 transition-all duration-500 hover:brightness-110"
                                                    style={{ width: `${(splitData.HARMONIC / maxPoints) * 100}%` }}
                                                    title={`Harmonic: ${Math.round(splitData.HARMONIC)}`}
                                                />
                                            </>
                                        ) : (
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{
                                                    width: `${Math.min(100, (totalPoints / maxPoints) * 100)}%`,
                                                    backgroundColor: isOverloaded ? '#ef4444' : config.color,
                                                    boxShadow: isOverloaded ? '0 0 8px rgba(239, 68, 68, 0.5)' : 'none'
                                                }}
                                            ></div>
                                        )}
                                    </div>

                                    {/* Daily Average Context */}
                                    <div className="flex justify-between items-center mt-1 text-[10px] text-slate-500">
                                        <span>Avg: {Math.round(dailyAvg)}/day</span>
                                        <span className={isOverloaded ? 'text-red-500 font-bold' : (isNearLimit ? 'text-amber-500' : 'text-slate-600')}>
                                            {Math.round(capacityPct)}% Cap
                                        </span>
                                    </div>

                                    {/* Split Breakdown Text (optional detail) */}
                                    {splitByProductType && (
                                        <div className="flex justify-end gap-2 mt-0.5 text-[9px] font-mono opacity-60">
                                            <span className="text-blue-400">F:{Math.round(splitData.FAB)}</span>
                                            <span className="text-emerald-400">D:{Math.round(splitData.DOORS)}</span>
                                            <span className="text-violet-400">H:{Math.round(splitData.HARMONIC)}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-600 space-y-2 opacity-60">
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-2">
                            <span className="text-xl">📅</span>
                        </div>
                        <p className="text-xs text-center">Click date headers<br />to inspect capacity</p>
                    </div>
                )}
            </div>

            {/* Total Summary Footer */}
            {hasSelection && (
                <div className="p-4 border-t border-slate-800 bg-slate-900/30">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-medium text-slate-400">Total Selection Load</span>
                        <span className="text-sm font-bold text-white font-mono">
                            {Math.round(Object.values(totals).reduce((sum, dept) => sum + dept.total, 0))} pts
                        </span>
                    </div>
                    <div className="text-[10px] text-slate-500 text-right">
                        Across {selectedDates.length} days
                    </div>
                </div>
            )}
        </div>
    );
}
