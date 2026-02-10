import { Text, View, StyleSheet } from '@react-pdf/renderer';
import { Job, Department } from '@/types';
import { format } from 'date-fns';
import { getDepartmentWindowForExport, isDepartmentScheduledInDateRange } from '@/lib/exportSchedule';

const styles = StyleSheet.create({
    section: {
        margin: 10,
        padding: 10,
        flexGrow: 1,
    },
    header: {
        fontSize: 18,
        fontFamily: 'Helvetica-Bold',
        marginBottom: 10,
        marginTop: 10,
        paddingBottom: 5,
        borderBottom: '2px solid #334155',
        color: '#0f172a',
        textTransform: 'uppercase',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    headerDate: {
        fontSize: 12,
        fontFamily: 'Helvetica',
        color: '#64748b',
        textTransform: 'none',
    },
    table: {
        display: 'flex',
        width: 'auto',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRightWidth: 0,
        borderBottomWidth: 0,
    },
    tableRow: {
        margin: 'auto',
        flexDirection: 'row',
    },
    tableHeaderRow: {
        backgroundColor: '#1e293b',
        color: '#ffffff',
    },
    tableCol: {
        // width: '25%', // Dynamic
        borderStyle: 'solid',
        borderWidth: 1,
        borderLeftWidth: 0,
        borderTopWidth: 0,
        borderColor: '#e2e8f0',
    },
    tableCell: {
        margin: 5,
        fontSize: 10,
        fontFamily: 'Helvetica',
    },
    tableHeaderCell: {
        margin: 5,
        fontSize: 10,
        fontFamily: 'Helvetica-Bold',
    },
});

interface DepartmentSectionProps {
    department: Department;
    jobs: Job[];
    dateRange: { start: Date | null; end: Date | null };
    showTableHeader?: boolean;
}

type DepartmentExportField =
    | 'jobNumber'
    | 'jobName'
    | 'description'
    | 'deptStart'
    | 'deptEnd'
    | 'points'
    | 'poStatus'
    | 'priority';

export interface DepartmentExportColumn {
    header: string;
    width: string;
    field: DepartmentExportField;
}

export const getDepartmentExportColumns = (department: Department): DepartmentExportColumn[] => {
    const includePoStatus = department === 'Welding' || department === 'Assembly';

    const columns: DepartmentExportColumn[] = [
        { header: 'Job #', width: includePoStatus ? '8%' : '9%', field: 'jobNumber' },
        { header: 'Job Name', width: includePoStatus ? '14%' : '16%', field: 'jobName' },
        { header: 'Description', width: includePoStatus ? '24%' : '30%', field: 'description' },
        { header: 'Date Entering Depart', width: '12%', field: 'deptStart' },
        { header: 'Depart Due Date', width: '12%', field: 'deptEnd' },
        { header: 'Points', width: '7%', field: 'points' },
    ];

    if (includePoStatus) {
        columns.push({ header: 'PO Status', width: '11%', field: 'poStatus' });
    }

    columns.push({ header: 'Priority', width: includePoStatus ? '12%' : '14%', field: 'priority' });
    return columns;
};

export default function DepartmentSection({ department, jobs, dateRange, showTableHeader = true }: DepartmentSectionProps) {
    const columns = getDepartmentExportColumns(department);
    const getPoStatus = (job: Job): string => {
        if (job.openPOs && !job.closedPOs) return 'Open';
        if (job.openPOs && job.closedPOs) return 'Partial';
        if (!job.openPOs && job.closedPOs) return 'Received';
        return '';
    };

    const rows = jobs
        .filter((job) => isDepartmentScheduledInDateRange(job, department, dateRange))
        .map((job) => ({
            job,
            departmentWindow: getDepartmentWindowForExport(job, department),
        }))
        .filter((entry): entry is { job: Job; departmentWindow: { start: Date; end: Date } } => !!entry.departmentWindow);

    const formatDateRange = () => {
        if (dateRange.start && dateRange.end) {
            return `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`;
        }
        return format(new Date(), 'MMMM d, yyyy');
    };

    const getCellValue = (
        field: string,
        job: Job,
        departmentWindow: { start: Date; end: Date }
    ) => {
        switch (field) {
            case 'jobNumber':
                return job.id;
            case 'jobName':
                return job.name || '-';
            case 'description':
                return job.description || '-';
            case 'deptStart':
                return format(departmentWindow.start, 'MM/dd/yy');
            case 'deptEnd':
                return format(departmentWindow.end, 'MM/dd/yy');
            case 'points':
                return Math.round(job.weldingPoints || 0);
            case 'poStatus':
                return getPoStatus(job);
            case 'priority':
                return job.priorityByDept?.[department]?.value ?? '';
            default:
                return '';
        }
    };

    return (
        <View style={styles.section}>
            <View style={styles.header}>
                <Text>{department} Schedule</Text>
                <Text style={styles.headerDate}>{formatDateRange()}</Text>
            </View>

            <View style={styles.table}>
                {/* Table Header */}
                {showTableHeader && (
                    <View style={[styles.tableRow, styles.tableHeaderRow]}>
                        {columns.map((col, idx) => (
                            <View key={idx} style={[styles.tableCol, { width: col.width, borderColor: '#334155' }]}>
                                <Text style={styles.tableHeaderCell}>{col.header}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Table Rows */}
                {rows.map(({ job, departmentWindow }, rowIdx) => (
                    <View
                        key={job.id}
                        style={[
                            styles.tableRow,
                            { backgroundColor: rowIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }
                        ]}
                    >
                        {columns.map((col, colIdx) => (
                            <View key={`${job.id}-${col.field}-${colIdx}`} style={[styles.tableCol, { width: col.width }]}>
                                <Text style={styles.tableCell}>
                                    {getCellValue(col.field, job, departmentWindow)}
                                </Text>
                            </View>
                        ))}
                    </View>
                ))}

                {rows.length === 0 && (
                    <View style={[styles.tableRow, { padding: 20, justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
                            No jobs scheduled for this period.
                        </Text>
                    </View>
                )}
            </View>
        </View>
    );
}
