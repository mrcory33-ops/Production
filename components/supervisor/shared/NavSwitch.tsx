import React from 'react';

export default function NavSwitch({ icon, label, active, onClick, count, isAlert }: {
    icon: React.ReactElement; label: string; active: boolean; onClick: () => void; count?: number; isAlert?: boolean;
}) {
    return (
        <div onClick={onClick} className={`relative group flex items-center gap-3 px-3 py-3 mx-2 rounded cursor-pointer transition-all border
            ${active ? 'bg-[#222] border-sky-500/50 shadow-[0_0_10px_rgba(56,189,248,0.1)]' : 'bg-transparent border-transparent hover:bg-[#222] hover:border-[#333]'}`}>
            <div className={`text-[#666] transition-colors ${active ? 'text-sky-300' : 'group-hover:text-[#ccc]'}`}>
                {React.cloneElement(icon, { className: 'w-5 h-5' } as React.SVGProps<SVGSVGElement>)}
            </div>
            <span className={`text-sm tracking-wide font-medium flex-1 ${active ? 'text-slate-200' : 'text-[#888] group-hover:text-[#ccc]'}`}>{label}</span>
            {active && <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.8)]" />}
            {count !== undefined && count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${isAlert ? 'bg-rose-900/30 text-rose-400 border-rose-800' : 'bg-[#111] text-[#666] border-[#333]'}`}>{count}</span>
            )}
        </div>
    );
}
