import { useState, useMemo } from 'react';
import { X, Check, FileDown, Calendar, Filter } from 'lucide-react';
import { Job, Department, ProductType } from '@/types';
import { PDFDownloadLink } from '@react-pdf/renderer';
import SchedulePdfDocument from './SchedulePdfDocument';
import { usePdfExportFilter } from '@/hooks/usePdfExportFilter';
import { DEPT_ORDER, DEPARTMENT_CONFIG } from '@/lib/departmentConfig';
import { addDays, format } from 'date-fns';

interface ExportModalProps {
    jobs: Job[];
    onClose: () => void;
}

export default function ExportModal({ jobs, onClose }: ExportModalProps) {
    // 1. Filter States
    const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState<string>(format(addDays(new Date(), 30), 'yyyy-MM-dd'));

    const [productTypes, setProductTypes] = useState<Set<ProductType>>(new Set(['FAB', 'DOORS', 'HARMONIC']));
    const [bigRocksOnly, setBigRocksOnly] = useState(false);
    const [selectedDepartments, setSelectedDepartments] = useState<Set<Department>>(new Set(DEPT_ORDER));

    // 2. Validation
    const isValidDateRange = useMemo(() => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= 31 && diffDays >= 0; // 30 days max (approx month)
    }, [startDate, endDate]);

    // 3. Apply Filters using Hook
    const filters = useMemo(() => ({
        dateRange: {
            start: startDate ? new Date(startDate) : null,
            end: endDate ? new Date(endDate) : null
        },
        productTypes,
        bigRocksOnly,
        departments: selectedDepartments
    }), [startDate, endDate, productTypes, bigRocksOnly, selectedDepartments]);

    const groupedJobs = usePdfExportFilter(jobs, filters);

    // 4. Handlers
    const toggleProductType = (type: ProductType) => {
        const next = new Set(productTypes);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        setProductTypes(next);
    };

    const toggleDepartment = (dept: Department) => {
        const next = new Set(selectedDepartments);
        if (next.has(dept)) next.delete(dept);
        else next.add(dept);
        setSelectedDepartments(next);
    };

    const toggleAllDepartments = () => {
        if (selectedDepartments.size === DEPT_ORDER.length) {
            setSelectedDepartments(new Set());
        } else {
            setSelectedDepartments(new Set(DEPT_ORDER));
        }
    };

    return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <FileDown size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">Export Schedule</h2>
                            <p className="text-xs text-slate-500">Generate PDF reports with filtered views</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">

                    {/* Section 1: Date Range */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <Calendar size={16} />
                            <span>Date Range (Max 30 Days)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-slate-500 uppercase">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-slate-500 uppercase">End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    className={`w-full bg-slate-50 border rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 outline-none ${!isValidDateRange ? 'border-red-300 focus:ring-red-500' : 'border-slate-200 focus:ring-blue-500'}`}
                                />
                            </div>
                        </div>
                        {!isValidDateRange && (
                            <p className="text-xs text-red-500 font-medium">Date range exceeds 30 days limit.</p>
                        )}
                    </div>

                    <hr className="border-slate-100" />

                    {/* Section 2: Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left: Toggles */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                                <Filter size={16} />
                                <span>Filter Criteria</span>
                            </div>

                            {/* Product Types */}
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-slate-500 uppercase">Product Types</label>
                                <div className="flex gap-2">
                                    {['FAB', 'DOORS', 'HARMONIC'].map((type) => (
                                        <button
                                            key={type}
                                            onClick={() => toggleProductType(type as ProductType)}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${productTypes.has(type as ProductType)
                                                    ? 'bg-blue-600 text-white border-blue-600'
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Job Category */}
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-slate-500 uppercase">Job Category</label>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setBigRocksOnly(!bigRocksOnly)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all w-full justify-center ${bigRocksOnly
                                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                            }`}
                                    >
                                        {bigRocksOnly ? (
                                            <>
                                                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                                                Big Rocks Only
                                            </>
                                        ) : (
                                            <>
                                                <span className="w-2 h-2 bg-slate-300 rounded-full"></span>
                                                All Jobs
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Right: Departments */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <span>Departments</span>
                                    <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">{selectedDepartments.size}</span>
                                </label>
                                <button
                                    onClick={toggleAllDepartments}
                                    className="text-[10px] font-bold text-blue-600 hover:underline uppercase"
                                >
                                    {selectedDepartments.size === DEPT_ORDER.length ? 'None' : 'All'}
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                {DEPT_ORDER.map(dept => {
                                    const isSelected = selectedDepartments.has(dept);
                                    const config = DEPARTMENT_CONFIG[dept];
                                    return (
                                        <button
                                            key={dept}
                                            onClick={() => toggleDepartment(dept)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all text-left ${isSelected
                                                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : ''}`} style={{ backgroundColor: isSelected ? undefined : config.color }} />
                                            {dept}
                                            {isSelected && <Check size={12} className="ml-auto opacity-70" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors border border-transparent"
                    >
                        Cancel
                    </button>

                    {isValidDateRange ? (
                        <PDFDownloadLink
                            document={
                                <SchedulePdfDocument
                                    groupedJobs={groupedJobs}
                                    departments={DEPT_ORDER.filter(d => selectedDepartments.has(d))} // Preserve order
                                    dateRange={filters.dateRange}
                                />
                            }
                            fileName={`Schedule_Export_${format(new Date(), 'yyyyMMdd')}.pdf`}
                            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm shadow-blue-200 flex items-center gap-2 transition-all hover:translate-y-[-1px]"
                        >
                            {({ loading }) => (
                                <>
                                    <FileDown size={16} />
                                    {loading ? 'Generating...' : 'Download PDF'}
                                </>
                            )}
                        </PDFDownloadLink>
                    ) : (
                        <button
                            disabled
                            className="bg-slate-300 text-slate-500 px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 cursor-not-allowed"
                        >
                            <FileDown size={16} />
                            Invalid Range
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
