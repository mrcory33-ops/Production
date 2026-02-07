'use client';

import React from 'react';

export default function DesignLab() {
    return (
        <div className="min-h-screen bg-slate-50 p-12 space-y-20 font-sans">
            <div className="max-w-5xl mx-auto text-center mb-16">
                <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-4">Monochrome Industrial Design Lab</h1>
                <p className="text-slate-500">Exploring 5 distinct UI directions for the Production Schedule.</p>
            </div>

            {/* CONCEPT 1: UNIFIED CONTROL DECK */}
            <section>
                <div className="mb-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">1</span>
                    <h2 className="text-xl font-bold text-slate-900">The "Unified Control Deck"</h2>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full bg-white border-b border-slate-200 p-4">
                        <div className="flex flex-col gap-4">
                            {/* Top Row: Title + Main Filters */}
                            <div className="flex items-center justify-between gap-6">
                                <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">Planning Board</h1>

                                {/* Segmented Control: Departments */}
                                <div className="flex bg-slate-100 p-1 rounded-lg">
                                    {['Eng', 'Laser', 'Brake', 'Weld', 'Polish', 'Assembly'].map((dept, i) => (
                                        <button key={dept} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${i === 0 ? 'bg-white text-black shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                                            {dept}
                                        </button>
                                    ))}
                                </div>

                                {/* Segmented Control: View Mode */}
                                <div className="flex bg-slate-100 p-1 rounded-lg">
                                    <button className="px-4 py-1.5 text-xs font-bold rounded-md bg-white text-black shadow-sm">All Jobs</button>
                                    <button className="px-4 py-1.5 text-xs font-bold rounded-md text-slate-500 hover:text-slate-900">Active</button>
                                </div>
                            </div>

                            {/* Bottom Row: Secondary Filters & Actions */}
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    {/* Toggles */}
                                    <button className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50">
                                        Big Rocks
                                    </button>
                                    <button className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-bold text-slate-600 hover:border-slate-300 hover:bg-slate-50">
                                        Product Split
                                    </button>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Search Input */}
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-slate-400 text-xs">🔍</span>
                                        </div>
                                        <input
                                            type="text"
                                            className="pl-8 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs font-medium focus:ring-2 focus:ring-black focus:border-transparent transition-all w-64"
                                            placeholder="Search job..."
                                            readOnly
                                        />
                                    </div>

                                    {/* Primary Action */}
                                    <button className="px-4 py-1.5 bg-black text-white text-xs font-bold rounded-md hover:bg-slate-800 shadow-lg">
                                        + New Estimate
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CONCEPT 2: SWISS MINIMALIST */}
            <section>
                <div className="mb-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">2</span>
                    <h2 className="text-xl font-bold text-slate-900">The "Swiss Minimalist"</h2>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full bg-white p-6 border-b border-slate-100">
                        <div className="flex items-baseline justify-between mb-8">
                            <div className="flex items-baseline gap-8">
                                <h1 className="text-4xl font-black tracking-tighter text-black">PLANNING</h1>

                                {/* Minimalist Tabs */}
                                <div className="flex gap-6">
                                    <button className="text-sm font-bold text-black border-b-2 border-black pb-1">All Production</button>
                                    <button className="text-sm font-medium text-slate-400 hover:text-black transition-colors">Engineering</button>
                                    <button className="text-sm font-medium text-slate-400 hover:text-black transition-colors">Fabrication</button>
                                    <button className="text-sm font-medium text-slate-400 hover:text-black transition-colors">Assembly</button>
                                </div>
                            </div>

                            <div className="text-xs font-mono text-slate-400">
                                SYSTEM_READY • V7.3.0
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {/* Pill Toggles: Black outline when active, gray text when inactive */}
                                <button className="px-4 py-2 rounded-full border border-black text-black text-xs font-bold hover:bg-black hover:text-white transition-all">
                                    Filters
                                </button>
                                <button className="px-4 py-2 rounded-full border border-transparent text-slate-500 text-xs font-bold hover:bg-slate-50">
                                    Sort By: Job ID
                                </button>
                            </div>

                            {/* Search: Underline only */}
                            <div className="flex items-center gap-4">
                                <input
                                    className="py-2 px-0 bg-transparent border-b border-slate-200 text-sm font-medium text-black placeholder:text-slate-300 focus:border-black focus:outline-none w-64 transition-colors"
                                    placeholder="Type to search..."
                                    readOnly
                                />
                                <button className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center hover:scale-110 transition-transform">
                                    →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CONCEPT 3: TACTILE INDUSTRIAL */}
            <section>
                <div className="mb-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">3</span>
                    <h2 className="text-xl font-bold text-slate-900">The "Tactile Industrial"</h2>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full bg-slate-50 p-4 border-b border-slate-300 shadow-sm">
                        <div className="bg-white rounded-xl border border-slate-200 p-1 shadow-sm flex items-center justify-between">

                            {/* Left Utility Island */}
                            <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 rounded-lg m-1 border-r border-slate-100">
                                <span className="font-black text-slate-900 tracking-tight">BOARD</span>
                                <div className="h-4 w-px bg-slate-300"></div>
                                <button className="text-slate-500 hover:text-black transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                                </button>
                            </div>

                            {/* Center Control Well */}
                            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border-inner shadow-inner">
                                {['ENG', 'LSR', 'BRK', 'WLD', 'POL', 'ASM'].map((dept, i) => (
                                    <button key={dept} className={`px-4 py-2 text-xs font-black rounded shadow-sm border transition-all ${i === 2 ? 'bg-black border-black text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
                                        {dept}
                                    </button>
                                ))}
                            </div>

                            {/* Right Action Island */}
                            <div className="flex items-center gap-2 m-1">
                                <button className="px-4 py-2 bg-gradient-to-b from-white to-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 shadow-sm hover:shadow active:scale-95 transition-all">
                                    Filters
                                </button>
                                <button className="px-4 py-2 bg-black text-white text-xs font-bold rounded-lg shadow-md hover:translate-y-px active:shadow-sm transition-all border border-black">
                                    Run Estimate
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CONCEPT 4: TECHNICAL WIREFRAME */}
            <section>
                <div className="mb-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">4</span>
                    <h2 className="text-xl font-bold text-slate-900">The "Technical Wireframe"</h2>
                </div>
                <div className="border border-slate-900 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full bg-slate-950 p-4 text-slate-50 font-mono">
                        <div className="border border-slate-800 p-4 grid gap-4 relative">
                            {/* Decorative corner markers */}
                            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-slate-500"></div>
                            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-slate-500"></div>
                            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-slate-500"></div>
                            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-slate-500"></div>

                            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                                <div className="flex items-center gap-4">
                                    <span className="bg-slate-50 text-black px-2 py-0.5 text-xs font-bold">MODE: PLANNING</span>
                                    <span className="text-xs text-slate-500">ID: 00-24-3X</span>
                                </div>
                                <div className="flex gap-2 text-xs">
                                    <button className="hover:bg-slate-800 px-2 py-1">[EXPORT_CSV]</button>
                                    <button className="hover:bg-slate-800 px-2 py-1">[RESET_VIEW]</button>
                                </div>
                            </div>

                            <div className="flex gap-px bg-slate-800 border border-slate-800">
                                {['ENGINEERING', 'LASER', 'BRAKE', 'WELDING', 'POLISH', 'ASSEMBLY'].map((dept) => (
                                    <button key={dept} className="flex-1 py-3 text-[10px] tracking-widest bg-slate-950 hover:bg-slate-900 border-r border-slate-800 last:border-r-0 text-slate-400 hover:text-white transition-colors">
                                        {dept}
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-4 items-center">
                                <div className="flex-1 border border-slate-700 flex items-center">
                                    <span className="px-3 bg-slate-900 text-slate-500 text-xs border-r border-slate-700">QUERY</span>
                                    <input className="bg-transparent w-full px-3 py-2 text-xs focus:outline-none" placeholder="ENTER CRITERIA..." readOnly />
                                </div>
                                <button className="border border-slate-50 px-6 py-2 text-xs font-bold hover:bg-slate-50 hover:text-black transition-colors">
                                    EXECUTE
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CONCEPT 5: GLASS & STEEL */}
            <section>
                <div className="mb-4 flex items-center gap-4">
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold">5</span>
                    <h2 className="text-xl font-bold text-slate-900">The "Glass & Steel"</h2>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="w-full bg-slate-100 p-6 relative overflow-hidden">
                        {/* Abstract Background Element for 'glass' to show */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-slate-200 rounded-full blur-3xl -z-10"></div>

                        <div className="flex items-center gap-4 mb-4">
                            {/* Glass Container */}
                            <div className="flex-1 bg-white/60 backdrop-blur-md border border-white/50 p-2 rounded-2xl shadow-sm flex items-center justify-between">

                                <div className="flex items-center gap-2 pl-2">
                                    <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center text-white font-bold text-xs">
                                        PB
                                    </div>
                                    <span className="font-bold text-slate-800 text-sm">Planning Board</span>
                                </div>

                                {/* Floating Tabs */}
                                <div className="flex bg-slate-200/50 p-1 rounded-xl">
                                    {['Eng', 'Laser', 'Brake', 'Weld', 'Pol', 'Asm'].map((dept, i) => (
                                        <button key={dept} className={`px-5 py-2 text-xs font-bold rounded-lg transition-all ${i === 3 ? 'bg-white shadow-sm text-black' : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'}`}>
                                            {dept}
                                        </button>
                                    ))}
                                </div>

                                <div className="pr-2">
                                    <button className="w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center hover:bg-white transition-all text-slate-400">
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
