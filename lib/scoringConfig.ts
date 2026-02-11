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
    paintingRequired: ScoringFactor;
    poReceivedBoost: ScoringFactor;
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
        pointsThreshold: 60,
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
    paintingRequired: {
        bonusPoints: 15,
        enabled: true,
        label: 'Painting Required'
    },
    poReceivedBoost: {
        bonusPoints: 35,
        enabled: true,
        label: 'PO Received Boost'
    },
    customFactors: []
};

// Mutable State
let currentScoringWeights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };

export const getScoringWeights = (): ScoringWeights => {
    return currentScoringWeights;
};

/**
 * Load scoring weights from localStorage and Firebase
 * Priority: localStorage > Firebase > Defaults
 */
export const loadScoringWeights = async (): Promise<ScoringWeights> => {
    // Try localStorage first (fastest)
    try {
        const localData = localStorage.getItem('emjac_scoringWeights');
        if (localData) {
            const parsed = JSON.parse(localData);
            currentScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...parsed };
            return currentScoringWeights;
        }
    } catch (error) {
        console.warn('Failed to load from localStorage:', error);
    }

    // Try Firebase
    try {
        const { db } = await import('./firebase');
        const { doc, getDoc } = await import('firebase/firestore');

        const docRef = doc(db, 'settings', 'scoringWeights');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const firebaseData = docSnap.data() as ScoringWeights;
            currentScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...firebaseData };

            // Sync to localStorage
            localStorage.setItem('emjac_scoringWeights', JSON.stringify(currentScoringWeights));
            return currentScoringWeights;
        }
    } catch (error) {
        console.warn('Failed to load from Firebase:', error);
    }

    // Fall back to defaults
    currentScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };
    return currentScoringWeights;
};

/**
 * Update scoring weights and persist to localStorage + Firebase
 */
export const updateScoringWeights = async (newWeights: ScoringWeights): Promise<void> => {
    currentScoringWeights = newWeights;

    // Save to localStorage (synchronous, fast)
    try {
        localStorage.setItem('emjac_scoringWeights', JSON.stringify(newWeights));
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
    }

    // Save to Firebase (async, backup)
    try {
        const { db } = await import('./firebase');
        const { doc, setDoc } = await import('firebase/firestore');

        const docRef = doc(db, 'settings', 'scoringWeights');
        await setDoc(docRef, {
            ...newWeights,
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('Failed to save to Firebase:', error);
        // Don't throw - localStorage save succeeded
    }
};

/**
 * Reset scoring weights to defaults
 */
export const resetScoringWeights = async (): Promise<void> => {
    await updateScoringWeights({ ...DEFAULT_SCORING_WEIGHTS });
};

// Backward compatibility proxy (read-only access)
export const SCORING_WEIGHTS = new Proxy(DEFAULT_SCORING_WEIGHTS, {
    get: (target, prop) => {
        return currentScoringWeights[prop as keyof ScoringWeights];
    }
});

export interface BigRockConfig {
    threshold: number; // Points >= 60
    maxConcurrent: Record<string, number>; // Max big jobs per department
    capacityRatio: number; // Max shared capacity when multiple big rocks overlap (0.7 = 70%)
}

export const BIG_ROCK_CONFIG: BigRockConfig = {
    threshold: 60,
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
