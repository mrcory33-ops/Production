import { AlertTriangle } from 'lucide-react';

interface BottleneckAlertProps {
    department: string;
    date: string;
    allocated: number;
    capacity: number;
}

export default function BottleneckAlert({ department, date, allocated, capacity }: BottleneckAlertProps) {
    if (allocated <= capacity) return null;

    return (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-2">
            <div className="flex items-center">
                <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
                <div>
                    <h3 className="text-red-800 font-bold">Bottleneck Detected: {department}</h3>
                    <p className="text-red-700 text-sm">
                        On {date}, allocated {allocated} points (Capacity: {capacity}).
                        Overload: +{allocated - capacity} pts.
                    </p>
                </div>
            </div>
        </div>
    );
}
