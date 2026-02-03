'use client';

import Link from 'next/link';
import Timeline from '@/components/Timeline';
import { LayoutDashboard, FileUp, Calendar, AlertTriangle, ArrowRight } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-grid bg-fixed flex flex-col items-center justify-center p-6 relative">
      {/* Background Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <main className="w-full max-w-5xl z-10">

        {/* Header */}
        <div className="mb-12 text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/30 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-bold tracking-wider uppercase backdrop-blur-sm">
            Emjac Operations
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-white drop-shadow-xl">
            Production <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600 text-glow">Scheduler</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Advanced capacity planning and bottleneck detection for the fabrication floor.
          </p>
        </div>

        {/* Action Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Action Card: Import */}
          <Link href="/upload" className="group block h-full">
            <div className="glass-card glass-card-hover h-full rounded-2xl p-8 relative overflow-hidden group-hover:border-cyan-500/50">
              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="text-cyan-400 w-6 h-6 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>

              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-6 shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform duration-300">
                <FileUp className="w-7 h-7 text-white" />
              </div>

              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-cyan-400 transition-colors">Import Data</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Upload Global Shop exports to synchronize master and sub-orders.
              </p>
            </div>
          </Link>

          {/* Action Card: Planning */}
          <Link href="/planning" className="group block h-full">
            <div className="glass-card glass-card-hover h-full rounded-2xl p-8 relative overflow-hidden group-hover:border-cyan-500/50">
              <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                <ArrowRight className="text-cyan-400 w-6 h-6 -rotate-45 group-hover:rotate-0 transition-transform duration-300" />
              </div>

              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-6 shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform duration-300">
                <Calendar className="w-7 h-7 text-white" />
              </div>

              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-cyan-400 transition-colors">Planning</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Drag-and-drop scheduling with remaining-work bars and capacity alerts.
              </p>
            </div>
          </Link>

          {/* Action Card: Insights */}
          <Link href="/insights" className="block h-full cursor-pointer hover:scale-[1.02] transition-transform">
            <div className="glass-card h-full rounded-2xl p-8 relative overflow-hidden hover:border-cyan-500/50">
              <div className="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center mb-6 border border-slate-700 shadow-lg shadow-purple-500/10">
                <AlertTriangle className="w-7 h-7 text-purple-400" />
              </div>

              <h3 className="text-2xl font-bold text-white mb-2">Insights</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Automatic bottleneck detection and weekly capacity heatmaps.
              </p>
              <div className="absolute top-0 right-0 p-6 opacity-0 hover:opacity-100 transition-opacity">
                <ArrowRight className="text-purple-400 w-6 h-6" />
              </div>
            </div>
          </Link>

        </div>

        {/* Timeline Visualization */}
        <div className="mt-8">
          <Timeline />
        </div>

        {/* Footer Status */}
        <div className="mt-12 text-center border-t border-slate-800/50 pt-8">
          <div className="inline-flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            System Operational
            <span className="mx-2">•</span>
            v0.1.0-alpha
          </div>
        </div>

      </main>
    </div>
  );
}
