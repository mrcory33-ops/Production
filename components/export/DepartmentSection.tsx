import { Text, View, StyleSheet } from '@react-pdf/renderer';
import { Job, Department } from '@/types';
import { format } from 'date-fns';

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
}

export default function DepartmentSection({ department, jobs, dateRange }: DepartmentSectionProps) {
    // Columns Configuration
    const columns = [
        { header: 'Job #', width: '12%', field: 'id' },
        { header: 'Job Name', width: '18%', field: 'name' },
        { header: 'Description', width: '32%', field: 'description' },
        { header: 'Due Date', width: '14%', field: 'dueDate' },
        { header: 'Points', width: '12%', field: 'weldingPoints' },
        { header: 'Priority', width: '12%', field: 'priority' },
    ];

    const formatDateRange = () => {
        if (dateRange.start && dateRange.end) {
            return `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`;
        }
        return format(new Date(), 'MMMM d, yyyy');
    };

    return (
        <View style={styles.section} break>
            <View style={styles.header}>
                <Text>{department} Schedule</Text>
                <Text style={styles.headerDate}>{formatDateRange()}</Text>
            </View>

            <View style={styles.table}>
                {/* Table Header */}
                <View style={[styles.tableRow, styles.tableHeaderRow]}>
                    {columns.map((col, idx) => (
                        <View key={idx} style={[styles.tableCol, { width: col.width, borderColor: '#334155' }]}>
                            <Text style={styles.tableHeaderCell}>{col.header}</Text>
                        </View>
                    ))}
                </View>

                {/* Table Rows */}
                {jobs.map((job, rowIdx) => (
                    <View
                        key={job.id}
                        style={[
                            styles.tableRow,
                            { backgroundColor: rowIdx % 2 === 1 ? '#f8fafc' : '#ffffff' }
                        ]}
                    >
                        <View style={[styles.tableCol, { width: columns[0].width }]}>
                            <Text style={styles.tableCell}>{job.id}</Text>
                        </View>
                        <View style={[styles.tableCol, { width: columns[1].width }]}>
                            <Text style={styles.tableCell}>{job.name}</Text>
                        </View>
                        <View style={[styles.tableCol, { width: columns[2].width }]}>
                            <Text style={styles.tableCell}>{job.description}</Text>
                        </View>
                        <View style={[styles.tableCol, { width: columns[3].width }]}>
                            <Text style={styles.tableCell}>
                                {job.dueDate ? format(new Date(job.dueDate), 'MM/dd/yy') : '-'}
                            </Text>
                        </View>
                        <View style={[styles.tableCol, { width: columns[4].width }]}>
                            <Text style={styles.tableCell}>
                                {Math.round(job.weldingPoints || 0)}
                            </Text>
                        </View>
                        <View style={[styles.tableCol, { width: columns[5].width }]}>
                            <Text style={styles.tableCell}>
                                {job.priorityByDept?.[department]?.value ?? ''}
                            </Text>
                        </View>
                    </View>
                ))}

                {jobs.length === 0 && (
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
