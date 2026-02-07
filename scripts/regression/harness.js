#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const createJiti = require('jiti');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'codex-audit', 'regression', 'baseline.json');
const LATEST_PATH = path.join(ROOT, 'docs', 'codex-audit', 'regression', 'latest.json');
const FIXED_NOW_ISO = '2026-02-07T12:00:00.000Z';

const createHarnessJiti = () =>
    createJiti(path.join(ROOT, 'scripts', 'regression', '__runner__.js'), { interopDefault: true });

const withFixedNow = async (isoNow, fn) => {
    const RealDate = Date;
    const fixedMs = new RealDate(isoNow).getTime();

    class MockDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                super(fixedMs);
                return;
            }
            super(...args);
        }

        static now() {
            return fixedMs;
        }
    }

    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;

    // eslint-disable-next-line no-global-assign
    Date = MockDate;
    try {
        return await fn();
    } finally {
        // eslint-disable-next-line no-global-assign
        Date = RealDate;
    }
};

const makeJob = (overrides) => ({
    id: 'WO-DEFAULT',
    name: 'Default Job',
    weldingPoints: 40,
    quantity: 1,
    dueDate: new Date('2026-02-28T00:00:00.000Z'),
    productType: 'FAB',
    salesperson: 'Sales Team',
    salesOrder: 'SO-DEFAULT',
    isPriority: false,
    sizeClass: 'SMALL',
    currentDepartment: 'Engineering',
    status: 'PENDING',
    openPOs: false,
    closedPOs: false,
    readyToNest: true,
    partNumber: 'PN-DEFAULT',
    customerPartAndName: ['CPN-DEFAULT'],
    customerName: 'General Hospital',
    description: 'frame knock down 16 ga stainless',
    notes: '',
    updatedAt: new Date('2026-02-07T00:00:00.000Z'),
    fastShip: false,
    ...overrides
});

const buildJobsFixture = () => [
    makeJob({
        id: 'WO-1001',
        name: 'Airlock Frame Set',
        weldingPoints: 122,
        quantity: 8,
        dueDate: new Date('2026-02-19T00:00:00.000Z'),
        productType: 'FAB',
        salesOrder: 'SO-7001',
        description: 'frame knock down 14 ga stainless'
    }),
    makeJob({
        id: 'WO-1002',
        name: 'Door Leaf Package',
        weldingPoints: 78,
        quantity: 6,
        dueDate: new Date('2026-02-24T00:00:00.000Z'),
        productType: 'DOORS',
        salesOrder: 'SO-7002',
        description: 'door leaf lock seam 16 ga stainless'
    }),
    makeJob({
        id: 'WO-1003',
        name: 'Wall Panel Run',
        weldingPoints: 55,
        quantity: 14,
        dueDate: new Date('2026-02-27T00:00:00.000Z'),
        productType: 'FAB',
        salesOrder: 'SO-7003',
        description: 'wall panels 18 ga galvanized'
    }),
    makeJob({
        id: 'WO-1004',
        name: 'Dish Table Build',
        weldingPoints: 88,
        quantity: 4,
        dueDate: new Date('2026-03-02T00:00:00.000Z'),
        productType: 'FAB',
        salesOrder: 'SO-7004',
        description: 'dish table 14 ga ss304',
        fastShip: true
    }),
    makeJob({
        id: 'WO-1005',
        name: 'Harmonic Painted Skid',
        weldingPoints: 61,
        quantity: 2,
        dueDate: new Date('2026-03-05T00:00:00.000Z'),
        productType: 'HARMONIC',
        salesOrder: 'SO-7005',
        description: 'harmonic module base',
        requiresPainting: true
    }),
    makeJob({
        id: 'WO-1006',
        name: 'Corner Guard Batch',
        weldingPoints: 39,
        quantity: 20,
        dueDate: new Date('2026-03-06T00:00:00.000Z'),
        productType: 'FAB',
        salesOrder: 'SO-7006',
        description: 'corner guards 18 ga stainless'
    }),
    makeJob({
        id: 'WO-1007',
        name: 'NYCHA Door Package',
        weldingPoints: 96,
        quantity: 5,
        dueDate: new Date('2026-03-09T00:00:00.000Z'),
        productType: 'DOORS',
        salesOrder: 'SO-7002',
        description: 'nycha door frame package'
    }),
    makeJob({
        id: 'WO-1008',
        name: 'Germfree Lab Casework',
        weldingPoints: 74,
        quantity: 3,
        dueDate: new Date('2026-03-11T00:00:00.000Z'),
        productType: 'FAB',
        salesOrder: 'SO-7007',
        customerName: 'Germfree Laboratories',
        description: 'frame case opening 16 ga ss316'
    })
];

const sortDeep = (value) => {
    if (value instanceof Date) return value.toISOString();

    if (Array.isArray(value)) return value.map(sortDeep);

    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            const next = value[key];
            if (typeof next === 'undefined') continue;
            out[key] = sortDeep(next);
        }
        return out;
    }

    return value;
};

const toCanonicalJson = (value) => JSON.stringify(sortDeep(value), null, 2) + '\n';

const firstDiffLine = (aText, bText) => {
    const a = aText.split('\n');
    const b = bText.split('\n');
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
        if (a[i] !== b[i]) {
            return {
                line: i + 1,
                baseline: a[i] ?? '(missing)',
                current: b[i] ?? '(missing)'
            };
        }
    }
    return null;
};

const createSnapshot = async () => {
    const jiti = createHarnessJiti();
    const scheduler = jiti(path.join(ROOT, 'lib', 'scheduler.ts'));
    const quoteEstimator = jiti(path.join(ROOT, 'lib', 'quoteEstimator.ts'));

    const sourceJobs = buildJobsFixture();
    const schedulingInput = sourceJobs.map((job) => structuredClone(job));

    const scheduled = scheduler.scheduleAllJobs(schedulingInput, []);
    const scheduledJobs = scheduled.jobs.map((job) => structuredClone(job));
    const directInsights = scheduler.analyzeScheduleFromJobs(scheduledJobs.map((job) => structuredClone(job)));

    const quoteInputBase = {
        totalValue: 185000,
        totalQuantity: 26,
        bigRocks: [{ value: 65000 }, { value: 42000 }, { value: 18000 }],
        isREF: true,
        engineeringReadyDate: new Date('2026-02-10T00:00:00.000Z'),
        productType: 'FAB'
    };

    const estimate = await quoteEstimator.simulateQuoteSchedule(
        { ...quoteInputBase },
        scheduledJobs.map((job) => structuredClone(job))
    );

    const feasibility = await quoteEstimator.checkAdvancedFeasibility(
        { ...quoteInputBase, targetDate: new Date('2026-03-06T00:00:00.000Z') },
        scheduledJobs.map((job) => structuredClone(job))
    );

    return {
        meta: {
            generatedAtFixedNow: FIXED_NOW_ISO,
            fixtureVersion: 1
        },
        scheduler: {
            inputJobCount: sourceJobs.length,
            scheduledJobCount: scheduled.jobs.length,
            jobs: scheduled.jobs,
            insightsFromPipeline: scheduled.insights,
            insightsFromDirectAnalyze: directInsights
        },
        quoteEstimator: {
            estimate,
            feasibility
        }
    };
};

const writeFile = (targetPath, contents) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, contents, 'utf8');
};

const run = async () => {
    const mode = process.argv[2] || 'verify';
    if (!['baseline', 'verify'].includes(mode)) {
        console.error('Usage: node scripts/regression/harness.js [baseline|verify]');
        process.exit(2);
    }

    const snapshot = await withFixedNow(FIXED_NOW_ISO, createSnapshot);
    const currentText = toCanonicalJson(snapshot);

    if (mode === 'baseline') {
        writeFile(BASELINE_PATH, currentText);
        writeFile(LATEST_PATH, currentText);
        console.log(`[HARNESS] Baseline written: ${path.relative(ROOT, BASELINE_PATH)}`);
        return;
    }

    if (!fs.existsSync(BASELINE_PATH)) {
        console.error('[HARNESS] Missing baseline. Run baseline mode first.');
        process.exit(1);
    }

    const baselineText = fs.readFileSync(BASELINE_PATH, 'utf8');
    writeFile(LATEST_PATH, currentText);

    if (baselineText !== currentText) {
        const diff = firstDiffLine(baselineText, currentText);
        console.error('[HARNESS] Regression detected. Outputs differ from baseline.');
        if (diff) {
            console.error(`[HARNESS] First difference at line ${diff.line}`);
            console.error(`[HARNESS] Baseline: ${diff.baseline}`);
            console.error(`[HARNESS] Current : ${diff.current}`);
        }
        console.error(`[HARNESS] Latest snapshot written to ${path.relative(ROOT, LATEST_PATH)}`);
        process.exit(1);
    }

    console.log('[HARNESS] PASS - outputs match baseline.');
};

run().catch((error) => {
    console.error('[HARNESS] Fatal error:', error);
    process.exit(1);
});
