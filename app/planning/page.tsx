'use client';

import Link from 'next/link';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import PlanningBoard from '@/components/PlanningBoard';

export default function PlanningPage() {
    return (
        <div className="min-h-screen bg-grid bg-fixed p-8 relative">
            <div className="fixed top-10 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />

            <div className="max-w-7xl mx-auto relative z-10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div>
                            <h1 className="text-3xl font-bold text-white tracking-tight">Planning</h1>
                            <p className="text-slate-400 text-sm">Adjust remaining schedules based on current shop progress.</p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-mono">
                        <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                        Drag bars to reschedule and update forecast due dates.
                    </div>
                </div>

                <PlanningBoard />
            </div>
        </div>
    );
}
