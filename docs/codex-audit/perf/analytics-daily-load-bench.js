const JOBS = 700;
const ITERATIONS = 20;
const RANGE_DAYS = 45;
const DEPARTMENTS = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const eachDayOfInterval = ({ start, end }) => {
  const days = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return days;
};

const isSameDay = (a, b) => {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
};

const seededRandom = (seed) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const makeJobs = () => {
  const rand = seededRandom(42);
  const jobs = [];
  const base = new Date('2026-02-01T00:00:00.000Z');

  for (let i = 0; i < JOBS; i += 1) {
    const startOffset = Math.floor(rand() * 18);
    const durations = DEPARTMENTS.map(() => 1 + Math.floor(rand() * 4));
    const schedule = {};

    let cursor = addDays(base, startOffset);
    for (let d = 0; d < DEPARTMENTS.length; d += 1) {
      const dept = DEPARTMENTS[d];
      const segStart = startOfDay(cursor);
      const segEnd = startOfDay(addDays(segStart, durations[d] - 1));
      schedule[dept] = { start: segStart.toISOString(), end: segEnd.toISOString() };
      cursor = addDays(segEnd, 1);
    }

    jobs.push({
      id: `J-${i}`,
      weldingPoints: 20 + Math.floor(rand() * 180),
      departmentSchedule: schedule
    });
  }

  return jobs;
};

const calcOld = (jobs, rangeStart, rangeEnd) => {
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const loadMap = new Map();

  days.forEach((day) => {
    if (isWeekend(day)) return;
    loadMap.set(day.toISOString(), {
      date: day,
      departments: {
        Engineering: 0,
        Laser: 0,
        'Press Brake': 0,
        Welding: 0,
        Polishing: 0,
        Assembly: 0
      },
      totalPoints: 0
    });
  });

  jobs.forEach((job) => {
    const schedule = job.departmentSchedule;
    if (!schedule || !job.weldingPoints) return;

    Object.entries(schedule).forEach(([dept, interval]) => {
      const start = new Date(interval.start);
      const end = new Date(interval.end);
      const durationDays = Math.max(1, eachDayOfInterval({ start, end }).filter((d) => !isWeekend(d)).length);
      const pointsPerDay = job.weldingPoints / durationDays;
      const jobDays = eachDayOfInterval({ start, end });

      jobDays.forEach((day) => {
        if (isWeekend(day)) return;

        const key = Array.from(loadMap.keys()).find((k) => isSameDay(new Date(k), day));
        if (!key) return;

        const entry = loadMap.get(key);
        if (dept in entry.departments) {
          entry.departments[dept] += pointsPerDay;
          entry.totalPoints += pointsPerDay;
        }
      });
    });
  });

  return Array.from(loadMap.values());
};

const calcNew = (jobs, rangeStart, rangeEnd) => {
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const loadMap = new Map();

  days.forEach((day) => {
    if (isWeekend(day)) return;
    const normalized = startOfDay(day);
    const key = normalized.toISOString();
    loadMap.set(key, {
      date: normalized,
      departments: {
        Engineering: 0,
        Laser: 0,
        'Press Brake': 0,
        Welding: 0,
        Polishing: 0,
        Assembly: 0
      },
      totalPoints: 0
    });
  });

  jobs.forEach((job) => {
    const schedule = job.departmentSchedule;
    if (!schedule || !job.weldingPoints) return;

    Object.entries(schedule).forEach(([dept, interval]) => {
      const start = new Date(interval.start);
      const end = new Date(interval.end);
      const durationDays = Math.max(1, eachDayOfInterval({ start, end }).filter((d) => !isWeekend(d)).length);
      const pointsPerDay = job.weldingPoints / durationDays;
      const jobDays = eachDayOfInterval({ start, end });

      jobDays.forEach((day) => {
        if (isWeekend(day)) return;

        const key = startOfDay(day).toISOString();
        const entry = loadMap.get(key);
        if (!entry) return;

        if (dept in entry.departments) {
          entry.departments[dept] += pointsPerDay;
          entry.totalPoints += pointsPerDay;
        }
      });
    });
  });

  return Array.from(loadMap.values());
};

const checksum = (rows) => {
  let sum = 0;
  for (const row of rows) {
    sum += Math.round(row.totalPoints * 1000);
  }
  return sum;
};

const bench = (label, fn) => {
  const start = process.hrtime.bigint();
  let check = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    check += checksum(fn());
  }
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(2)}ms (checksum ${check})`);
  return { ms, check };
};

const jobs = makeJobs();
const rangeStart = new Date('2026-02-01T00:00:00.000Z');
const rangeEnd = addDays(rangeStart, RANGE_DAYS);

const oldRes = bench('old-daily-loads', () => calcOld(jobs, rangeStart, rangeEnd));
const newRes = bench('new-daily-loads', () => calcNew(jobs, rangeStart, rangeEnd));

if (oldRes.check !== newRes.check) {
  process.exitCode = 1;
  console.error('Checksum mismatch between old and new calculations.');
}
