import { ProductType, Department } from '@/types';

export interface WorkerPool {
  count: number;
  outputPerDay: number;
  maxPerProject: number;
  productTypes?: ProductType[]; // Which product types this pool handles
}

export interface DepartmentCapacity {
  name: Department;
  displayOrder: number; // For Gantt row ordering
  isConstraint?: boolean; // Welding = true (the heartbeat)
  pools: WorkerPool[]; // Multiple pools for split departments
  dailyCapacity: number; // Total across all pools
  weeklyTarget: { min: number; max: number };
  timeMultiplier?: number; // Assembly = 1.25
  color: string; // Hex color for Gantt bars
  colorClass: string; // CSS class name
}

export const DEPT_ORDER: Department[] = ['Engineering', 'Laser', 'Press Brake', 'Welding', 'Polishing', 'Assembly'];

export const DEPARTMENT_CONFIG: Record<Department, DepartmentCapacity> = {
  Engineering: {
    name: 'Engineering',
    displayOrder: 1,
    pools: [{ count: 9, outputPerDay: 22, maxPerProject: 1 }],
    dailyCapacity: 198,
    weeklyTarget: { min: 850, max: 1000 },
    color: '#3b82f6',
    colorClass: 'dept-engineering'
  },
  Laser: {
    name: 'Laser',
    displayOrder: 2,
    pools: [{ count: 3, outputPerDay: 67.5, maxPerProject: 2 }],
    dailyCapacity: 202.5,
    weeklyTarget: { min: 850, max: 1000 },
    color: '#f97316',
    colorClass: 'dept-laser'
  },
  'Press Brake': {
    name: 'Press Brake',
    displayOrder: 3,
    pools: [{ count: 6, outputPerDay: 33, maxPerProject: 4 }],
    dailyCapacity: 198,
    weeklyTarget: { min: 850, max: 1000 },
    color: '#eab308',
    colorClass: 'dept-press-brake'
  },
  Welding: {
    name: 'Welding',
    displayOrder: 4,
    isConstraint: true, // THE HEARTBEAT
    pools: [
      { count: 6, outputPerDay: 15, maxPerProject: 3, productTypes: ['DOORS'] },
      { count: 7, outputPerDay: 15, maxPerProject: 3, productTypes: ['FAB', 'HARMONIC'] }
    ],
    dailyCapacity: 195,
    weeklyTarget: { min: 850, max: 1000 },
    color: '#ef4444',
    colorClass: 'dept-welding'
  },
  Polishing: {
    name: 'Polishing',
    displayOrder: 5,
    pools: [
      { count: 6, outputPerDay: 18, maxPerProject: 3, productTypes: ['FAB', 'HARMONIC'] },
      { count: 5, outputPerDay: 18, maxPerProject: 3, productTypes: ['DOORS'] }
    ],
    dailyCapacity: 198,
    weeklyTarget: { min: 850, max: 1000 },
    color: '#14b8a6',
    colorClass: 'dept-polishing'
  },
  Assembly: {
    name: 'Assembly',
    displayOrder: 6,
    pools: [{ count: 12, outputPerDay: 16, maxPerProject: 3 }],
    dailyCapacity: 192,
    weeklyTarget: { min: 850, max: 1000 },
    timeMultiplier: 1.25,
    color: '#8b5cf6',
    colorClass: 'dept-assembly'
  }
};

// Product type icon mapping
export const PRODUCT_TYPE_ICONS: Record<ProductType, string> = {
  FAB: '🔧',
  DOORS: '🚪',
  HARMONIC: '〰️'
};

/**
 * Get the applicable worker pool for a job's product type
 */
export const getPoolForJob = (dept: Department, productType: ProductType): WorkerPool | null => {
  const config = DEPARTMENT_CONFIG[dept];
  if (!config) return null;

  // If pools have product type filters, find matching pool
  const matchingPool = config.pools.find(p =>
    !p.productTypes || p.productTypes.includes(productType)
  );

  return matchingPool || config.pools[0];
};

/**
 * Calculate duration for a department based on job points and product type
 */
export const calculateDeptDuration = (
  dept: Department,
  points: number,
  productType: ProductType,
  description?: string,
  jobName?: string,
  requiresPainting?: boolean
): number => {
  const config = DEPARTMENT_CONFIG[dept];
  if (!config || !points) return 0;

  const pool = getPoolForJob(dept, productType);
  if (!pool) return 0;

  // Effective workers for this job
  const effectiveWorkers = Math.min(pool.maxPerProject, pool.count);

  // Daily output for this job
  const dailyOutput = effectiveWorkers * pool.outputPerDay;

  // Base duration
  let rawDays = points / dailyOutput;

  // Apply time multiplier (Assembly = 1.25x)
  if (config.timeMultiplier) {
    rawDays *= config.timeMultiplier;
  }

  // Rule: Door leaf jobs (not frames) require at least 2 days in Welding
  if (dept === 'Welding' && productType === 'DOORS') {
    const desc = (description || '').toLowerCase();
    const isDoorLeaf = desc.includes('door') && !desc.includes('frame');
    if (isDoorLeaf) {
      rawDays = Math.max(rawDays, 2);
    }
  }

  // Rule: NYCHA jobs require at least 3 days in Welding
  if (dept === 'Welding') {
    const isNYCHA = (jobName || '').toUpperCase().includes('NYCHA');
    if (isNYCHA) {
      rawDays = Math.max(rawDays, 3);
    }
  }

  // Rule: HARMONIC jobs with painting get extended Assembly time
  if (dept === 'Assembly' && productType === 'HARMONIC' && requiresPainting) {
    const paintDays = 5; // 1 work week for off-site painting
    const postPaintDays = points >= 50 ? 4 : 3; // Post-paint assembly based on job size
    rawDays += paintDays + postPaintDays;
  }

  // Round up to nearest half-day
  return Math.ceil(rawDays * 2) / 2;
};
