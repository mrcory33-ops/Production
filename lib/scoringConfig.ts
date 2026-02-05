export interface ScoringFactor {
    maxPoints?: number;
    bonusPoints?: number;
    daysThreshold?: number;
    pointsPerDayLate?: number;
    pointsPerDayStalled?: number;
    pointsThreshold?: number;

    // Custom Factor Properties
    id?: string;
    label?: string;
    type?: 'bonus' | 'scaled';
    matchCondition?: string; // e.g. "VIP" in description
    enabled?: boolean;
}

export interface ScoringWeights {
    dueDateProximity: ScoringFactor;
    fastShip: ScoringFactor;
    slippageRisk: ScoringFactor;
    stallPenalty: ScoringFactor;
    bigRock: ScoringFactor;
    refJob: ScoringFactor;
    harmonicProduct: ScoringFactor;
    customFactors?: ScoringFactor[]; // New: array of user-defined factors
}

// Default Weights
const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    dueDateProximity: {
        maxPoints: 30,
        daysThreshold: 5,
        enabled: true,
        label: 'Due Date Proximity'
    },
    fastShip: {
        bonusPoints: 25,
        enabled: true,
        label: 'Fast Ship'
    },
    slippageRisk: {
        maxPoints: 20,
        pointsPerDayLate: 5,
        enabled: true,
        label: 'Slippage Risk'
    },
    stallPenalty: {
        maxPoints: 15,
        pointsPerDayStalled: 5,
        daysThreshold: 2,
        enabled: true,
        label: 'Stall Penalty'
    },
    bigRock: {
        bonusPoints: 10,
        pointsThreshold: 50,
        enabled: true,
        label: 'Big Rock'
    },
    refJob: {
        bonusPoints: 10,
        enabled: true,
        label: 'Ref Job'
    },
    harmonicProduct: {
        bonusPoints: 10,
        enabled: true,
        label: 'Harmonic Product'
    },
    customFactors: []
};

// Mutable State
let currentScoringWeights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };

export const getScoringWeights = (): ScoringWeights => {
    return currentScoringWeights;
};

export const updateScoringWeights = (newWeights: ScoringWeights) => {
    currentScoringWeights = newWeights;
};

// Backward compatibility proxy (read-only access)
export const SCORING_WEIGHTS = new Proxy(DEFAULT_SCORING_WEIGHTS, {
    get: (target, prop) => {
        return currentScoringWeights[prop as keyof ScoringWeights];
    }
});

export interface BigRockConfig {
    threshold: number; // Points >= 50
    maxConcurrent: Record<string, number>; // Max big jobs per department
    capacityRatio: number; // Max shared capacity when multiple big rocks overlap (0.7 = 70%)
}

export const BIG_ROCK_CONFIG: BigRockConfig = {
    threshold: 50,
    maxConcurrent: {
        Engineering: 3,
        Laser: 2,
        'Press Brake': 2,
        Welding: 3,
        Polishing: 3,
        Assembly: 3
    },
    capacityRatio: 0.7
};
