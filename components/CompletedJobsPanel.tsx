'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, CheckCircle2, Package } from 'lucide-react';
import { Job } from '@/types';
import { format } from 'date-fns';

interface CompletedJobsPanelProps {
    jobs: Job[];
    onClose: () => void;
}

export default function CompletedJobsPanel({ jobs, onClose }: CompletedJobsPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isVisible, setIsVisible] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Animate in on mount
    useEffect(() => {
        requestAnimationFrame(() => setIsVisible(true));
    }, []);

    const filteredJobs = useMemo(() => {
        if (!searchQuery.trim()) return jobs;
        const q = searchQuery.toLowerCase();
        return jobs.filter(job =>
            job.id.toLowerCase().includes(q) ||
            job.name?.toLowerCase().includes(q) ||
            (job.description || '').toLowerCase().includes(q) ||
            (job.salesOrder || '').toLowerCase().includes(q) ||
            (job.partNumber || '').toLowerCase().includes(q) ||
            (job.salesRepCode || '').toLowerCase().includes(q)
        );
    }, [jobs, searchQuery]);

    // Group by completion week
    const groupedByWeek = useMemo(() => {
        const groups = new Map<string, Job[]>();
        filteredJobs.forEach(job => {
            const completedAt = job.updatedAt ? new Date(job.updatedAt) : new Date();
            const weekLabel = format(completedAt, "'Week of' MMM d");
            if (!groups.has(weekLabel)) groups.set(weekLabel, []);
            groups.get(weekLabel)!.push(job);
        });
        return groups;
    }, [filteredJobs]);

    const totalPoints = useMemo(() =>
        filteredJobs.reduce((sum, j) => sum + (j.weldingPoints || 0), 0),
        [filteredJobs]
    );

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 200);
    };

    return (
        <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: 'auto' }}>
            {/* Backdrop */}
            <div
                onClick={handleClose}
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(4px)',
                    transition: 'opacity 0.2s ease',
                    opacity: isVisible ? 1 : 0,
                }}
            />

            {/* Panel */}
            <div
                ref={panelRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: '480px',
                    maxWidth: '100vw',
                    backgroundColor: '#0f172a',
                    borderLeft: '1px solid #334155',
                    boxShadow: '-8px 0 30px rgba(0,0,0,0.4)',
                    display: 'flex',
                    flexDirection: 'column',
                    transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
                    transition: 'transform 0.25s ease-out',
                }}
            >
                {/* Header */}
                <div style={{
                    flexShrink: 0,
                    padding: '16px 20px',
                    borderBottom: '1px solid #334155',
                    backgroundColor: '#0f172a',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                backgroundColor: 'rgba(16,185,129,0.1)',
                                border: '1px solid rgba(16,185,129,0.2)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <CheckCircle2 size={16} color="#34d399" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', margin: 0 }}>
                                    Completed Jobs
                                </h2>
                                <p style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>
                                    {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''} · {Math.round(totalPoints).toLocaleString()} pts
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleClose}
                            style={{
                                padding: '6px',
                                color: '#64748b',
                                background: 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.backgroundColor = '#1e293b'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Search */}
                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search by Job ID, name, SO, part #, or sales rep..."
                            style={{
                                width: '100%',
                                paddingLeft: '36px',
                                paddingRight: '12px',
                                paddingTop: '8px',
                                paddingBottom: '8px',
                                backgroundColor: '#1e293b',
                                border: '1px solid #334155',
                                borderRadius: '8px',
                                fontSize: '12px',
                                color: '#e2e8f0',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>
                </div>

                {/* Job List */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredJobs.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '256px', color: '#475569' }}>
                            <Package size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                            <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>
                                {searchQuery ? 'No matching jobs' : 'No completed jobs'}
                            </p>
                            <p style={{ fontSize: '11px', marginTop: '4px' }}>
                                {searchQuery ? 'Try a different search' : 'Jobs removed during XLSX import appear here'}
                            </p>
                        </div>
                    ) : (
                        <div>
                            {Array.from(groupedByWeek.entries()).map(([weekLabel, weekJobs]) => (
                                <div key={weekLabel}>
                                    {/* Week group header */}
                                    <div style={{
                                        position: 'sticky',
                                        top: 0,
                                        padding: '8px 20px',
                                        backgroundColor: '#121828',
                                        borderBottom: '1px solid #1e293b',
                                        zIndex: 10,
                                    }}>
                                        <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            {weekLabel}
                                        </span>
                                        <span style={{ fontSize: '10px', color: '#475569', marginLeft: '8px', fontFamily: 'monospace' }}>
                                            ({weekJobs.length})
                                        </span>
                                    </div>

                                    {/* Job cards */}
                                    {weekJobs.map(job => {
                                        const completedDate = job.updatedAt ? new Date(job.updatedAt) : null;
                                        const dueDate = job.dueDate ? new Date(job.dueDate) : null;
                                        const productType = job.productType || 'FAB';
                                        const typeColors: Record<string, { text: string; bg: string; border: string }> = {
                                            FAB: { text: '#38bdf8', bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.2)' },
                                            DOORS: { text: '#fbbf24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.2)' },
                                            HARMONIC: { text: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.2)' },
                                        };
                                        const tc = typeColors[productType] || typeColors.FAB;

                                        return (
                                            <div
                                                key={job.id}
                                                style={{
                                                    padding: '12px 20px',
                                                    borderBottom: '1px solid rgba(30,41,59,0.5)',
                                                    cursor: 'default',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        {/* Job name + type */}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {job.name}
                                                            </span>
                                                            <span style={{
                                                                flexShrink: 0,
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '9px',
                                                                fontWeight: 700,
                                                                textTransform: 'uppercase',
                                                                color: tc.text,
                                                                backgroundColor: tc.bg,
                                                                border: `1px solid ${tc.border}`,
                                                            }}>
                                                                {productType}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8', marginTop: '2px' }}>
                                                            {job.id}
                                                        </div>
                                                        {job.description && (
                                                            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {job.description}
                                                            </div>
                                                        )}
                                                        {/* Meta row */}
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                                                            {dueDate && (
                                                                <span>Due: {format(dueDate, 'M/d/yy')}</span>
                                                            )}
                                                            <span style={{ color: '#334155' }}>·</span>
                                                            <span>{Math.round(job.weldingPoints || 0)} pts</span>
                                                            {job.salesRepCode && (
                                                                <>
                                                                    <span style={{ color: '#334155' }}>·</span>
                                                                    <span>Rep: {job.salesRepCode}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {/* Completion date */}
                                                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                                                        <div style={{ fontSize: '9px', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                            Completed
                                                        </div>
                                                        {completedDate && (
                                                            <div style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace', marginTop: '2px' }}>
                                                                {format(completedDate, 'M/d/yy')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer summary */}
                <div style={{
                    flexShrink: 0,
                    padding: '12px 20px',
                    borderTop: '1px solid #334155',
                    backgroundColor: '#0f172a',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                        <span>Showing last 30 days</span>
                        <span>{jobs.length} total completed</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
