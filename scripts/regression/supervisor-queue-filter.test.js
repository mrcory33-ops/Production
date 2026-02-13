#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('path');
const createJiti = require('jiti');

const ROOT = path.resolve(__dirname, '..', '..');
const jiti = createJiti(__filename, { interopDefault: true });
const {
    isJobAtOrBeforeDepartment,
    shouldIncludeJobForDepartmentQueue
} = jiti(path.join(ROOT, 'lib', 'supervisorQueue.ts'));

const makeJob = (currentDepartment) => ({ currentDepartment });

const run = () => {
    assert.equal(
        isJobAtOrBeforeDepartment('Welding', 'Welding'),
        true,
        'Current department should be included in its own queue.'
    );

    assert.equal(
        isJobAtOrBeforeDepartment('Press Brake', 'Welding'),
        true,
        'Upstream jobs should be included in downstream look-ahead queues.'
    );

    assert.equal(
        isJobAtOrBeforeDepartment('Polishing', 'Welding'),
        false,
        'Jobs that moved past a department must not remain in that department queue.'
    );

    assert.equal(
        isJobAtOrBeforeDepartment('Assembly', 'Polishing'),
        false,
        'Downstream jobs should be excluded from upstream queues.'
    );

    assert.equal(
        shouldIncludeJobForDepartmentQueue(makeJob('Laser'), 'Welding'),
        true,
        'Queue helper should include upstream jobs.'
    );

    assert.equal(
        shouldIncludeJobForDepartmentQueue(makeJob('Polishing'), 'Welding'),
        false,
        'Queue helper should exclude jobs already beyond selected department.'
    );

    assert.equal(
        // Unknown values should fail open to avoid dropping jobs unexpectedly.
        isJobAtOrBeforeDepartment('Unknown Dept', 'Welding'),
        true
    );

    console.log('[TEST] PASS - supervisor queue department filter behaves as expected.');
};

run();

