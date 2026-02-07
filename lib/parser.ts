import { read, utils } from 'xlsx';
import { Job, Department, ProductType, JobStatus } from '@/types';

// Helper to parse Excel dates or string dates
const parseDate = (value: any): Date => {
    if (!value) return new Date();
    if (value instanceof Date) return value;

    // Handle Excel Serial Date (numbers)
    if (typeof value === 'number') {
        // Assume Excel Serial Date if > 20000 (approx year 1954) AND < 100000
        if (value > 20000 && value < 100000) {
            // (value - 25569) * 86400 * 1000
            return new Date(Math.round((value - 25569) * 86400 * 1000));
        }
    }

    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
};

const normalizeKey = (key: string) => key.toUpperCase().replace(/[^A-Z0-9]/g, '');

const SALES_ORDER_KEY_CANDIDATES = new Set([
    'SO',
    'SONUM',
    'SONUMBER',
    'SONO',
    'SO#',
    'SALESORDER',
    'SALESORDERNUM',
    'SALESORDERNUMBER',
    'ORDER',
    'ORDERNUM',
    'ORDERNUMBER',
    'SOHEAD',
    'SOHEADNUM',
    'SOHEADNUMBER',
    'SOHEADER',
    'SOHEADERNUM',
    'SOHEADERNUMBER'
]);

const findSalesOrder = (row: any): string | undefined => {
    if (!row || typeof row !== 'object') return undefined;
    const keys = Object.keys(row);

    let matchedKey: string | undefined;
    for (const key of keys) {
        const normalized = normalizeKey(key);
        if (SALES_ORDER_KEY_CANDIDATES.has(normalized)) {
            matchedKey = key;
            break;
        }
    }

    if (!matchedKey) {
        matchedKey = keys.find(k => {
            const normalized = normalizeKey(k);
            return normalized.includes('SALES') && normalized.includes('ORDER');
        });
    }

    if (!matchedKey) return undefined;
    const value = row[matchedKey];
    if (value === undefined || value === null || value === '') return undefined;
    return String(value).trim();
};

const deriveSalesOrderFromWorkOrder = (workOrder: any): string | undefined => {
    if (!workOrder) return undefined;
    const digits = String(workOrder).replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(0, 5);
    return undefined;
};

// Helper to determine product type
const parseProductType = (division: string): ProductType => {
    const d = division?.toUpperCase() || '';
    if (d.startsWith('D')) return 'DOORS';
    if (d.startsWith('H')) return 'HARMONIC';
    return 'FAB'; // Default to FAB
};

// Helper to determine current department
const determineDepartment = (row: any): Department => {
    // Logic: Find the *last* TRUE dept.
    // DEPT1DONE (Eng) -> DEPT2DONE (Laser) -> DEPT3DONE (Brake) -> DEPT4DONE (Weld) -> DEPT5DONE (Polish) -> DEPT6DONE (Assy)

    if (row['DEPT6DONE'] === 'TRUE' || row['DEPT6DONE'] === true) return 'Assembly'; // Completed final department
    if (row['DEPT5DONE'] === 'TRUE' || row['DEPT5DONE'] === true) return 'Assembly';
    if (row['DEPT4DONE'] === 'TRUE' || row['DEPT4DONE'] === true) return 'Polishing'; // Wait, DEPT4 is Welding
    // If Dept 4 (Welding) is DONE, it moves to Polishing.

    if (row['DEPT3DONE'] === 'TRUE' || row['DEPT3DONE'] === true) return 'Welding';
    if (row['DEPT2DONE'] === 'TRUE' || row['DEPT2DONE'] === true) return 'Press Brake';
    if (row['DEPT1DONE'] === 'TRUE' || row['DEPT1DONE'] === true) return 'Laser';

    return 'Engineering'; // Default start
};

// Helper to find the first valid date from multiple columns
const findDueDate = (row: any, keys: string[]): Date => {
    for (const key of keys) {
        if (row[key]) {
            const d = parseDate(row[key]);
            // Basic validation: Must be > 2020 (ignore weird defaults)
            if (d.getFullYear() > 2020 && d.getFullYear() < 2030) {
                return d;
            }
        }
    }
    return new Date(); // Fallback
};

export const parseGlobalShopExport = async (fileBuffer: ArrayBuffer): Promise<Job[]> => {
    const workbook = read(fileBuffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with raw values
    const rows: any[] = utils.sheet_to_json(worksheet);

    // Group by Master Order Number (Column 'JOB' usually)
    // If 'JOB' isn't unique enough, we might need another key, but typically JOB groups WO_NUMs
    const jobGroups = new Map<string, any[]>();

    rows.forEach(row => {
        const masterId = row['WO_NUM']; // Strictly group by Work Order Number (Col O)
        if (!masterId) return; // Skip invalid rows
        if (!jobGroups.has(masterId)) {
            jobGroups.set(masterId, []);
        }
        jobGroups.get(masterId)!.push(row);
    });

    const parsedJobs: Job[] = [];

    jobGroups.forEach((groupRows, masterId) => {
        // 1. Identify Master Row (if any)
        const masterRow = groupRows.find(r => r['MASTER_JOB'] === 'TRUE' || r['MASTER_JOB'] === true) || groupRows[0];

        // 2. Aggregate Data
        let totalQty = 0;
        let totalWeldingPoints = 0;
        const customerParts = new Set<string>(); // Use Set to dedup

        groupRows.forEach(r => {
            totalQty += Number(r['QTY_ORDER'] || 0);
            totalWeldingPoints += Number(r['DEPT4HRS'] || 0);
            if (r['PART_CUSTOMER']) customerParts.add(String(r['PART_CUSTOMER']));
        });

        // 3. Map to Job Schema
        // Priority list for Due Date columns
        const dueDateKeys = ['WO_HEAD_DATE_DUE', 'PROMISED_DATE', 'WO_DUE_DATE', 'JOB_DUE_DATE', 'DATE_DUE', 'SO_HEAD_DATE_DUE'];
        const resolvedDueDate = findDueDate(masterRow, dueDateKeys);
        const resolvedSalesOrder = findSalesOrder(masterRow) || deriveSalesOrderFromWorkOrder(masterRow['WO_NUM']);

        const job: Job = {
            id: masterRow['WO_NUM'], // Use the Master's WO_NUM as the primary ID
            name: masterRow['JOB_NAME'] || 'Untitled Job',
            masterJobId: masterId,

            weldingPoints: totalWeldingPoints, // Using total points of the group
            quantity: totalQty,
            dueDate: resolvedDueDate,

            productType: parseProductType(masterRow['DIVISION']),
            salesperson: masterRow['REP_NAME'] || '',
            salesOrder: resolvedSalesOrder,

            isPriority: false, // Default, user must flag manually? Or look for specific notes?
            sizeClass: totalWeldingPoints >= 70 ? 'LARGE' : 'SMALL',

            status: 'PENDING', // Logic to check if started?
            currentDepartment: determineDepartment(masterRow),

            // Special Purchase Logic
            // Assuming headers map to AP/AQ if named nicely, otherwise might need column index lookup
            // Since SheetJS uses headers, we hope 'OpenPOs' is the header name given by user or default
            // If the CSV doesn't have headers for these, we might need a robust column index fallback.
            // For now, assume headers match or are close.
            openPOs: masterRow['OpenPOs'] === 'TRUE' || masterRow['OpenPOs'] === true,
            closedPOs: masterRow['ClosedPOs'] === 'TRUE' || masterRow['ClosedPOs'] === true,
            readyToNest: (masterRow['USER_6'] || '').toString().toUpperCase() === 'X' && determineDepartment(masterRow) === 'Engineering',

            partNumber: masterRow['PART'] || '',
            customerPartAndName: Array.from(customerParts),
            description: masterRow['PART_DESCRIPTION'] || '',
            notes: masterRow['USER_7'] || '',

            updatedAt: new Date()
        };

        if (job.dueDate.getFullYear() === 2029) {
            return; // Skip 2029 placeholder dates
        }

        // Filter: Ignore any jobs with no welding points
        if (!job.weldingPoints || job.weldingPoints < 1) {
            return;
        }

        parsedJobs.push(job);
    });

    return parsedJobs;
};

