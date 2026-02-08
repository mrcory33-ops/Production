'use client';

import React, { useState } from 'react';
import {
    LayoutDashboard, Users, Calculator, UploadCloud,
    Settings, LogOut, Bell, Menu, Search,
    Calendar, ClipboardList, CheckSquare,
    AlertTriangle, Hammer, Gauge, Info,
    ChevronRight, ChevronDown, UserPlus, Grip, Power
} from 'lucide-react';

export default function DesignConceptsPage() {
    const [view, setView] = useState<'portal' | 'supervisor'>('portal');

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
            {/* Subtle Vignette */}
            <div className="absolute inset-0 z-0 bg-radial-gradient(circle, transparent 20%, #000 100%) pointer-events-none opacity-80" />

            {/* Simulation Controls */}
            <div className="fixed top-4 right-4 z-50 flex gap-2 bg-black/90 p-1.5 rounded-lg border border-[#c4a484]/30 backdrop-blur-md shadow-[0_0_15px_rgba(0,0,0,0.8)]">
                <button
                    onClick={() => setView('portal')}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all border border-transparent
                        ${view === 'portal'
                            ? 'bg-gradient-to-b from-[#e6cba8] to-[#c4a484] text-black border-[#8b5a2b] shadow-inner'
                            : 'text-[#c4a484] hover:text-[#e6cba8] hover:bg-white/5'}`}
                >
                    Portal View
                </button>
                <div className="w-px bg-[#c4a484]/30 mx-1"></div>
                <button
                    onClick={() => setView('supervisor')}
                    className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all border border-transparent
                        ${view === 'supervisor'
                            ? 'bg-gradient-to-b from-[#e6cba8] to-[#c4a484] text-black border-[#8b5a2b] shadow-inner'
                            : 'text-[#c4a484] hover:text-[#e6cba8] hover:bg-white/5'}`}
                >
                    Supervisor View
                </button>
            </div>

            <div className="relative z-10 h-full">
                {view === 'portal' ? <PortalView /> : <SupervisorView />}
            </div>
        </div>
    );
}

// --- PORTAL VIEW: High-End Stainless & Bronze ---

function PortalView() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 relative">

            {/* Header Plate */}
            <header className="mb-12 text-center relative max-w-2xl mx-auto">
                {/* Decorative Bolts */}
                <div className="absolute -top-4 -left-4 w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.5),1px_1px_3px_rgba(0,0,0,0.8)] border border-slate-600"></div>
                <div className="absolute -top-4 -right-4 w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.5),1px_1px_3px_rgba(0,0,0,0.8)] border border-slate-600"></div>
                <div className="absolute -bottom-4 -left-4 w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.5),1px_1px_3px_rgba(0,0,0,0.8)] border border-slate-600"></div>
                <div className="absolute -bottom-4 -right-4 w-3 h-3 rounded-full bg-gradient-to-br from-slate-300 to-slate-500 shadow-[inset_1px_1px_2px_rgba(255,255,255,0.5),1px_1px_3px_rgba(0,0,0,0.8)] border border-slate-600"></div>

                <div className="bg-gradient-to-b from-[#2a2a2a] to-[#1a1a1a] border border-[#444] rounded-lg p-8 shadow-[0_10px_30px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.1)] relative overflow-hidden group">
                    {/* Shine Effect */}
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>

                    <div className="flex flex-col items-center relative z-10">
                        <div className="w-20 h-20 mb-4 rounded-full bg-gradient-to-br from-[#333] to-[#111] border-4 border-slate-400 shadow-[0_0_15px_rgba(255,255,255,0.1)] flex items-center justify-center">
                            <Hammer className="w-10 h-10 text-slate-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" />
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-300 to-slate-500 uppercase tracking-widest drop-shadow-lg font-serif">
                            EMJAC INDUSTRIES
                        </h1>
                        <div className="h-px w-32 bg-gradient-to-r from-transparent via-slate-400 to-transparent my-3 opacity-50"></div>
                        <p className="text-slate-400 font-mono text-xs tracking-[0.3em] uppercase">
                            Premium Stainless Manufacturing • Operations Portal
                        </p>
                    </div>
                </div>
            </header>

            {/* Application Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl w-full relative z-10">
                <PortalCard
                    title="Planning Board"
                    subtitle="Master Schedule"
                    icon={<LayoutDashboard className="w-8 h-8" />}
                    description="Capacity planning, global Gantt chart, and production tracking."
                    status="Operational"
                    statusColor="bg-emerald-500"
                />
                <PortalCard
                    title="Crew Command"
                    subtitle="Supervisor Deck"
                    icon={<Users className="w-8 h-8" />}
                    description="Daily assignments, team roster, and shop floor management."
                    status="Active"
                    statusColor="bg-[#c4a484]"
                    highlight
                />
                <PortalCard
                    title="Alert System"
                    subtitle="Blocker Reports"
                    icon={<AlertTriangle className="w-8 h-8" />}
                    description="Real-time issue tracking: OOS parts, machines down, personnel."
                    status="3 Alerts"
                    statusColor="bg-rose-500 animate-pulse"
                />
                <PortalCard
                    title="Quote Estimator"
                    subtitle="Costing Engine"
                    icon={<Calculator className="w-8 h-8" />}
                    description="Calculate points based on linear feet, difficulty, and material."
                    status="Ready"
                    statusColor="bg-emerald-500"
                />
                <PortalCard
                    title="Data Sync"
                    subtitle="Global Shop Import"
                    icon={<UploadCloud className="w-8 h-8" />}
                    description="Import daily job reports and synchronize PO status."
                    status="Idle"
                    statusColor="bg-slate-500"
                />
                <PortalCard
                    title="Design Lab"
                    subtitle="R&D Sandbox"
                    icon={<Gauge className="w-8 h-8" />}
                    description="Experimental prototypes and UI testing environment."
                    status="Beta"
                    statusColor="bg-indigo-500"
                />
            </div>
        </div>
    );
}

function PortalCard({ title, subtitle, icon, description, status, statusColor, highlight }: any) {
    return (
        <div className={`
            group relative bg-[#222] border rounded-xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)]
            ${highlight ? 'border-[#c4a484]/50 shadow-[0_0_20px_rgba(196,164,132,0.1)]' : 'border-[#333] hover:border-[#555]'}
        `}>
            {/* Metallic Gradient Background on Hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Header Bar (Simulated Plate) */}
            <div className="h-1.5 w-full bg-gradient-to-r from-[#333] via-[#555] to-[#333] border-b border-[#111]"></div>

            <div className="p-6 flex flex-col h-full relative z-10">
                <div className="flex justify-between items-start mb-5">
                    <div className={`p-3 rounded bg-gradient-to-br from-[#333] to-[#111] border border-[#444] shadow-inner text-[#c4a484] group-hover:text-[#e6cba8] transition-colors ${highlight ? 'text-[#e6cba8] border-[#c4a484]/30' : ''}`}>
                        {icon}
                    </div>
                    {/* Status LED */}
                    <div className="flex items-center gap-2 bg-[#111] px-2 py-1 rounded border border-[#333] shadow-inner">
                        <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_5px_currentColor] ${statusColor}`}></div>
                        <span className="text-[10px] font-mono text-[#888] uppercase tracking-wider">{status}</span>
                    </div>
                </div>

                <h3 className={`text-xl font-bold font-serif uppercase tracking-wide mb-1 transition-colors ${highlight ? 'text-[#e6cba8]' : 'text-slate-200 group-hover:text-white'}`}>
                    {title}
                </h3>
                <p className="text-xs font-bold text-[#666] uppercase tracking-widest mb-4 border-b border-[#333] pb-2">{subtitle}</p>

                <p className="text-sm text-[#999] leading-relaxed mb-6 font-light">
                    {description}
                </p>

                <div className="mt-auto flex justify-end">
                    <button className={`
                        px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2
                        ${highlight
                            ? 'bg-gradient-to-b from-[#c4a484] to-[#8b5a2b] text-black shadow-[0_2px_10px_rgba(196,164,132,0.3)] hover:brightness-110'
                            : 'bg-[#333] text-[#c4a484] border border-[#444] hover:bg-[#444] hover:border-[#666]'}
                    `}>
                        Access Module <ChevronRight className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Corner Rivet Details */}
            <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#333] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.8),1px_1px_0px_rgba(255,255,255,0.1)] opacity-50"></div>
            <div className="absolute bottom-3 left-3 w-1.5 h-1.5 rounded-full bg-[#333] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.8),1px_1px_0px_rgba(255,255,255,0.1)] opacity-50"></div>
        </div>
    );
}


// --- SUPERVISOR VIEW: Industrial Dashboard ---

function SupervisorView() {
    return (
        <div className="flex h-screen bg-[#111] overflow-hidden text-slate-200 font-sans">

            {/* Sidebar: Control Panel Style */}
            <div className="w-72 bg-[#1a1a1a] border-r border-[#333] flex flex-col flex-shrink-0 relative z-20 shadow-[5px_0_20px_rgba(0,0,0,0.5)]">
                {/* Brushed Metal Texture overlay */}
                <div className="absolute inset-0 opacity-10 pointer-events-none"
                    style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, #fff 2px, #fff 3px)' }}
                />

                <div className="h-20 flex items-center px-6 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] relative">
                    <div className="flex items-center gap-3 text-[#c4a484]">
                        <div className="p-2 bg-[#111] border border-[#444] rounded shadow-inner">
                            <Hammer className="w-5 h-5 drop-shadow-md" />
                        </div>
                        <div>
                            <span className="block font-bold tracking-widest uppercase text-sm font-serif">Crew<span className="text-white">Deck</span></span>
                            <span className="block text-[10px] text-[#666] tracking-widest uppercase">Supervisor Terminal</span>
                        </div>
                    </div>
                </div>

                <div className="p-5 flex-1 relative z-10 space-y-8">

                    {/* Dept Selector Gauge */}
                    <div className="bg-[#111] p-1 rounded-lg border border-[#333] shadow-inner">
                        <div className="bg-[#222] border border-[#444] rounded p-3 relative group cursor-pointer hover:border-[#c4a484]/50 transition-colors">
                            <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)] animate-pulse"></div>
                            <span className="text-[10px] text-[#666] uppercase tracking-widest font-bold block mb-1">Sector Control</span>
                            <div className="flex justify-between items-center">
                                <span className="font-bold text-[#e6cba8] font-serif text-lg">WELDING A</span>
                                <ChevronDown className="w-4 h-4 text-[#666] group-hover:text-[#c4a484]" />
                            </div>
                        </div>
                    </div>

                    {/* Navigation Switches */}
                    <div className="space-y-2">
                        <p className="text-[10px] text-[#555] uppercase tracking-widest font-bold ml-2 mb-2">Modules</p>
                        <NavSwitch icon={<ClipboardList />} label="Today's Plan" active />
                        <NavSwitch icon={<Users />} label="Roster Mgmt" />
                        <NavSwitch icon={<AlertTriangle />} label="Alerts" badge="3" alert />
                        <NavSwitch icon={<CheckSquare />} label="Approvals" />
                    </div>

                    {/* Stats */}
                    <div className="bg-[#151515] rounded border border-[#333] p-4">
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-[10px] text-[#666] font-bold uppercase">Load Capacity</span>
                            <span className="text-xs font-mono text-sky-400 font-bold">85%</span>
                        </div>
                        <div className="h-1.5 bg-[#000] rounded-full overflow-hidden border border-[#333]">
                            <div className="h-full bg-gradient-to-r from-sky-600 to-sky-400 w-[85%] relative">
                                <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:10px_10px]"></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* User Plate */}
                <div className="p-4 border-t border-[#333] bg-[#151515]">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center font-bold text-white border border-slate-600 shadow-lg">
                            FP
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <div className="text-sm font-bold text-slate-300 truncate font-serif">Felipe P.</div>
                            <div className="text-[10px] text-[#666] uppercase tracking-wider truncate">Shift Supervisor</div>
                        </div>
                        <Power className="w-4 h-4 text-[#444] hover:text-rose-500 cursor-pointer transition-colors" />
                    </div>
                </div>
            </div>

            {/* Main Workspace */}
            <div className="flex-1 flex flex-col h-full bg-[#151515] relative">
                {/* Workspace Background Grid */}
                <div className="absolute inset-0 opacity-[0.05] pointer-events-none"
                    style={{
                        backgroundImage: `linear-gradient(#333 1px, transparent 1px), linear-gradient(90deg, #333 1px, transparent 1px)`,
                        backgroundSize: '40px 40px'
                    }}
                />

                {/* Top Bar */}
                <div className="h-16 border-b border-[#333] bg-[#1a1a1a]/90 backdrop-blur flex items-center justify-between px-8 z-10 shadow-md">
                    <div className="flex items-center gap-6">
                        <h2 className="text-xl font-bold text-[#e6cba8] font-serif uppercase tracking-wide">Daily Assignments</h2>
                        <div className="h-6 w-px bg-[#333]"></div>
                        <div className="flex items-center gap-2 text-xs text-[#666] font-mono">
                            <span>SHIFT: 1</span>
                            <span className="text-[#333]">•</span>
                            <span>DATE: FEB 10, 2026</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <button className="px-4 py-1.5 bg-[#222] border border-[#444] rounded text-xs font-bold text-[#888] hover:text-[#c4a484] hover:border-[#c4a484] transition-all uppercase tracking-wider shadow-sm">
                            Print Sheet
                        </button>
                    </div>
                </div>

                {/* Scrollable Board */}
                <div className="flex-1 overflow-x-auto p-8 flex gap-8 z-0">

                    {/* Queue Column */}
                    <div className="w-80 flex-shrink-0 flex flex-col bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl h-full max-h-[calc(100vh-140px)]">
                        <div className="p-4 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] rounded-t-lg flex justify-between items-center">
                            <h3 className="font-bold text-[#888] text-xs uppercase tracking-widest flex items-center gap-2">
                                <Grip className="w-3 h-3" /> Job Queue
                            </h3>
                            <span className="bg-[#111] text-[#c4a484] border border-[#333] px-2 py-0.5 rounded text-xs font-mono">4</span>
                        </div>
                        <div className="p-4 space-y-3 overflow-y-auto flex-1 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]">
                            <JobCard id="WO-4521" name="NYCHA 125th St" points={32} due="Feb 14" priority="high" />
                            <JobCard id="WO-3890" name="Harbor Tower" points={18} due="Feb 18" />
                            <JobCard id="WO-4600" name="Metro Plaza" points={8} due="Feb 20" />
                            <JobCard id="WO-4412" name="City Point" points={6} due="Feb 22" />
                        </div>
                    </div>

                    {/* Worker Columns */}
                    <WorkerColumn
                        name="Carlos R."
                        initials="CR"
                        color="emerald"
                        load={32}
                        capacity={40}
                        jobs={[
                            { id: "WO-4521", name: "NYCHA 125th St", points: 32, due: "Feb 14", priority: "high", status: 'in-progress' }
                        ]}
                    />

                    <WorkerColumn
                        name="Mike S."
                        initials="MS"
                        color="blue"
                        load={18}
                        capacity={35}
                        jobs={[
                            { id: "WO-3890", name: "Harbor Tower", points: 18, due: "Feb 18", status: 'pending' }
                        ]}
                    />

                    <WorkerColumn
                        name="Tyrone J."
                        initials="TJ"
                        color="amber"
                        load={44}
                        capacity={40}
                        overloaded
                        jobs={[
                            { id: "WO-3777", name: "Hudson Yards", points: 22, due: "Feb 12", priority: "critical", status: 'in-progress' },
                            { id: "WO-3778", name: "Hudson Yards", points: 22, due: "Feb 12", status: 'pending' }
                        ]}
                    />

                </div>
            </div>
        </div>
    );
}

function NavSwitch({ icon, label, badge, active, alert }: any) {
    return (
        <div className={`
             relative group flex items-center gap-3 px-3 py-3 mx-2 rounded cursor-pointer transition-all border
            ${active
                ? 'bg-[#222] border-[#c4a484]/50 shadow-[0_0_10px_rgba(196,164,132,0.1)]'
                : 'bg-transparent border-transparent hover:bg-[#222] hover:border-[#333]'}
        `}>
            <div className={`text-[#666] transition-colors ${active ? 'text-sky-300' : 'group-hover:text-[#ccc]'}`}>
                {React.cloneElement(icon, { className: 'w-5 h-5' })}
            </div>

            <span className={`text-sm tracking-wide font-medium flex-1 ${active ? 'text-slate-200' : 'text-[#888] group-hover:text-[#ccc]'}`}>
                {label}
            </span>

            {/* Active Indicator Light */}
            {active && <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.8)]"></div>}

            {badge && (
                <span className={`
                    text-[10px] font-bold px-1.5 py-0.5 rounded border
                    ${alert
                        ? 'bg-rose-900/30 text-rose-400 border-rose-800'
                        : 'bg-[#111] text-[#666] border-[#333]'}
                `}>
                    {badge}
                </span>
            )}
        </div>
    );
}

function WorkerColumn({ name, initials, jobs, load, capacity, overloaded, color }: any) {
    const loadPercent = Math.min((load / capacity) * 100, 100);

    return (
        <div className="w-80 flex-shrink-0 flex flex-col bg-[#1a1a1a] border border-[#333] rounded-lg shadow-xl h-full overflow-hidden hover:border-[#555] transition-colors relative group">
            {/* Rivet Details */}
            <div className="absolute top-2 left-2 w-1 h-1 bg-[#444] rounded-full shadow-inner opacity-50"></div>
            <div className="absolute top-2 right-2 w-1 h-1 bg-[#444] rounded-full shadow-inner opacity-50"></div>

            <div className="p-4 border-b border-[#333] bg-gradient-to-b from-[#222] to-[#1a1a1a] shadow-sm relative">
                <div className="flex items-center gap-3 relative z-10">
                    <div className="w-10 h-10 rounded bg-[#111] flex items-center justify-center text-xs font-bold text-slate-300 border border-[#333] shadow-inner font-mono">
                        {initials}
                    </div>
                    <div className="flex-1">
                        <div className="font-bold text-slate-200 text-sm leading-none mb-2 font-serif tracking-wide">{name}</div>

                        {/* Gauge Bar */}
                        <div className="h-4 bg-[#0d0d0d] border border-[#333] rounded-sm relative overflow-hidden flex items-center px-1">
                            <div className={`absolute top-0 left-0 bottom-0 transition-all duration-500 opacity-60 ${overloaded ? 'bg-rose-600' : 'bg-emerald-600'}`} style={{ width: `${loadPercent}%` }}></div>
                            {/* Hash marks on gauge */}
                            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_20%,rgba(0,0,0,0.5)_20%,rgba(0,0,0,0.5)_25%,transparent_25%)] bg-[length:20px_100%]"></div>

                            <span className="relative z-10 text-[9px] font-mono text-white w-full text-center drop-shadow-md">
                                {load} / {capacity} PTS
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 bg-[#151515] p-2 space-y-2 min-h-[400px] shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
                {jobs.map((job: any) => (
                    <JobCard key={job.id} {...job} assigned />
                ))}
            </div>
        </div>
    );
}

function JobCard({ id, name, points, due, priority, status, assigned }: any) {
    return (
        <div className={`
             relative bg-gradient-to-b from-[#262626] to-[#1f1f1f] border rounded shadow-[0_2px_4px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_8px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 transition-all cursor-grab active:cursor-grabbing group overflow-hidden
            ${priority === 'critical' ? 'border-rose-900 border-l-4 border-l-rose-600' : 'border-[#333]'}
            ${priority === 'high' ? 'border-sky-900 border-l-4 border-l-sky-600' : ''}
            ${!priority ? 'border-l-4 border-l-[#444]' : ''}
        `}>
            {/* Status Indicator LED */}
            {status === 'in-progress' && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)] animate-pulse"></span>
                    <span className="text-[8px] uppercase font-bold text-emerald-500 tracking-wider">Active</span>
                </div>
            )}

            <div className="p-3">
                <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-mono font-bold text-[#666] group-hover:text-[#888] transition-colors">{id}</span>
                </div>

                <h4 className="font-bold text-[#ddd] text-sm mb-3 group-hover:text-sky-300 transition-colors font-serif tracking-wide">{name}</h4>

                <div className="flex items-center justify-between pt-2 border-t border-[#333]/50 mt-1">
                    <span className="px-1.5 py-0.5 rounded bg-[#111] border border-[#333] text-slate-400 text-[10px] font-mono font-bold shadow-inner">
                        {points} PTS
                    </span>
                    <div className={`text-[10px] font-bold flex items-center gap-1 uppercase tracking-wider ${priority ? 'text-sky-400' : 'text-[#555]'}`}>
                        <Calendar className="w-3 h-3" />
                        {due}
                    </div>
                </div>
            </div>
        </div>
    );
}
