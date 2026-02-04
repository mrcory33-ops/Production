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
        <div className="h-full bg-slate-100 border-l border-slate-300 flex flex-col shadow-xl">
            <div className="p-4 border-b border-slate-200 bg-white shadow-sm">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-blue-600 rounded-full shadow-sm"></span>
                    Dept. Analytics
                </h2>
                {hasSelection ? (
                    <div className="mt-2 text-xs text-slate-500">
                        Selected: <span className="text-slate-900 font-mono font-bold">
                            {sortedDates.length === 1
                                ? format(sortedDates[0], 'MMM d')
                                : `${format(sortedDates[0], 'MMM d')} - ${format(sortedDates[sortedDates.length - 1], 'MMM d')}`
                            }
                        </span>
                        <span className="ml-2 opacity-50">({sortedDates.length} days)</span>
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 mt-1">Select dates in value stream header to view capacity.</p>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50">
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
                            if (isOverloaded) statusColor = '#ef4444';
                            else if (isNearLimit) statusColor = '#f59e0b';

                            return (
                                <div key={dept} className="group bg-white p-3 rounded-lg border border-slate-200 shadow-sm transition-all hover:shadow-md">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2.5 h-2.5 rounded-sm shadow-sm"
                                                style={{ backgroundColor: config.color }}
                                            ></div>
                                            <span className="text-xs font-bold text-slate-700 group-hover:text-blue-700 transition-colors">
                                                {dept}
                                            </span>
                                        </div>
                                        <div className="text-xs font-mono text-slate-500">
                                            <span className={`font-bold ${isOverloaded ? 'text-red-600' : 'text-slate-900'}`}>
                                                {Math.round(totalPoints)}
                                            </span>
                                            <span className="text-slate-400 ml-1">pts</span>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center text-[10px] font-medium">
                                            <span className="text-slate-500">Avg Load: {Math.round(dailyAvg)}/day</span>
                                            <span className={isOverloaded ? 'text-red-600 font-bold' : isNearLimit ? 'text-amber-600' : 'text-slate-600'}>
                                                {Math.round(capacityPct)}%
                                            </span>
                                        </div>
                                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                                            <div
                                                className="h-full transition-all duration-500 shadow-inner"
                                                style={{
                                                    width: `${Math.min(capacityPct, 100)}%`,
                                                    backgroundColor: statusColor
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {splitByProductType && totalPoints > 0 && (
                                        <div className="mt-3 pt-2 border-t border-slate-100 flex gap-3 text-[9px] font-bold">
                                            <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">F:{Math.round(splitData.FAB)}</span>
                                            <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">D:{Math.round(splitData.DOORS)}</span>
                                            <span className="text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">H:{Math.round(splitData.HARMONIC)}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 space-y-2">
                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-2 shadow-inner">
                            <span className="text-xl">📅</span>
                        </div>
                        <p className="text-xs text-center">Click date headers<br />to inspect capacity</p>
                    </div>
                )}
            </div>

            {/* Total Summary Footer */}
            {hasSelection && (
                <div className="p-4 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-semibold text-slate-500">Total Selection Load</span>
                        <span className="text-sm font-bold text-slate-900 font-mono">
                            {Math.round(Object.values(totals).reduce((sum, dept) => sum + dept.total, 0))} pts
                        </span>
                    </div>
                    <div className="text-[10px] text-slate-400 text-right font-medium">
                        Across {selectedDates.length} days
                    </div>
                </div>
            )}
        </div>
    );
}
