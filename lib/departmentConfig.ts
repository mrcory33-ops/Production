import { ProductType, Department, WeldingSubStageInfo, DoorSubType } from '@/types';

export interface WorkerPool {
  count: number;
  outputPerDay: number;
  maxPerProject: number;
  productTypes?: ProductType[]; // Which product types this pool handles
  weeklyCapacity?: number;      // Explicit weekly capacity override (pts/wk). When set, scheduling uses this instead of count × outputPerDay × 5.
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
    // FAB pool:   5 engineers × 19 pts/day = 95/day × 5 = 475/week
    // DOORS pool: 4 engineers × 19 pts/day = 76/day × 5 = 380/week
    // Combined: 171/day × 5 = 855/week (split across product types)
    pools: [
      { count: 5, outputPerDay: 19, maxPerProject: 1, productTypes: ['FAB', 'HARMONIC'] },
      { count: 4, outputPerDay: 19, maxPerProject: 1, productTypes: ['DOORS'] }
    ],
    dailyCapacity: 171,
    weeklyTarget: { min: 850, max: 950 },
    color: '#3b82f6',
    colorClass: 'dept-engineering'
  },
  Laser: {
    name: 'Laser',
    displayOrder: 2,
    // 3 workers × 57 pts/day = 171/day × 5 = 855/week
    pools: [{ count: 3, outputPerDay: 57, maxPerProject: 2 }],
    dailyCapacity: 171,
    weeklyTarget: { min: 850, max: 950 },
    color: '#f97316',
    colorClass: 'dept-laser'
  },
  'Press Brake': {
    name: 'Press Brake',
    displayOrder: 3,
    // 6 workers × 28.5 pts/day = 171/day × 5 = 855/week
    pools: [{ count: 6, outputPerDay: 28.5, maxPerProject: 4 }],
    dailyCapacity: 171,
    weeklyTarget: { min: 850, max: 950 },
    color: '#eab308',
    colorClass: 'dept-press-brake'
  },
  Welding: {
    name: 'Welding',
    displayOrder: 4,
    isConstraint: true, // THE HEARTBEAT
    // DOORS pool: 6 × 14 = 84/day × 5 = 420/week
    // FAB pool:   7 × 14 = 98/day × 5 = 490/week
    // Combined: 182/day × 5 = 910/week (split across product types)
    pools: [
      { count: 6, outputPerDay: 14, maxPerProject: 3, productTypes: ['DOORS'], weeklyCapacity: 850 },
      { count: 7, outputPerDay: 14, maxPerProject: 3, productTypes: ['FAB', 'HARMONIC'], weeklyCapacity: 850 }
    ],
    dailyCapacity: 182,
    weeklyTarget: { min: 850, max: 950 },
    color: '#ef4444',
    colorClass: 'dept-welding'
  },
  Polishing: {
    name: 'Polishing',
    displayOrder: 5,
    // Shared pool: 11 workers × 16 pts/day = 176/day × 5 = 880/week
    // No product-type split — all workers handle all products.
    // Seamless door throughput is limited upstream by the robot (14 doors/day),
    // not by polishing capacity itself.
    pools: [{ count: 11, outputPerDay: 16, maxPerProject: 3 }],
    dailyCapacity: 176,
    weeklyTarget: { min: 850, max: 950 },
    color: '#14b8a6',
    colorClass: 'dept-polishing'
  },
  Assembly: {
    name: 'Assembly',
    displayOrder: 6,
    // 12 workers × 14 pts/day = 168/day × 5 = 840/week
    pools: [{ count: 12, outputPerDay: 14, maxPerProject: 3 }],
    dailyCapacity: 168,
    weeklyTarget: { min: 850, max: 950 },
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

// Customer-specific scheduling multipliers
// outputMultiplier < 1 means workers produce LESS per hour (job takes longer)
// engineeringMaxDays caps Engineering duration for pre-engineered items
export interface CustomerMultiplier {
  outputMultiplier: number;       // Applied to all depts except Engineering
  engineeringMaxDays: number;     // Cap Engineering duration
}

export const CUSTOMER_MULTIPLIERS: Record<string, CustomerMultiplier> = {
  'GERMFREE': { outputMultiplier: 0.8, engineeringMaxDays: 1 }
};

/**
 * Look up customer multiplier by name (case-insensitive, partial match)
 */
export const getCustomerMultiplier = (customerName?: string): CustomerMultiplier | null => {
  if (!customerName) return null;
  const upper = customerName.toUpperCase().trim();
  for (const [key, config] of Object.entries(CUSTOMER_MULTIPLIERS)) {
    if (upper.includes(key)) return config;
  }
  return null;
};

// Batch efficiency discounts
// When similar jobs are batched together, setup time is shared
export const BATCH_EFFICIENCY = {
  twoItems: 0.10,   // 10% discount for 2 batched items
  threeOrMore: 0.15, // 15% discount for 3+ batched items
  maxDiscount: 0.15  // Cap at 15%
} as const;

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

// ========================================================================
// DOOR WELDING SUB-PIPELINE — Throughput & Classification
// ========================================================================

/** Throughput rates for door welding sub-stages (doors per day) */
export const DOOR_THROUGHPUT = {
  press: { lowPointRate: 17, highPointRate: 13, pointThreshold: 5, workers: 3 }, // doors/day — 3 main workers
  /** Lock seam overflow: 2 extra workers from welding dept handle lock seam when
   *  the 3 main press workers are fully booked with seamless/standard doors.
   *  Throughput ≈ 2/3 of standard rate (2 workers instead of 3). */
  lockSeamOverflow: { lowPointRate: 11, highPointRate: 9, workers: 2 },
  robot: { doorsPerDay: 14 },
  flood: { tubeFramesPerDay: 5, pressPerDay: 4, fullWeldPerDay: 4 },
} as const;

/** Sub-stage colors for Gantt visualization */
export const WELDING_SUBSTAGE_COLORS: Record<string, string> = {
  press: '#ef4444', // red-500
  robot: '#b91c1c', // red-700
  tubeFrame: '#f87171', // red-400
  fullWeld: '#dc2626', // red-600
};

/** Sub-stage labels for Gantt visualization */
export const WELDING_SUBSTAGE_LABELS: Record<string, string> = {
  press: 'P', robot: 'R', tubeFrame: 'T', fullWeld: 'W',
};

/** Classify a door description as flood or lock seam */
export const isFloodDoor = (description: string): boolean => {
  const d = (description || '').toLowerCase();
  return d.includes('flood');
};

export const isLockSeam = (description: string): boolean => {
  const d = (description || '').toLowerCase();
  return d.includes('lock seam') || d.includes('lockseam') || d.includes('lock-seam');
};

/** Full door classification */
export const classifyDoorSubType = (description: string, jobName: string): DoorSubType => {
  if ((jobName || '').toUpperCase().includes('NYCHA')) return 'nycha';
  if (isFloodDoor(description)) return 'flood';
  if (isLockSeam(description)) return 'standard_lockseam';
  return 'standard_seamless'; // Default: seamless (goes through robot)
};

/**
 * Calculate welding sub-stage breakdown for door jobs.
 *
 * @param quantity Number of doors in the job
 * @param pointsPerDoor Welding points per door (used for press rate selection)
 * @param description Job description (for flood/lock seam detection)
 * @param jobName Job name (for NYCHA detection)
 * @returns Array of sub-stage info, or null if not a sub-pipeline job
 */
export const calculateDoorWeldingSubStages = (
  quantity: number,
  pointsPerDoor: number,
  description: string,
  jobName: string
): { subType: DoorSubType; stages: WeldingSubStageInfo[]; totalDays: number } | null => {
  const subType = classifyDoorSubType(description, jobName);

  // NYCHA: no sub-pipeline, use existing 3-day minimum rule
  if (subType === 'nycha') return null;

  const qty = Math.max(1, quantity);
  const stages: WeldingSubStageInfo[] = [];

  if (subType === 'flood') {
    // Flood doors: Tube Frame → Press → Full Weld (pipeline model)
    const tubeFrameDays = Math.ceil(qty / DOOR_THROUGHPUT.flood.tubeFramesPerDay);
    const pressDays = Math.ceil(qty / DOOR_THROUGHPUT.flood.pressPerDay);
    const fullWeldDays = Math.ceil(qty / DOOR_THROUGHPUT.flood.fullWeldPerDay);

    // Pipeline: Tube Frame and Press run in tandem, so the press starts after
    // the first frame is ready (0.5 day startup). The bottleneck is the press (4/day).
    // Full Weld is sequential after press completes.
    // Total = max(tubeFrame, press + 0.5 startup) + fullWeld
    const pipelineDays = Math.max(tubeFrameDays, pressDays + 0.5);
    const totalDays = pipelineDays + fullWeldDays;

    // For Gantt visualization, we show proportional segments
    stages.push(
      { stage: 'tubeFrame', durationDays: Math.ceil(pipelineDays * (tubeFrameDays / (tubeFrameDays + pressDays))), label: 'T', color: WELDING_SUBSTAGE_COLORS.tubeFrame },
      { stage: 'press', durationDays: Math.ceil(pipelineDays * (pressDays / (tubeFrameDays + pressDays))), label: 'P', color: WELDING_SUBSTAGE_COLORS.press },
      { stage: 'fullWeld', durationDays: fullWeldDays, label: 'W', color: WELDING_SUBSTAGE_COLORS.fullWeld },
    );

    // Ensure stages sum to totalDays (adjust press if rounding is off)
    const stageSum = stages.reduce((sum, s) => sum + s.durationDays, 0);
    const roundedTotal = Math.ceil(totalDays);
    if (stageSum !== roundedTotal) {
      stages[1].durationDays += roundedTotal - stageSum;
    }

    return { subType, stages, totalDays: roundedTotal };
  }

  // Standard doors (seamless or lock seam)
  if (subType === 'standard_lockseam') {
    // Lock seam: use overflow workers (2 workers, lower throughput)
    // These workers DON'T compete with the main 3-worker press pool
    const pressRate = pointsPerDoor <= DOOR_THROUGHPUT.press.pointThreshold
      ? DOOR_THROUGHPUT.lockSeamOverflow.lowPointRate
      : DOOR_THROUGHPUT.lockSeamOverflow.highPointRate;
    const pressDays = Math.ceil(qty / pressRate);

    stages.push({
      stage: 'press',
      durationDays: pressDays,
      label: 'P',
      color: WELDING_SUBSTAGE_COLORS.press,
    });
  } else {
    // Seamless / standard: use main 3-worker press pool
    const pressRate = pointsPerDoor <= DOOR_THROUGHPUT.press.pointThreshold
      ? DOOR_THROUGHPUT.press.lowPointRate
      : DOOR_THROUGHPUT.press.highPointRate;
    const pressDays = Math.ceil(qty / pressRate);

    stages.push({
      stage: 'press',
      durationDays: pressDays,
      label: 'P',
      color: WELDING_SUBSTAGE_COLORS.press,
    });
  }

  if (subType === 'standard_seamless') {
    // Seamless doors also go through the robot
    const robotDays = Math.ceil(qty / DOOR_THROUGHPUT.robot.doorsPerDay);
    stages.push({
      stage: 'robot',
      durationDays: robotDays,
      label: 'R',
      color: WELDING_SUBSTAGE_COLORS.robot,
    });
  }

  const totalDays = stages.reduce((sum, s) => sum + s.durationDays, 0);

  // Apply minimum 2-day rule for door leaf jobs
  if (totalDays < 2) {
    // Distribute the extra time to the press stage
    stages[0].durationDays += 2 - totalDays;
    return { subType, stages, totalDays: 2 };
  }

  return { subType, stages, totalDays };
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
  requiresPainting?: boolean,
  customerName?: string,
  batchSize?: number,
  quantity?: number
): number => {
  const config = DEPARTMENT_CONFIG[dept];
  if (!config || !points) return 0;

  // =========================================================================
  // DOOR WELDING SUB-PIPELINE — quantity-driven model for DOORS in Welding
  // =========================================================================
  if (dept === 'Welding' && productType === 'DOORS' && quantity && quantity > 0) {
    const pointsPerDoor = points / quantity;
    const subPipeline = calculateDoorWeldingSubStages(
      quantity, pointsPerDoor, description || '', jobName || ''
    );
    if (subPipeline) {
      // Sub-pipeline calculated the total days; round up to nearest half-day
      return Math.ceil(subPipeline.totalDays * 2) / 2;
    }
    // Falls through for NYCHA (subPipeline returns null) → use standard logic below
  }

  const pool = getPoolForJob(dept, productType);
  if (!pool) return 0;

  // =========================================================================
  // BATCH EFFICIENCY — reduce effective points when jobs are batched
  // =========================================================================
  let effectivePoints = points;
  if (batchSize && batchSize >= 2) {
    const discount = batchSize >= 3 ? BATCH_EFFICIENCY.threeOrMore : BATCH_EFFICIENCY.twoItems;
    effectivePoints = points * (1 - discount);
  }

  // Effective workers for this job
  const effectiveWorkers = Math.min(pool.maxPerProject, pool.count);

  // Daily output for this job
  let dailyOutput = effectiveWorkers * pool.outputPerDay;

  // =========================================================================
  // CUSTOMER MULTIPLIER — adjust output rate for specific customers
  // =========================================================================
  const custMultiplier = getCustomerMultiplier(customerName);
  if (custMultiplier && dept !== 'Engineering') {
    // outputMultiplier < 1 means workers produce less → job takes longer
    dailyOutput *= custMultiplier.outputMultiplier;
  }

  // Base duration (using effective points after batch discount)
  let rawDays = effectivePoints / dailyOutput;

  // Apply time multiplier (Assembly = 1.25x)
  if (config.timeMultiplier) {
    rawDays *= config.timeMultiplier;
  }

  // =========================================================================
  // CUSTOMER ENGINEERING CAP
  // =========================================================================
  if (custMultiplier && dept === 'Engineering') {
    rawDays = Math.min(rawDays, custMultiplier.engineeringMaxDays);
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
