'use client';

import { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Clock, Layers, Zap } from 'lucide-react';
import { Job } from '@/types';
import { calculateQueueHealth, getHealthColor, getHealthLabel, type DepartmentQueueHealth, type HealthStatus } from '@/lib/queueHealth';

// ─────────────────────────────────────────────────────────────
// Health Status Indicator
// ─────────────────────────────────────────────────────────────

const HealthDot = ({ health }: { health: HealthStatus }) => {
    const color = getHealthColor(health);
    const isPulsing = health === 'STARVED' || health === 'OVERLOADED';

    return (
        <span className="relative flex h-3 w-3">
            {isPulsing && (
                <span
                    className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40"
                    style={{ backgroundColor: color }}
                />
            )}
            <span
                className="relative inline-flex rounded-full h-3 w-3"
                style={{ backgroundColor: color }}
            />
        </span>
    );
};

// ─────────────────────────────────────────────────────────────
// Department Card
// ─────────────────────────────────────────────────────────────

const DeptCard = ({ data }: { data: DepartmentQueueHealth }) => {
    const healthColor = getHealthColor(data.health);
    const healthLabel = getHealthLabel(data.health);

    return (
        <div
            className="rounded-xl border bg-slate-950/70 p-4 transition-all hover:bg-slate-900/80"
            style={{ borderColor: `${data.color}30` }}
        >
            {/* Header: Department name + health dot */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <HealthDot health={data.health} />
                    <span className="text-sm font-bold text-white">{data.department}</span>
                </div>
                <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
                    style={{
                        backgroundColor: `${healthColor}20`,
                        color: healthColor,
                    }}
                >
                    {healthLabel}
                </span>
            </div>

            {/* Primary metric: Points on hand */}
            <div className="mb-3">
                <div className="flex items-end gap-1.5">
                    <span className="text-3xl font-bold text-white tabular-nums">
                        {data.pointsOnHand.toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-500 pb-1">pts</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 uppercase tracking-wider">Points on Hand</p>

                {/* FAB / DOORS / HARMONIC breakdown */}
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {data.pointsByProductType.FAB > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-semibold tabular-nums">
                            F {data.pointsByProductType.FAB.toLocaleString()}
                        </span>
                    )}
                    {data.pointsByProductType.DOORS > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-semibold tabular-nums">
                            D {data.pointsByProductType.DOORS.toLocaleString()}
                        </span>
                    )}
                    {data.pointsByProductType.HARMONIC > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 font-semibold tabular-nums">
                            H {data.pointsByProductType.HARMONIC.toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            {/* Secondary metrics */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>
                        <span className="text-slate-200 font-semibold tabular-nums">{data.daysOfWork}</span> days
                    </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                    <Layers className="w-3 h-3 text-slate-500" />
                    <span>
                        <span className="text-slate-200 font-semibold tabular-nums">{data.jobsInQueue}</span> jobs
                    </span>
                </div>
            </div>

            {/* Utilization bar */}
            <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Week Util.</span>
                    <span className="text-[10px] text-slate-400 font-semibold tabular-nums">{data.utilizationPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                            width: `${Math.min(data.utilizationPct, 100)}%`,
                            backgroundColor: healthColor,
                        }}
                    />
                </div>
            </div>

            {/* OT indicator */}
            <div className="mt-3 pt-2 border-t border-slate-800">
                {data.otUseful ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                        <Zap className="w-3 h-3" />
                        <span className="font-semibold">OT Useful</span>
                        <span className="text-slate-500">— backlog could absorb extra hours</span>
                    </div>
                ) : data.health === 'STARVED' ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-rose-400">
                        <Zap className="w-3 h-3 opacity-40" />
                        <span className="font-semibold">OT Useless</span>
                        <span className="text-slate-500">— no work to fill extra hours</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Zap className="w-3 h-3 opacity-30" />
                        <span>OT not needed — flow is balanced</span>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────

interface QueueHealthPanelProps {
    jobs: Job[];
    defaultCollapsed?: boolean;
}

export default function QueueHealthPanel({ jobs, defaultCollapsed = false }: QueueHealthPanelProps) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    const queueHealth = useMemo(() => calculateQueueHealth(jobs), [jobs]);

    // Summary stats
    const totalPoints = useMemo(
        () => queueHealth.reduce((sum, d) => sum + d.pointsOnHand, 0),
        [queueHealth]
    );
    const starvedCount = useMemo(
        () => queueHealth.filter(d => d.health === 'STARVED').length,
        [queueHealth]
    );
    const overloadedCount = useMemo(
        () => queueHealth.filter(d => d.health === 'OVERLOADED').length,
        [queueHealth]
    );

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 overflow-hidden">
            {/* Header bar — always visible */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-900/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-bold text-white uppercase tracking-wider">Queue Health</span>
                    <div className="flex items-center gap-2 ml-2">
                        <span className="text-xs text-slate-400">
                            <span className="text-cyan-300 font-semibold tabular-nums">{totalPoints.toLocaleString()}</span> total pts
                        </span>
                        {starvedCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-semibold">
                                {starvedCount} starved
                            </span>
                        )}
                        {overloadedCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-semibold">
                                {overloadedCount} overloaded
                            </span>
                        )}
                    </div>
                </div>
                {collapsed ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                )}
            </button>

            {/* Expandable body */}
            {!collapsed && (
                <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                        {queueHealth.map((dept) => (
                            <DeptCard key={dept.department} data={dept} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
