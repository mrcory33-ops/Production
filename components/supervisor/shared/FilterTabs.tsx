import { Job } from '@/types';
import { ProductFilter } from '../types';

export default function FilterTabs({ isWelding, productFilter, setProductFilter, jobs, fabCount, doorsCount, harmonicCount }: {
    isWelding: boolean; productFilter: ProductFilter; setProductFilter: (v: ProductFilter) => void;
    jobs: Job[]; fabCount: number; doorsCount: number; harmonicCount: number;
}) {
    const tabs: [ProductFilter, string, number, string][] = isWelding
        ? [['ALL', 'All', jobs.length, 'bg-[#333] text-slate-300 border-[#555]'], ['FAB', 'FAB', fabCount, 'bg-sky-900/40 text-sky-300 border-sky-700/50'], ['DOORS', 'Doors', doorsCount, 'bg-amber-900/40 text-amber-300 border-amber-700/50']]
        : [['ALL', 'All', jobs.length, 'bg-[#333] text-slate-300 border-[#555]'], ['FAB', 'FAB', fabCount, 'bg-sky-900/40 text-sky-300 border-sky-700/50'], ['DOORS', 'Doors', doorsCount, 'bg-amber-900/40 text-amber-300 border-amber-700/50'], ['HARMONIC', 'Harmonic', harmonicCount, 'bg-violet-900/40 text-violet-300 border-violet-700/50']];
    return (
        <div className="px-4 pb-3 flex gap-1">
            {tabs.map(([key, label, count, activeStyle]) => (
                <button key={key}
                    onClick={() => setProductFilter(key)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all border flex items-center gap-1.5
                        ${productFilter === key ? activeStyle : 'bg-transparent text-[#666] border-transparent hover:text-[#999]'}`}
                >
                    {label}
                    <span className={`text-[9px] ${productFilter === key ? 'opacity-80' : 'opacity-50'}`}>{count}</span>
                </button>
            ))}
        </div>
    );
}
