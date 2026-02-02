import { Job } from '@/types';
import clsx from 'clsx';

interface JobCardProps {
    job: Job;
    onClick?: (job: Job) => void;
}

export default function JobCard({ job, onClick }: JobCardProps) {
    return (
        <div
            className={clsx(
                "p-3 rounded border shadow-sm cursor-pointer hover:shadow-md transition-shadow",
                job.isPriority ? "bg-red-50 border-red-200" : "bg-white border-gray-200"
            )}
            onClick={() => onClick?.(job)}
        >
            <div className="flex justify-between items-start">
                <h4 className="font-bold text-sm">{job.id}</h4>
                <span className="text-xs text-gray-500">{job.quantity} qty</span>
            </div>
            <p className="text-xs truncate" title={job.name}>{job.name}</p>

            {/* Alerts */}
            <div className="mt-2 flex gap-1">
                {job.openPOs && !job.closedPOs && (
                    <span title="Waiting on Special Parts" className="w-2 h-2 rounded-full bg-orange-500 block" />
                )}
                {job.openPOs && job.closedPOs && (
                    <span title="Partial Special Parts" className="w-2 h-2 rounded-full bg-yellow-400 block" />
                )}
            </div>
        </div>
    );
}
