import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Job, Department } from '@/types';
import { format } from 'date-fns';
import DepartmentSection, { getDepartmentExportColumns } from './DepartmentSection';

const styles = StyleSheet.create({
    page: {
        paddingHorizontal: 30,
        paddingTop: 84,
        paddingBottom: 36,
        backgroundColor: '#ffffff',
    },
    columnHeaderContainer: {
        position: 'absolute',
        top: 16,
        left: 30,
        right: 30,
    },
    columnHeaderMeta: {
        marginBottom: 6,
        fontSize: 9,
        fontFamily: 'Helvetica-Bold',
        color: '#475569',
    },
    columnHeaderRow: {
        flexDirection: 'row',
        backgroundColor: '#1e293b',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#334155',
        borderBottomWidth: 0,
    },
    columnHeaderCol: {
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: '#334155',
        borderTopWidth: 0,
        borderLeftWidth: 0,
    },
    columnHeaderText: {
        margin: 5,
        fontSize: 10,
        fontFamily: 'Helvetica-Bold',
        color: '#ffffff',
    },
    footer: {
        position: 'absolute',
        bottom: 10,
        left: 30,
        right: 30,
        fontSize: 8,
        textAlign: 'center',
        color: '#94a3b8',
        borderTop: '1px solid #e2e8f0',
        paddingTop: 10,
    }
});

interface SchedulePdfDocumentProps {
    groupedJobs: Record<Department, Job[]>;
    departments: Department[];
    dateRange: { start: Date | null; end: Date | null };
}

export default function SchedulePdfDocument({ groupedJobs, departments, dateRange }: SchedulePdfDocumentProps) {
    const formatDateRange = () => {
        if (dateRange.start && dateRange.end) {
            return `${format(dateRange.start, 'MM/dd/yyyy')} - ${format(dateRange.end, 'MM/dd/yyyy')}`;
        }
        if (dateRange.start) return `Starting ${format(dateRange.start, 'MM/dd/yyyy')}`;
        if (dateRange.end) return `Through ${format(dateRange.end, 'MM/dd/yyyy')}`;
        return 'All Scheduled Dates';
    };

    const generatedAt = format(new Date(), 'MM/dd/yyyy');
    return (
        <Document title="Production Schedule Export" author="Emjac Industries">
            {departments.map((dept) => {
                const jobs = groupedJobs[dept] || [];
                const columns = getDepartmentExportColumns(dept);

                return (
                    <Page key={dept} size="LETTER" orientation="landscape" style={styles.page}>
                        <View style={styles.columnHeaderContainer} fixed>
                            <Text style={styles.columnHeaderMeta}>
                                {dept} | {formatDateRange()} | Generated {generatedAt}
                            </Text>
                            <View style={styles.columnHeaderRow}>
                                {columns.map((col, idx) => (
                                    <View
                                        key={`${dept}-${col.field}`}
                                        style={[
                                            styles.columnHeaderCol,
                                            {
                                                width: col.width,
                                                borderLeftWidth: idx === 0 ? 1 : 0
                                            }
                                        ]}
                                    >
                                        <Text style={styles.columnHeaderText}>{col.header}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        <DepartmentSection
                            department={dept}
                            jobs={jobs}
                            dateRange={dateRange}
                            showTableHeader={false}
                        />

                        <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                            `Page ${pageNumber} of ${totalPages} - Emjac Production Scheduler`
                        )} fixed />
                    </Page>
                );
            })}
        </Document>
    );
}
