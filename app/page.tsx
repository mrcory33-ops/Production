'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Calculator, UploadCloud,
  Hammer, Gauge, PackageSearch,
  ChevronRight,
} from 'lucide-react';
import { ENABLE_JCS_INTEGRATION } from '@/lib/featureFlags';

// ─────────────────────────────────────────────────────────────────
// HOME PORTAL — Stainless Steel Industrial Theme
// ─────────────────────────────────────────────────────────────────

export default function HomePortal() {
  const router = useRouter();

  const modules = [
    {
      title: 'Master Schedule',
      subtitle: 'Planning Board',
      icon: <LayoutDashboard className="w-8 h-8" />,
      description: 'Capacity planning, global Gantt chart, and production tracking.',
      status: 'Operational',
      statusColor: 'bg-emerald-500',
      href: '/planning',
    },
    {
      title: 'Supervisor Schedule',
      subtitle: 'Crew Command',
      icon: <Users className="w-8 h-8" />,
      description: 'Daily assignments, team roster, and shop floor management.',
      status: 'Active',
      statusColor: 'bg-sky-500',
      href: '/supervisor',
      highlight: true,
    },
    {
      title: 'What If Scheduler',
      subtitle: 'Quote Estimator',
      icon: <Calculator className="w-8 h-8" />,
      description: 'Calculate points based on linear feet, difficulty, and material.',
      status: 'Ready',
      statusColor: 'bg-emerald-500',
      href: '/quote-estimator',
    },
    {
      title: 'Data Sync',
      subtitle: 'Global Shop Import',
      icon: <UploadCloud className="w-8 h-8" />,
      description: 'Import daily job reports and synchronize PO status.',
      status: 'Idle',
      statusColor: 'bg-slate-500',
      href: '/upload',
    },
    ...(ENABLE_JCS_INTEGRATION ? [{
      title: 'Component Report',
      subtitle: 'JCS Detail',
      icon: <PackageSearch className="w-8 h-8" />,
      description: 'Search JCS component lines, PO status, vendor detail, and stale PO visibility.',
      status: 'Ready',
      statusColor: 'bg-cyan-500',
      href: '/components-report',
    }] : []),
    {
      title: 'Design Lab',
      subtitle: 'R&D Sandbox',
      icon: <Gauge className="w-8 h-8" />,
      description: 'Experimental prototypes and UI testing environment.',
      status: 'Beta',
      statusColor: 'bg-indigo-500',
      href: '/design-concepts',
    },
  ];

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-slate-100 font-sans selection:bg-sky-500/30 overflow-hidden relative">

      {/* Background Texture: Dark Brushed Metal */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `
                        repeating-linear-gradient(90deg, transparent 0, transparent 2px, #000 2px, #000 4px),
                        linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)
                    `,
          backgroundSize: '4px 100%'
        }}
      />
      {/* Vignette */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-60"
        style={{
          background: 'radial-gradient(circle at 50% 50%, transparent 30%, #000 100%)'
        }}
      />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-6">

        {/* ─── Header Plate ─── */}
        <header className="mb-14 text-center relative max-w-2xl mx-auto w-full">
          {/* Decorative Corner Bolts */}
          {[
            '-top-4 -left-4', '-top-4 -right-4',
            '-bottom-4 -left-4', '-bottom-4 -right-4',
          ].map((pos, i) => (
            <div key={i} className={`absolute ${pos} w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.5),1px_1px_3px_rgba(0,0,0,0.8)] border border-slate-600`} />
          ))}

          <div className="bg-gradient-to-b from-[#2a2a2a] to-[#1a1a1a] border border-[#444] rounded-lg p-8 shadow-[0_10px_30px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] relative overflow-hidden group">
            {/* Shine Sweep */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />

            <div className="flex flex-col items-center relative z-10">
              <div className="w-20 h-20 mb-4 rounded-full bg-gradient-to-br from-[#333] to-[#111] border-4 border-slate-400 shadow-[0_0_15px_rgba(255,255,255,0.1)] flex items-center justify-center">
                <Hammer className="w-10 h-10 text-slate-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" />
              </div>
              <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-300 to-slate-500 uppercase tracking-widest drop-shadow-lg font-serif">
                EMJAC INDUSTRIES
              </h1>
              <div className="h-px w-32 bg-gradient-to-r from-transparent via-slate-400 to-transparent my-3 opacity-50" />
              <p className="text-slate-400 font-mono text-xs tracking-[0.3em] uppercase">
                Premium Stainless Manufacturing • Operations Portal
              </p>
            </div>
          </div>
        </header>

        {/* ─── Module Grid: 2 on top centered, 3 on bottom ─── */}
        <div className="max-w-6xl w-full space-y-8">
          {/* Top Row — 2 cards, centered */}
          <div className="flex justify-center gap-8">
            {modules.slice(0, 2).map((mod) => (
              <div key={mod.title} className="w-full max-w-[380px]">
                <PortalCard
                  {...mod}
                  onClick={() => router.push(mod.href)}
                />
              </div>
            ))}
          </div>
          {/* Bottom Row — 3 cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {modules.slice(2).map((mod) => (
              <PortalCard
                key={mod.title}
                {...mod}
                onClick={() => router.push(mod.href)}
              />
            ))}
          </div>
        </div>

        {/* ─── Footer Stamp ─── */}
        <footer className="mt-16 text-center">
          <p className="text-[11px] font-mono text-[#444] uppercase tracking-widest">
            Emjac Operations Platform &bull; v7.3
          </p>
        </footer>
      </div>
    </div>
  );
}


// ─── Portal Card Component ──────────────────────────────────────

interface PortalCardProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  description: string;
  status: string;
  statusColor: string;
  highlight?: boolean;
  onClick: () => void;
}

function PortalCard({ title, subtitle, icon, description, status, statusColor, highlight, onClick }: PortalCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
                group relative bg-[#222] border rounded-xl overflow-hidden transition-all duration-300 
                hover:-translate-y-1.5 hover:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.9)] cursor-pointer
                ${highlight
          ? 'border-sky-500/50 shadow-[0_0_20px_rgba(56,189,248,0.1)]'
          : 'border-[#333] hover:border-[#555]'}
            `}
    >
      {/* Metallic sweep on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Header Plate Bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-[#333] via-[#555] to-[#333] border-b border-[#111]" />

      <div className="p-6 flex flex-col h-full relative z-10">
        <div className="flex justify-between items-start mb-5">
          <div className={`
                        p-3 rounded bg-gradient-to-br from-[#333] to-[#111] border border-[#444] shadow-inner
                        text-slate-400 group-hover:text-white transition-colors
                        ${highlight ? 'text-sky-300 border-sky-500/30' : ''}
                    `}>
            {icon}
          </div>
          {/* Status LED */}
          <div className="flex items-center gap-2 bg-[#111] px-2 py-1 rounded border border-[#333] shadow-inner">
            <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor] ${statusColor}`} />
            <span className="text-[10px] font-mono text-[#888] uppercase tracking-wider">{status}</span>
          </div>
        </div>

        <h3 className={`
                    text-xl font-bold font-serif uppercase tracking-wide mb-1 transition-colors
                    ${highlight ? 'text-sky-300' : 'text-slate-200 group-hover:text-white'}
                `}>
          {title}
        </h3>
        <p className="text-xs font-bold text-[#666] uppercase tracking-widest mb-4 border-b border-[#333] pb-2">
          {subtitle}
        </p>
        <p className="text-sm text-[#999] leading-relaxed mb-6 font-light">
          {description}
        </p>

        <div className="mt-auto flex justify-end">
          <button className={`
                        px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2
                        ${highlight
              ? 'bg-gradient-to-b from-sky-600 to-sky-800 text-white shadow-[0_2px_10px_rgba(56,189,248,0.3)] hover:brightness-110'
              : 'bg-[#333] text-slate-400 border border-[#444] hover:bg-[#444] hover:border-[#666]'}
                    `}>
            Access Module <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Corner Rivet Details */}
      <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#333] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.8),1px_1px_0px_rgba(255,255,255,0.1)] opacity-50" />
      <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full bg-[#333] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.8),1px_1px_0px_rgba(255,255,255,0.1)] opacity-50" />
    </div>
  );
}
