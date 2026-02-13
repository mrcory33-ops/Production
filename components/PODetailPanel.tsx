'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { JCSJobDocument } from '@/types';
import { ENABLE_JCS_INTEGRATION } from '@/lib/featureFlags';
import { AlertTriangle, Loader2, PackageSearch, X } from 'lucide-react';

interface PODetailPanelProps {
    isOpen: boolean;
    jobId: string | null;
    jobName?: string;
    onClose: () => void;
}

const STALE_MS = 48 * 60 * 60 * 1000;

const toDate = (value?: string): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

const statusBadge = (status: 'received' | 'open' | 'overdue') => {
    if (status === 'received') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    if (status === 'overdue') return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
};

export default function PODetailPanel({ isOpen, jobId, jobName, onClose }: PODetailPanelProps) {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<JCSJobDocument | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isStaleByAge, setIsStaleByAge] = useState(false);

    useEffect(() => {
        if (!isOpen || !jobId || !ENABLE_JCS_INTEGRATION) return;
        const ref = doc(db, 'jcs_components', jobId);
        const unsub = onSnapshot(
            ref,
            (snap) => {
                if (!snap.exists()) {
                    setError(null);
                    setData(null);
                    setIsStaleByAge(false);
                    setLoading(false);
                    return;
                }
                const nextData = snap.data() as JCSJobDocument;
                const imported = toDate(nextData.importedAt);
                setError(null);
                setData(nextData);
                setIsStaleByAge(Boolean(imported && Date.now() - imported.getTime() > STALE_MS));
                setLoading(false);
            },
            (err) => {
                console.error('Failed to load JCS PO detail', err);
                setError('Unable to load component PO detail.');
                setData(null);
                setIsStaleByAge(false);
                setLoading(false);
            }
        );
        return () => unsub();
    }, [isOpen, jobId]);

    useEffect(() => {
        if (!isOpen) return;
        const onEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onEsc);
        return () => document.removeEventListener('keydown', onEsc);
    }, [isOpen, onClose]);

    if (!isOpen || !jobId || typeof document === 'undefined') return null;

    const poDueByNumber = data ? buildEarliestPODueMap(data.components) : new Map<string, string>();
    const sortedComponents = data
        ? [...data.components].sort((a, b) => {
            if (a.purchaseOrder !== b.purchaseOrder) {
                return a.purchaseOrder.localeCompare(b.purchaseOrder);
            }
            return (a.componentId || '').localeCompare(b.componentId || '');
        })
        : [];

    return createPortal(
        <div className="fixed inset-0 z-[12000]">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={onClose} />
            <aside className="absolute right-0 top-0 h-full w-full max-w-[76rem] bg-[#121212] border-l border-[#333] shadow-2xl">
                <div className="h-full flex flex-col">
                    <header className="px-5 py-4 border-b border-[#333] bg-gradient-to-b from-[#1d1d1d] to-[#161616]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-mono uppercase tracking-widest text-[#666]">PO Detail</p>
                                <h3 className="text-lg font-serif font-bold text-slate-100 mt-0.5">{jobId}</h3>
                                <p className="text-xs text-slate-400 truncate mt-1">{jobName || data?.project || 'Job Components'}</p>
                            </div>
                            <button onClick={onClose} className="p-2 rounded border border-[#444] text-[#888] hover:text-white hover:border-[#666] transition-colors">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </header>

                    {!ENABLE_JCS_INTEGRATION && (
                        <div className="m-5 rounded border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                            JCS integration is currently disabled by feature flag.
                        </div>
                    )}

                    {ENABLE_JCS_INTEGRATION && (
                        <>
                            {loading && (
                                <div className="flex-1 flex items-center justify-center gap-2 text-slate-400">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading PO detail...
                                </div>
                            )}

                            {!loading && error && (
                                <div className="m-5 rounded border border-rose-700/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
                                    {error}
                                </div>
                            )}

                            {!loading && !error && !data && (
                                <div className="flex-1 flex flex-col items-center justify-center text-[#666] gap-3">
                                    <PackageSearch className="w-10 h-10 opacity-40" />
                                    <p className="text-sm font-mono uppercase tracking-wide">No JCS data for this job</p>
                                    <p className="text-xs text-[#555]">Upload a current #9&apos;s.xlsx report to view PO lines.</p>
                                </div>
                            )}

                            {!loading && !error && data && (
                                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                    {(data.stale || isStaleByAge) && (
                                        <div className="rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2">
                                            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300" />
                                            <div>
                                                <p className="font-bold uppercase tracking-wide">Stale JCS Data</p>
                                                <p className="text-amber-100/80">
                                                    Last import: {toDate(data.importedAt)?.toLocaleString() || 'Unknown'}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-4 gap-2">
                                        <div className="rounded border border-[#333] bg-[#1a1a1a] px-3 py-2">
                                            <p className="text-[9px] uppercase tracking-wider text-[#666]">Total POs</p>
                                            <p className="text-lg font-mono font-bold text-slate-100">{data.counts.totalPOs}</p>
                                        </div>
                                        <div className="rounded border border-amber-700/30 bg-amber-950/20 px-3 py-2">
                                            <p className="text-[9px] uppercase tracking-wider text-amber-300/70">Open</p>
                                            <p className="text-lg font-mono font-bold text-amber-300">{data.counts.openPOs}</p>
                                        </div>
                                        <div className="rounded border border-rose-700/30 bg-rose-950/20 px-3 py-2">
                                            <p className="text-[9px] uppercase tracking-wider text-rose-300/70">Overdue</p>
                                            <p className="text-lg font-mono font-bold text-rose-300">{data.counts.overduePOs}</p>
                                        </div>
                                        <div className="rounded border border-emerald-700/30 bg-emerald-950/20 px-3 py-2">
                                            <p className="text-[9px] uppercase tracking-wider text-emerald-300/70">Received</p>
                                            <p className="text-lg font-mono font-bold text-emerald-300">{data.counts.receivedPOs}</p>
                                        </div>
                                    </div>

                                    <div className="rounded border border-[#333] overflow-x-auto">
                                        <div className="min-w-[780px]">
                                            <div className="grid grid-cols-[1.2fr_1fr_.75fr_.75fr_.95fr_.8fr] gap-0 bg-[#1a1a1a] border-b border-[#333] text-[10px] font-bold uppercase tracking-wider text-[#666] px-3 py-2">
                                                <span>PO</span>
                                                <span>Vendor</span>
                                                <span>Ordered</span>
                                                <span>Received</span>
                                                <span>Due (U)</span>
                                                <span>Status</span>
                                            </div>
                                            <div className="divide-y divide-[#2c2c2c]">
                                                {data.poSummary.map((po) => (
                                                    <div key={`${po.purchaseOrder}-${po.vendor || ''}`} className="grid grid-cols-[1.2fr_1fr_.75fr_.75fr_.95fr_.8fr] gap-0 px-3 py-2 text-xs">
                                                        <span className="font-mono text-slate-200 truncate pr-2" title={po.purchaseOrder}>{po.purchaseOrder}</span>
                                                        <span className="text-slate-400 truncate pr-2" title={po.vendor}>{po.vendor || '-'}</span>
                                                        <span className="text-slate-300 font-mono">{po.qtyOrderedTotal}</span>
                                                        <span className="text-slate-300 font-mono">{po.qtyReceivedTotal}</span>
                                                        <span className="text-slate-300 font-mono">{formatDate(poDueByNumber.get(po.purchaseOrder))}</span>
                                                        <span>
                                                            <span className={`inline-flex items-center rounded px-2 py-0.5 border text-[10px] font-bold uppercase ${statusBadge(po.status)}`}>
                                                                {po.status}
                                                            </span>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded border border-[#333] overflow-x-auto">
                                        <div className="min-w-[1150px]">
                                            <div className="grid grid-cols-[.9fr_1fr_2.6fr_.9fr_.95fr_.8fr_.9fr_.8fr] gap-0 bg-[#1a1a1a] border-b border-[#333] text-[10px] font-bold uppercase tracking-wider text-[#666] px-3 py-2">
                                                <span>Comp</span>
                                                <span>PO</span>
                                                <span>Description (L)</span>
                                                <span>Vendor</span>
                                                <span>Due (U)</span>
                                                <span>Ordered</span>
                                                <span>Received</span>
                                                <span>Status</span>
                                            </div>
                                            <div className="divide-y divide-[#2c2c2c] max-h-[30rem] overflow-y-auto">
                                                {sortedComponents.map((line, idx) => (
                                                    <div key={`${line.purchaseOrder}-${line.componentId}-${idx}`} className="grid grid-cols-[.9fr_1fr_2.6fr_.9fr_.95fr_.8fr_.9fr_.8fr] gap-0 px-3 py-2 text-xs">
                                                        <span className="font-mono text-slate-300 truncate pr-2">{line.componentId || '-'}</span>
                                                        <span className="font-mono text-slate-200 truncate pr-2">{line.purchaseOrder}</span>
                                                        <span className="text-slate-300 pr-3 whitespace-normal break-words leading-snug">{line.description || '-'}</span>
                                                        <span className="text-slate-400 truncate pr-2" title={line.vendor}>{line.vendor || '-'}</span>
                                                        <span className="text-slate-300 font-mono">{formatDate(line.dueDate)}</span>
                                                        <span className="text-slate-300 font-mono">{line.qtyOrdered}</span>
                                                        <span className="text-slate-300 font-mono">{line.qtyReceived}</span>
                                                        <span>
                                                            <span className={`inline-flex items-center rounded px-2 py-0.5 border text-[10px] font-bold uppercase ${statusBadge(line.status)}`}>
                                                                {line.status}
                                                            </span>
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </aside>
        </div>,
        document.body
    );
}
