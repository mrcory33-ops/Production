interface CalendarPickerProps {
    value: string; // YYYY-MM-DD
    onChange: (date: string) => void;
}

export default function CalendarPicker({ value, onChange }: CalendarPickerProps) {
    return (
        <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Schedule Date:</label>
            <input
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2 border"
            />
        </div>
    );
}
