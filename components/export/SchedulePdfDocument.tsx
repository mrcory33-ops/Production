import { Document, Page, StyleSheet, Text } from '@react-pdf/renderer';
import { Job, Department } from '@/types';
import DepartmentSection from './DepartmentSection';

const styles = StyleSheet.create({
    page: {
        padding: 30,
        backgroundColor: '#ffffff',
    },
    footer: {
        position: 'absolute',
        bottom: 20,
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
    // Filter out departments with no jobs if we want to save paper?
    // Req 2: "Page 1... Welding... Page 2... Assembly"
    // implies page breaks between departments.
    // We can use `break` prop on View, or distinct Pages.
    // Distinct Pages gives better control over headers/footers per page.
    // However, if a table spans multiple pages, @react-pdf handles it better within a single Page with wrapping Views?
    // No, @react-pdf tables are tricky across pages.
    // Safest bet for "header per department":
    // Iterate departments.
    // If we put them all in one Document, @react-pdf will paginate.
    // If we use `<DepartmentSection break />`, it forces a new page for the section start.

    return (
        <Document title="Production Schedule Export" author="Emjac Industries">
            <Page size="LETTER" orientation="landscape" style={styles.page}>
                {departments.map((dept) => {
                    const jobs = groupedJobs[dept];
                    // Skip empty departments? 
                    // "Iterate through user's selected departments". If selected but empty, maybe show empty?
                    // Let's show filtered results. If user selected it, they expect a report.

                    if (!jobs) return null;

                    return (
                        <DepartmentSection
                            key={dept}
                            department={dept}
                            jobs={jobs}
                            dateRange={dateRange}
                        />
                    );
                })}

                <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                    `Page ${pageNumber} of ${totalPages} - Generated on ${new Date().toLocaleDateString()} - Emjac Production Scheduler`
                )} fixed />
            </Page>
        </Document>
    );
}
