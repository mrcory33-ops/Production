import { read, utils } from 'xlsx';
import { JCSComponentLine, JCSJobSummary, JCSPOSummary } from '@/types';

type HeaderKey =
    | 'jobId'
    | 'project'
    | 'codeSort'
    | 'componentId'
    | 'description'
    | 'purchaseOrder'
    | 'vendor'
    | 'qtyOrdered'
    | 'qtyReceived'
    | 'dueDate';

type HeaderIndexMap = Partial<Record<HeaderKey, number>>;

const HEADER_ALIASES: Record<HeaderKey, string[]> = {
    jobId: ['JOBF', 'JOB', 'WONUM', 'WONUMBER', 'WO_NUM', 'WONO'],
    project: ['MARKINFOF', 'MARKINFO', 'PROJECT', 'MARK', 'PARTCUSTOMERF', 'PARTCUSTOMER'],
    codeSort: ['CODESORT', 'CODE_SORT', 'SALESREPCODE', 'SALESREP'],
    componentId: ['COMPONENTF', 'COMPONENT', 'COMPONENTID', 'COMPID'],
    description: ['DESCRIPTIONF', 'DESCRIPTION', 'PARTDESCRIPTION', 'DESC'],
    purchaseOrder: ['PURCHASEORDER', 'PO', 'PONUM', 'PO_NUM', 'PONUMBER'],
    vendor: ['VENDORF', 'VENDOR', 'SUPPLIER'],
    qtyOrdered: ['QTYORDER', 'QTY_ORDER', 'ORDERQTY', 'QTYORD'],
    qtyReceived: ['QTYRECEIVED', 'QTY_RECEIVED', 'RECEIVEDQTY', 'QTYREC'],
    dueDate: ['DATEDUELINE', 'DATE_DUE_LINE', 'DUE_DATE', 'DUEDATE'],
};

const REQUIRED_FINGERPRINT_KEYS: HeaderKey[] = ['jobId', 'purchaseOrder', 'vendor', 'qtyOrdered', 'qtyReceived'];

const normalizeHeader = (value: unknown): string =>
    String(value ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');

const parseNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseDateValue = (value: unknown): Date | undefined => {
    if (!value) return undefined;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number') {
        if (value > 20000 && value < 100000) {
            const excelDate = new Date(Math.round((value - 25569) * 86400 * 1000));
            return Number.isNaN(excelDate.getTime()) ? undefined : excelDate;
        }
        return undefined;
    }
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const toDateOnlyIso = (date: Date): string => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized.toISOString();
};

const classifyComponentStatus = (
    qtyOrdered: number,
    qtyReceived: number,
    dueDate?: Date
): JCSComponentLine['status'] => {
    if (qtyOrdered > 0 && qtyReceived >= qtyOrdered) return 'received';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate) {
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        if (qtyReceived < qtyOrdered && due < today) return 'overdue';
    }
    return 'open';
};

const buildHeaderIndexMap = (row: unknown[]): HeaderIndexMap => {
    const byNormalized = new Map<string, number>();
    row.forEach((cell, idx) => {
        const normalized = normalizeHeader(cell);
        if (normalized) byNormalized.set(normalized, idx);
    });

    const indices: HeaderIndexMap = {};
    (Object.keys(HEADER_ALIASES) as HeaderKey[]).forEach((key) => {
        const match = HEADER_ALIASES[key].find(alias => byNormalized.has(alias));
        if (match) indices[key] = byNormalized.get(match)!;
    });
    return indices;
};

const scoreHeaderFingerprint = (indices: HeaderIndexMap): number =>
    REQUIRED_FINGERPRINT_KEYS.reduce((score, key) => score + (indices[key] !== undefined ? 1 : 0), 0);

const findHeaderRow = (rows: unknown[][]): { headerRowIndex: number; indices: HeaderIndexMap } | null => {
    const maxProbe = Math.min(rows.length, 40);
    let best: { headerRowIndex: number; indices: HeaderIndexMap; score: number } | null = null;

    for (let i = 0; i < maxProbe; i++) {
        const row = rows[i] || [];
        const indices = buildHeaderIndexMap(row);
        const score = scoreHeaderFingerprint(indices);
        if (score >= 4) {
            if (!best || score > best.score) {
                best = { headerRowIndex: i, indices, score };
            }
        }
    }

    if (!best) return null;
    return { headerRowIndex: best.headerRowIndex, indices: best.indices };
};

const stringAt = (row: unknown[], idx?: number): string => {
    if (idx === undefined) return '';
    return String(row[idx] ?? '').trim();
};

export const parseJobComponentStatus = async (fileBuffer: ArrayBuffer): Promise<JCSJobSummary[]> => {
    const workbook = read(fileBuffer, { type: 'array', cellDates: true });
    const jobMap = new Map<string, { project?: string; codeSort?: string; components: JCSComponentLine[] }>();

    workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = utils.sheet_to_json<unknown[]>(worksheet, {
            header: 1,
            raw: true,
            defval: '',
            blankrows: false,
        });

        const header = findHeaderRow(rows);
        if (!header) return;

        // JCS exports can be hierarchical:
        // - customer/project row carries MARK_INFO/CODE_SORT
        // - job row carries JOB
        // - following component rows carry PO/vendor/qty without repeating JOB
        // Keep row context so component lines can be attributed correctly.
        let currentJobId = '';
        let currentProject: string | undefined;
        let currentCodeSort: string | undefined;

        for (let r = header.headerRowIndex + 1; r < rows.length; r++) {
            const row = rows[r] || [];
            const rowJobId = stringAt(row, header.indices.jobId);
            const rowProject = stringAt(row, header.indices.project) || undefined;
            const rowCodeSort = stringAt(row, header.indices.codeSort) || undefined;

            if (rowProject) currentProject = rowProject;
            if (rowCodeSort) currentCodeSort = rowCodeSort;
            if (rowJobId) currentJobId = rowJobId;

            const purchaseOrder = stringAt(row, header.indices.purchaseOrder);
            if (!purchaseOrder) continue;

            const effectiveJobId = rowJobId || currentJobId;
            if (!effectiveJobId) continue;

            const project = rowProject || currentProject;
            const codeSort = rowCodeSort || currentCodeSort;
            const componentId = stringAt(row, header.indices.componentId);
            const description = stringAt(row, header.indices.description);
            const vendor = stringAt(row, header.indices.vendor);
            const qtyOrdered = Math.max(0, parseNumber(row[header.indices.qtyOrdered ?? -1]));
            const qtyReceived = Math.max(0, parseNumber(row[header.indices.qtyReceived ?? -1]));
            const dueDateParsed = parseDateValue(row[header.indices.dueDate ?? -1]);
            const dueDateIso = dueDateParsed ? toDateOnlyIso(dueDateParsed) : undefined;

            const component: JCSComponentLine = {
                componentId,
                description,
                purchaseOrder,
                vendor,
                qtyOrdered,
                qtyReceived,
                dueDate: dueDateIso,
                status: classifyComponentStatus(qtyOrdered, qtyReceived, dueDateParsed),
            };

            if (!jobMap.has(effectiveJobId)) {
                jobMap.set(effectiveJobId, { project, codeSort, components: [component] });
            } else {
                const existing = jobMap.get(effectiveJobId)!;
                if (!existing.project && project) existing.project = project;
                if (!existing.codeSort && codeSort) existing.codeSort = codeSort;
                existing.components.push(component);
            }
        }
    });

    const summaries: JCSJobSummary[] = [];

    jobMap.forEach((value, jobId) => {
        const poMap = new Map<string, JCSPOSummary>();
        value.components.forEach((component) => {
            const key = component.purchaseOrder;
            const existing = poMap.get(key);
            if (!existing) {
                poMap.set(key, {
                    purchaseOrder: component.purchaseOrder,
                    vendor: component.vendor || undefined,
                    lineCount: 1,
                    qtyOrderedTotal: component.qtyOrdered,
                    qtyReceivedTotal: component.qtyReceived,
                    status: component.status,
                });
                return;
            }

            existing.lineCount += 1;
            existing.qtyOrderedTotal += component.qtyOrdered;
            existing.qtyReceivedTotal += component.qtyReceived;

            // Precedence: overdue > open > received
            if (existing.status !== 'overdue') {
                if (component.status === 'overdue') {
                    existing.status = 'overdue';
                } else if (component.status === 'open' && existing.status === 'received') {
                    existing.status = 'open';
                }
            }
        });

        const poSummary = Array.from(poMap.values()).sort((a, b) => a.purchaseOrder.localeCompare(b.purchaseOrder));
        const receivedPOs = poSummary.filter(po => po.status === 'received').length;
        const overduePOs = poSummary.filter(po => po.status === 'overdue').length;
        const openOnlyPOs = poSummary.filter(po => po.status === 'open').length;
        const openPOs = openOnlyPOs + overduePOs;

        summaries.push({
            jobId,
            project: value.project,
            codeSort: value.codeSort,
            components: value.components,
            poSummary,
            totalPOs: poSummary.length,
            receivedPOs,
            openPOs,
            overduePOs,
            hasOpenPOs: openPOs > 0,
            hasClosedPOs: receivedPOs > 0,
        });
    });

    return summaries.sort((a, b) => a.jobId.localeCompare(b.jobId));
};
