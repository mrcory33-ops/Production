
const DEPT_ORDER = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];
const mockJobs = [
    { id: 'JOB1-Eng', currentDepartment: 'Engineering', departmentSchedule: { Laser: { start: '2026-02-05', end: '2026-02-06' } } },
    { id: 'JOB2-Laser', currentDepartment: 'Laser', departmentSchedule: { Laser: { start: '2026-02-03', end: '2026-02-04' } } },
    { id: 'JOB3-Weld', currentDepartment: 'Welding', departmentSchedule: { Laser: { start: '2026-02-01', end: '2026-02-02' } } },
    { id: 'JOB4-EngToday', currentDepartment: 'Engineering', departmentSchedule: { Laser: { start: '2026-02-03', end: '2026-02-03' } } }
];

const today = new Date('2026-02-03T00:00:00.000Z');

function testFilter(visibleDepts, showActiveOnly) {
    console.log(`\nTesting: Visible=[${Array.from(visibleDepts)}], Active=${showActiveOnly}`);

    // Logic from Component
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
                // Simple overlap check with string/date - imitating component
                return today >= start && today <= end;
            });

            return isCurrent || isScheduledToday;
        }

        return jobDeptIndex !== -1 && jobDeptIndex <= maxVisibleIndex;
    });

    results.forEach(j => console.log(` - KEPT: ${j.id} (${j.currentDepartment})`));
}

const laserSet = new Set(['Laser']);
testFilter(laserSet, false); // All (Pipeline)
testFilter(laserSet, true);  // Active
