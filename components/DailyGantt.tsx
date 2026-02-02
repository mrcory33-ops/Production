'use client';

import { useEffect, useRef } from 'react';

// Wrapper for Frappe Gantt (to be implemented)
export default function DailyGantt() {
    const ganttRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Initialize Gantt here later
        console.log("Initialize Frappe Gantt");
    }, []);

    return (
        <div className="w-full overflow-x-auto border rounded bg-white">
            <div className="p-4 text-center text-gray-400">
                Gantt Chart Placeholder (Loading...)
                <div ref={ganttRef} id="gantt-chart"></div>
            </div>
        </div>
    );
}
