
const DEPT_ORDER = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

const mockJobs = [
    { id: 'JOB1', currentDepartment: 'Engineering', departmentSchedule: { Laser: { start: '2026-02-05', end: '2026-02-06' } } }, // Upstream of Laser
    { id: 'JOB2', currentDepartment: 'Laser', departmentSchedule: { Laser: { start: '2026-02-03', end: '2026-02-04' } } },       // In Laser
    { id: 'JOB3', currentDepartment: 'Welding', departmentSchedule: { Laser: { start: '2026-02-01', end: '2026-02-02' } } },     // Downstream of Laser
    { id: 'JOB4', currentDepartment: 'Engineering', departmentSchedule: { Laser: { start: '2026-02-03', end: '2026-02-03' } } }  // Upstream but scheduled today in Laser
];

const today = new Date('2026-02-03'); // Simulation Today

function testFilter(visibleDepts, showActiveOnly) {
    console.log(`\nTesting: Visible=${Array.from(visibleDepts)}, Active=${showActiveOnly}`);

    const results = mockJobs.filter(job => {
        if (!visibleDepts || visibleDepts.size === 0) return true;

        const jobDeptIndex = DEPT_ORDER.indexOf(job.currentDepartment);
        const visibleIndices = Array.from(visibleDepts).map(d => DEPT_ORDER.indexOf(d));
        const maxVisibleIndex = Math.max(...visibleIndices);

        if (showActiveOnly) {
            const isCurrent = visibleDepts.has(job.currentDepartment);
            const isScheduledToday = Array.from(visibleDepts).some(dept => {
                const schedule = job.departmentSchedule?.[dept];
                if (!schedule) return false;
                const start = new Date(schedule.start);
                const end = new Date(schedule.end);
                return today >= start && today <= end;
            });
            return isCurrent || isScheduledToday;
        }

        // Pipeline View
        return jobDeptIndex !== -1 && jobDeptIndex <= maxVisibleIndex;
    });

    results.forEach(j => console.log(` - KEPT: ${j.id} (${j.currentDepartment})`));
}

// Scenario: Select Laser
const laserSet = new Set(['Laser']);

// 1. Pipeline View (Active OFF)
// Expect: JOB1 (Eng), JOB2 (Laser), JOB4 (Eng). JOB3 (Weld) should be hidden.
testFilter(laserSet, false);

// 2. Active ON
// Expect: JOB2 (In Laser), JOB4 (Sched today). JOB1 (Eng, not today), JOB3 (Weld) hidden.
testFilter(laserSet, true);
