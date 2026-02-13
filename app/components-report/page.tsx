'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Search, Filter, PackageSearch } from 'lucide-react';
import { db, ensureFirebaseSession } from '@/lib/firebase';
import { JCSJobDocument } from '@/types';
import { ENABLE_JCS_INTEGRATION } from '@/lib/featureFlags';

type StatusFilter = 'ALL' | 'OPEN' | 'OVERDUE' | 'RECEIVED';

const STALE_MS = 48 * 60 * 60 * 1000;

const normalizeText = (value: unknown): string => String(value ?? '').toLowerCase();

const isFreshImport = (value?: string): boolean => {
    if (!value) return false;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return Date.now() - parsed.getTime() <= STALE_MS;
};

const formatDate = (value?: string): string => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
};

const buildEarliestPODueMap = (components: JCSJobDocument['components']): Map<string, string> => {
    const dueMap = new Map<string, string>();
    components.forEach((line) => {
        if (!line.purchaseOrder || !line.dueDate) return;
        const currentDue = dueMap.get(line.purchaseOrder);
        if (!currentDue) {
            dueMap.set(line.purchaseOrder, line.dueDate);
            return;
        }
        const currentTime = new Date(currentDue).getTime();
        const nextTime = new Date(line.dueDate).getTime();
        if (!Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime < currentTime)) {
            dueMap.set(line.purchaseOrder, line.dueDate);
        }
    });
    return dueMap;
};

export default function ComponentsReportPage() {
    const [rows, setRows] = useState<JCSJobDocument[]>([]);
    const [latestImportAt, setLatestImportAt] = useState<string | null>(null);
    const [loading, setLoading] = useState(ENABLE_JCS_INTEGRATION);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [salesRepFilter, setSalesRepFilter] = useState('ALL');
    const [vendorFilter, setVendorFilter] = useState('ALL');

    useEffect(() => {
        if (!ENABLE_JCS_INTEGRATION) return;
        let active = true;
        let unsubRows: (() => void) | undefined;
        let unsubImports: (() => void) | undefined;

        ensureFirebaseSession()
            .then(() => {
                if (!active) return;
                unsubRows = onSnapshot(
                    collection(db, 'jcs_components'),
                    (snapshot) => {
                        if (!active) return;
                        const docs = snapshot.docs.map((docSnap) => docSnap.data() as JCSJobDocument);
                        setRows(docs);
                        setLoading(false);
                    },
                    (err) => {
                        console.error('Failed to load jcs_components', err);
                        if (!active) return;
                        setError('Failed to load component report data.');
                        setLoading(false);
                    }
                );

                unsubImports = onSnapshot(
                    collection(db, 'jcs_imports'),
                    (snapshot) => {
                        if (!active) return;
                        const latest = snapshot.docs
                            .map((docSnap) => docSnap.data() as Record<string, unknown>)
                            .filter((doc) => doc.status === 'success')
                            .map((doc) => String(doc.completedAt || doc.finishedAt || doc.startedAt || ''))
                            .filter(Boolean)
                            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
                        setLatestImportAt(latest);
                    }
                );
            })
            .catch((err) => {
                console.error('Failed to bootstrap Firebase auth', err);
                if (!active) return;
                setError('Unable to connect to Firebase authentication.');
                setLoading(false);
            });

        return () => {
            active = false;
            if (unsubRows) unsubRows();
            if (unsubImports) unsubImports();
        };
    }, []);

    const salesReps = useMemo(() => {
        const values = Array.from(new Set(rows.map((row) => row.codeSort).filter(Boolean) as string[]));
        return values.sort((a, b) => a.localeCompare(b));
    }, [rows]);

    const vendors = useMemo(() => {
        const values = new Set<string>();
        rows.forEach((row) => {
            row.poSummary.forEach((po) => {
                if (po.vendor) values.add(po.vendor);
            });
        });
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [rows]);

    const filteredRows = useMemo(() => {
        const queryText = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (salesRepFilter !== 'ALL' && row.codeSort !== salesRepFilter) return false;
            if (vendorFilter !== 'ALL') {
                const hasVendor = row.poSummary.some((po) => po.vendor === vendorFilter);
                if (!hasVendor) return false;
            }
            if (statusFilter === 'OPEN' && row.counts.openPOs <= 0) return false;
            if (statusFilter === 'OVERDUE' && row.counts.overduePOs <= 0) return false;
            if (statusFilter === 'RECEIVED' && row.counts.receivedPOs <= 0) return false;
            if (!queryText) return true;

            const rowText = [
                row.jobId,
                row.project,
                row.codeSort,
                ...row.poSummary.map((po) => `${po.purchaseOrder} ${po.vendor || ''}`),
                ...row.components.map((line) => `${line.description} ${line.componentId} ${line.dueDate || ''}`),
            ]
                .map(normalizeText)
                .join(' ');

            return rowText.includes(queryText);
        });
    }, [rows, search, salesRepFilter, vendorFilter, statusFilter]);

    const summary = useMemo(() => {
        return filteredRows.reduce(
            (acc, row) => {
                acc.jobs += 1;
                acc.open += row.counts.openPOs;
                acc.received += row.counts.receivedPOs;
                acc.overdue += row.counts.overduePOs;
                return acc;
            },
            { jobs: 0, open: 0, received: 0, overdue: 0 }
        );
    }, [filteredRows]);

    const isImportStale = latestImportAt ? !isFreshImport(latestImportAt) : true;

    if (!ENABLE_JCS_INTEGRATION) {
        return (
            <main className="min-h-screen bg-[#111] text-slate-200 p-8">
                <div className="max-w-3xl mx-auto rounded-xl border border-amber-700/40 bg-amber-950/30 p-6">
                    <p className="text-sm font-bold uppercase tracking-wider text-amber-300">JCS Integration Disabled</p>
                    <p className="text-sm text-amber-100/90 mt-2">
                        Enable `NEXT_PUBLIC_ENABLE_JCS_INTEGRATION=true` to use the Component Status Report page.
                    </p>
                    <Link href="/" className="mt-4 inline-flex items-center gap-2 text-sm text-amber-200 hover:text-white">
                        <ArrowLeft className="w-4 h-4" /> Back to Portal
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[#111] text-slate-200 p-6 md:p-8">
            <div className="max-w-7xl mx-auto space-y-5">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <Link href="/" className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white mb-2">
                            <ArrowLeft className="w-3.5 h-3.5" /> Back to Portal
                        </Link>
                        <h1 className="text-2xl md:text-3xl font-serif font-bold text-white">Component Status Report</h1>
                        <p className="text-sm text-slate-400 mt-1">JCS #9 component and PO status index</p>
                    </div>
                    <div className="text-right text-xs font-mono text-slate-400">
                        <div>Latest Import</div>
                        <div className="text-slate-200 mt-1">
                            {latestImportAt ? new Date(latestImportAt).toLocaleString() : 'No successful import'}
                        </div>
                    </div>
                </div>

                {isImportStale && (
                    <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5" />
                        <div>
                            <p className="font-semibold">JCS data appears stale</p>
                            <p className="text-amber-100/80 text-xs mt-1">
                                No successful import within the last 48 hours.
                            </p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="Jobs" value={summary.jobs} accent="text-slate-100" />
                    <StatCard label="Open POs" value={summary.open} accent="text-amber-300" />
                    <StatCard label="Received POs" value={summary.received} accent="text-emerald-300" />
                    <StatCard label="Overdue POs" value={summary.overdue} accent="text-rose-300" />
                </div>

                <div className="rounded-xl border border-[#333] bg-[#181818] p-4 space-y-3">
                    <div className="relative">
                        <Search className="w-4 h-4 text-[#666] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search job ID, project, PO, vendor, or component description..."
                            className="w-full bg-[#111] border border-[#333] rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder:text-[#666] focus:outline-none focus:border-sky-500/40"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <SelectFilter label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)}>
                            <option value="ALL">All</option>
                            <option value="OPEN">Open</option>
                            <option value="OVERDUE">Overdue</option>
                            <option value="RECEIVED">Received</option>
                        </SelectFilter>
                        <SelectFilter label="Sales Rep" value={salesRepFilter} onChange={setSalesRepFilter}>
                            <option value="ALL">All</option>
                            {salesReps.map((rep) => (
                                <option key={rep} value={rep}>{rep}</option>
                            ))}
                        </SelectFilter>
                        <SelectFilter label="Vendor" value={vendorFilter} onChange={setVendorFilter}>
                            <option value="ALL">All</option>
                            {vendors.map((vendor) => (
                                <option key={vendor} value={vendor}>{vendor}</option>
                            ))}
                        </SelectFilter>
                    </div>
                </div>

                <section className="rounded-xl border border-[#333] bg-[#151515] overflow-hidden">
                    <header className="px-4 py-3 border-b border-[#333] text-xs font-bold uppercase tracking-wider text-[#666]">
                        {filteredRows.length} Jobs
                    </header>
                    {loading ? (
                        <div className="py-16 text-center text-slate-400">Loading component report...</div>
                    ) : error ? (
                        <div className="py-16 text-center text-rose-300">{error}</div>
                    ) : filteredRows.length === 0 ? (
                        <div className="py-16 text-center text-slate-500">
                            <PackageSearch className="w-10 h-10 mx-auto mb-3 opacity-40" />
                            No jobs match current filters.
                        </div>
                    ) : (
                        <div className="divide-y divide-[#2c2c2c]">
                            {filteredRows.map((row) => (
                                (() => {
                                    const poDueByNumber = buildEarliestPODueMap(row.components);
                                    const sortedComponents = [...row.components].sort((a, b) => {
                                        if (a.purchaseOrder !== b.purchaseOrder) {
                                            return a.purchaseOrder.localeCompare(b.purchaseOrder);
                                        }
                                        return (a.componentId || '').localeCompare(b.componentId || '');
                                    });

                                    return (
                                        <details key={row.jobId} className="group">
                                            <summary className="list-none cursor-pointer px-4 py-3 hover:bg-[#1b1b1b] transition-colors">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="font-mono text-sky-300 font-bold">{row.jobId}</span>
                                                    <span className="text-slate-300 text-sm truncate">{row.project || 'No project name'}</span>
                                                    <span className="text-[10px] px-2 py-0.5 rounded border border-[#444] text-[#888]">{row.codeSort || 'No rep'}</span>
                                                    <span className="ml-auto text-[11px] text-slate-400 font-mono">
                                                        {row.counts.receivedPOs} received / {row.counts.openPOs} open / {row.counts.overduePOs} overdue
                                                    </span>
                                                </div>
                                            </summary>
                                            <div className="px-4 pb-4 space-y-3">
                                                <div className="rounded border border-[#333] overflow-x-auto">
                                                    <div className="min-w-[760px]">
                                                        <div className="grid grid-cols-[1fr_1fr_.8fr_.8fr_.9fr_.8fr] bg-[#1c1c1c] border-b border-[#333] text-[10px] font-bold uppercase tracking-wider text-[#666] px-3 py-2">
                                                            <span>PO</span>
                                                            <span>Vendor</span>
                                                            <span>Ordered</span>
                                                            <span>Received</span>
                                                            <span>Due (U)</span>
                                                            <span>Status</span>
                                                        </div>
                                                        {row.poSummary.map((po) => (
                                                            <div key={`${row.jobId}-${po.purchaseOrder}`} className="grid grid-cols-[1fr_1fr_.8fr_.8fr_.9fr_.8fr] px-3 py-2 text-xs border-b border-[#2a2a2a] last:border-b-0">
                                                                <span className="font-mono text-slate-200 truncate pr-2" title={po.purchaseOrder}>{po.purchaseOrder}</span>
                                                                <span className="text-slate-400 truncate pr-2" title={po.vendor}>{po.vendor || '-'}</span>
                                                                <span className="font-mono text-slate-300">{po.qtyOrderedTotal}</span>
                                                                <span className="font-mono text-slate-300">{po.qtyReceivedTotal}</span>
                                                                <span className="text-slate-300 font-mono">{formatDate(poDueByNumber.get(po.purchaseOrder))}</span>
                                                                <span className={`inline-flex items-center justify-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                                                    po.status === 'received'
                                                                        ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                                                                        : po.status === 'overdue'
                                                                            ? 'border-rose-500/40 bg-rose-500/20 text-rose-300'
                                                                            : 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                                                                }`}>
                                                                    {po.status}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="rounded border border-[#333] overflow-x-auto">
                                                    <div className="min-w-[1080px]">
                                                        <div className="grid grid-cols-[.9fr_1fr_2.6fr_.9fr_.9fr_.8fr_.8fr_.8fr] bg-[#1c1c1c] border-b border-[#333] text-[10px] font-bold uppercase tracking-wider text-[#666] px-3 py-2">
                                                            <span>Comp</span>
                                                            <span>PO</span>
                                                            <span>Description (L)</span>
                                                            <span>Vendor</span>
                                                            <span>Due (U)</span>
                                                            <span>Ordered</span>
                                                            <span>Received</span>
                                                            <span>Status</span>
                                                        </div>
                                                        {sortedComponents.map((line, idx) => (
                                                            <div key={`${row.jobId}-${line.purchaseOrder}-${line.componentId}-${idx}`} className="grid grid-cols-[.9fr_1fr_2.6fr_.9fr_.9fr_.8fr_.8fr_.8fr] px-3 py-2 text-xs border-b border-[#2a2a2a] last:border-b-0">
                                                                <span className="font-mono text-slate-300 truncate pr-2">{line.componentId || '-'}</span>
                                                                <span className="font-mono text-slate-200 truncate pr-2">{line.purchaseOrder}</span>
                                                                <span className="text-slate-300 pr-3 whitespace-normal break-words leading-snug">{line.description || '-'}</span>
                                                                <span className="text-slate-400 truncate pr-2" title={line.vendor}>{line.vendor || '-'}</span>
                                                                <span className="text-slate-300 font-mono">{formatDate(line.dueDate)}</span>
                                                                <span className="font-mono text-slate-300">{line.qtyOrdered}</span>
                                                                <span className="font-mono text-slate-300">{line.qtyReceived}</span>
                                                                <span className={`inline-flex items-center justify-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                                                    line.status === 'received'
                                                                        ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                                                                        : line.status === 'overdue'
                                                                            ? 'border-rose-500/40 bg-rose-500/20 text-rose-300'
                                                                            : 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                                                                }`}>
                                                                    {line.status}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </details>
                                    );
                                })()
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
    return (
        <div className="rounded-lg border border-[#333] bg-[#181818] px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-[#666] font-bold">{label}</p>
            <p className={`text-2xl font-mono font-bold mt-1 ${accent}`}>{value}</p>
        </div>
    );
}

function SelectFilter({
    label,
    value,
    onChange,
    children,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
}) {
    return (
        <label className="flex items-center gap-2 rounded border border-[#333] bg-[#111] px-2.5 py-2 text-xs text-slate-300">
            <Filter className="w-3.5 h-3.5 text-[#666]" />
            <span className="text-[#777] uppercase tracking-wide">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="ml-auto bg-transparent text-slate-200 outline-none"
            >
                {children}
            </select>
        </label>
    );
}
