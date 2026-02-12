import React from 'react';
import { SupervisorAlert } from '@/types';
import { getDepartmentStatus } from '@/lib/supervisorAlerts';
import {
    AlertTriangle, BellRing, ShieldAlert, Package, PackageX,
    FileX2, Clock3,
} from 'lucide-react';

export default function AlertsView({ alerts, allAlerts, departmentStatus }: {
    alerts: SupervisorAlert[]; allAlerts: SupervisorAlert[];
    departmentStatus: ReturnType<typeof getDepartmentStatus>;
}) {
    const totalBlocked = departmentStatus.reduce((s, d) => s + d.totalBlockedPoints, 0);
    const feed = alerts.length > 0 ? alerts : allAlerts;

    return (
        <div className="p-6 overflow-y-auto h-full space-y-6 max-w-4xl mx-auto">
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Active Alerts', value: allAlerts.length, icon: <BellRing className="w-5 h-5" />, color: 'text-sky-300' },
                    { label: 'Depts Affected', value: departmentStatus.filter(d => d.activeAlerts > 0).length, icon: <ShieldAlert className="w-5 h-5" />, color: 'text-slate-300' },
                    { label: 'Blocked Points', value: Math.round(totalBlocked), icon: <AlertTriangle className="w-5 h-5" />, color: 'text-rose-300' },
                ].map(stat => (
                    <div key={stat.label} className="bg-[#1a1a1a] rounded-lg border border-[#333] p-4">
                        <p className="text-[10px] uppercase tracking-wider text-[#666] font-bold">{stat.label}</p>
                        <div className="mt-2 flex items-end justify-between">
                            <span className={`text-3xl font-bold font-mono ${stat.color}`}>{stat.value}</span>
                            <span className="opacity-40">{stat.icon}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="space-y-3">
                {feed.length === 0 && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300 font-mono">No active delays reported.</div>}
                {feed.map(alert => (
                    <div key={alert.id} className="bg-[#1a1a1a] rounded-lg border border-[#333] p-4 hover:border-[#555] transition-colors">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-mono text-sky-300 font-bold">{alert.jobId}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[#222] text-[#888] border border-[#333]">{alert.department}</span>
                            {alert.isSpecialPurchase && <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold inline-flex items-center gap-1"><Package className="w-3 h-3" /> SP</span>}
                            {alert.isCsiNotReceived && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold inline-flex items-center gap-1"><FileX2 className="w-3 h-3" /> CSI</span>}
                            {alert.isOutOfStock && <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold inline-flex items-center gap-1"><PackageX className="w-3 h-3" /> OOS</span>}
                        </div>
                        <p className="text-sm text-slate-300 truncate">{alert.jobName}</p>
                        <p className="mt-2 text-xs text-[#999] leading-relaxed">{alert.reason}</p>
                        <div className="mt-3 flex items-center justify-between text-[10px] text-[#555] font-mono">
                            <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" /> Est. {new Date(alert.estimatedResolutionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            <span>{alert.daysBlocked} business day{alert.daysBlocked === 1 ? '' : 's'}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
