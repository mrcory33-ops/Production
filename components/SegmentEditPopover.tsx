'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Department } from '@/types';

interface SegmentEditPopoverProps {
    department: Department;
    startDate: Date;
    endDate: Date;
    onSave: (newStart: Date, newEnd: Date) => void;
    onCancel: () => void;
}

export default function SegmentEditPopover({
    department,
    startDate,
    endDate,
    onSave,
    onCancel
}: SegmentEditPopoverProps) {
    const [newStart, setNewStart] = useState(format(startDate, 'yyyy-MM-dd'));
    const [newEnd, setNewEnd] = useState(format(endDate, 'yyyy-MM-dd'));
    const [error, setError] = useState<string | null>(null);

    const handleSave = () => {
        // Parse dates at local midnight to avoid timezone issues
        const [startYear, startMonth, startDay] = newStart.split('-').map(Number);
        const [endYear, endMonth, endDay] = newEnd.split('-').map(Number);

        const start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0);
        const end = new Date(endYear, endMonth - 1, endDay, 0, 0, 0);

        // Validation
        if (start > end) {
            setError('Start date must be on or before end date');
            return;
        }

        setError(null);
        onSave(start, end);
    };

    return (
        <div className="segment-edit-popover">
            <div className="popover-header">
                <h3>Edit {department} Schedule</h3>
            </div>
            <div className="popover-body">
                {error && (
                    <div className="error-message">
                        {error}
                    </div>
                )}
                <div className="form-group">
                    <label>Start Date</label>
                    <input
                        type="date"
                        value={newStart}
                        onChange={(e) => {
                            setNewStart(e.target.value);
                            setError(null);
                        }}
                    />
                </div>
                <div className="form-group">
                    <label>End Date</label>
                    <input
                        type="date"
                        value={newEnd}
                        onChange={(e) => {
                            setNewEnd(e.target.value);
                            setError(null);
                        }}
                    />
                </div>
            </div>
            <div className="popover-footer">
                <button onClick={onCancel} className="btn-cancel">
                    Cancel
                </button>
                <button onClick={handleSave} className="btn-save">
                    Save
                </button>
            </div>
        </div>
    );
}
