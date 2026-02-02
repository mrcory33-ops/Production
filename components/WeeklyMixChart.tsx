import { WeeklyTarget } from "@/types";

interface WeeklyMixChartProps {
    targets: WeeklyTarget;
    actuals: {
        fab: number;
        doors: number;
        harmonic: number;
    };
}

export default function WeeklyMixChart({ targets, actuals }: WeeklyMixChartProps) {
    // Mock data for skeleton
    return (
        <div className="bg-white p-4 rounded shadow border">
            <h3 className="text-lg font-bold mb-4">Weekly Product Mix</h3>

            {/* Fab */}
            <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                    <span>FAB</span>
                    <span>{actuals.fab} / {targets.fabTarget} pts</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                        className="bg-blue-600 h-4 rounded-full"
                        style={{ width: `${Math.min((actuals.fab / targets.fabTarget) * 100, 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Doors */}
            <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                    <span>DOORS</span>
                    <span>{actuals.doors} / {targets.doorsTarget} pts</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                        className="bg-green-600 h-4 rounded-full"
                        style={{ width: `${Math.min((actuals.doors / targets.doorsTarget) * 100, 100)}%` }}
                    ></div>
                </div>
            </div>

            {/* Harmonic */}
            <div>
                <div className="flex justify-between text-sm mb-1">
                    <span>HARMONIC</span>
                    <span>{actuals.harmonic} pts</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                        className="bg-purple-600 h-4 rounded-full"
                        style={{ width: '40%' }} // Dynamic in real implem
                    ></div>
                </div>
            </div>
        </div>
    );
}
