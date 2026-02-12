import { Job, Department, ProductType } from '@/types';
import { differenceInDays, differenceInCalendarDays, startOfDay } from 'date-fns';
import { getScoringWeights, SCORING_WEIGHTS } from './scoringConfig';
import { DEPT_ORDER } from './departmentConfig';

export interface UrgencyResult {
    score: number;
    factors: {
        dueDateProximity: number;
        fastShipBonus: number;
        slippageRisk: number;
        stallPenalty: number;
        bigRockWeight: number;
        refJobBonus: number;
        harmonicBonus: number;
        [key: string]: number; // Allow custom factors
    };
}

/**
 * Calculate the urgency score for a job based on multiple factors.
 * Higher score = Higher priority.
 */
export const calculateUrgencyScore = (job: Job): UrgencyResult => {
    // Get latest weights (mutable state)
    const weights = getScoringWeights();

    const factors: UrgencyResult['factors'] = {
        dueDateProximity: 0,
        fastShipBonus: 0,
        slippageRisk: 0,
        stallPenalty: 0,
        bigRockWeight: 0,
        refJobBonus: 0,
        harmonicBonus: 0,
        paintingBonus: 0,
        poReceivedBoost: 0
    };

    // 1. Due Date Proximity
    if (weights.dueDateProximity.enabled && job.dueDate) {
        const today = startOfDay(new Date());
        const dueDate = startOfDay(new Date(job.dueDate));
        const daysUntilDue = differenceInCalendarDays(dueDate, today);

        if (daysUntilDue <= (weights.dueDateProximity.daysThreshold || 5)) {
            factors.dueDateProximity = weights.dueDateProximity.maxPoints || 30;
        } else {
            const maxDays = 30;
            const proximityScore = Math.max(0, maxDays - daysUntilDue);
            factors.dueDateProximity = Math.min(weights.dueDateProximity.maxPoints || 30, proximityScore);
        }
    }

    // 2. Fast Ship Bonus
    if (weights.fastShip.enabled && job.fastShip === true) {
        factors.fastShipBonus = weights.fastShip.bonusPoints || 25;
    }

    // Optional cap: FastShip + Due Date Proximity combined
    const FASTSHIP_DUE_CAP = 40;
    if (factors.fastShipBonus > 0) {
        const combined = factors.fastShipBonus + factors.dueDateProximity;
        if (combined > FASTSHIP_DUE_CAP) {
            if (factors.fastShipBonus >= FASTSHIP_DUE_CAP) {
                factors.fastShipBonus = FASTSHIP_DUE_CAP;
                factors.dueDateProximity = 0;
            } else {
                factors.dueDateProximity = Math.max(0, FASTSHIP_DUE_CAP - factors.fastShipBonus);
            }
        }
    }

    // 3. Slippage Risk
    if (weights.slippageRisk.enabled && job.scheduledDepartmentByDate) {
        const todayKey = startOfDay(new Date()).toISOString().split('T')[0];
        const scheduledDept = job.scheduledDepartmentByDate[todayKey];

        if (scheduledDept && job.currentDepartment) {
            const currentIdx = DEPT_ORDER.indexOf(job.currentDepartment);
            const scheduledIdx = DEPT_ORDER.indexOf(scheduledDept);

            if (currentIdx < scheduledIdx) {
                const deptLag = scheduledIdx - currentIdx;
                factors.slippageRisk = Math.min(
                    weights.slippageRisk.maxPoints || 20,
                    deptLag * (weights.slippageRisk.pointsPerDayLate || 5) // Using per-dept lag as proxy
                );
            }
        }
    }

    // 4. Stall Penalty
    if (weights.stallPenalty.enabled && job.lastDepartmentChange) {
        const daysStuck = differenceInDays(new Date(), new Date(job.lastDepartmentChange));
        const threshold = weights.stallPenalty.daysThreshold || 2;

        if (daysStuck > threshold) {
            const overdueDays = daysStuck - threshold;
            factors.stallPenalty = Math.min(
                weights.stallPenalty.maxPoints || 15,
                overdueDays * (weights.stallPenalty.pointsPerDayStalled || 5)
            );
        }
    }

    // 5. Big Rock Weight
    if (weights.bigRock.enabled && (job.weldingPoints || 0) >= (weights.bigRock.pointsThreshold || 50)) {
        factors.bigRockWeight = weights.bigRock.bonusPoints || 10;
    }

    // 6. REF Job Bonus
    if (weights.refJob.enabled && job.description && job.description.toUpperCase().includes('REF')) {
        factors.refJobBonus = weights.refJob.bonusPoints || 10;
    }

    // 7. Harmonic Product Bonus
    if (weights.harmonicProduct.enabled && job.productType === 'HARMONIC') {
        factors.harmonicBonus = weights.harmonicProduct.bonusPoints || 10;
    }

    // 8. Painting Required Bonus
    if (weights.paintingRequired.enabled && job.requiresPainting === true) {
        factors.paintingBonus = weights.paintingRequired.bonusPoints || 15;
    }

    // 10. PO Received Boost — all special parts arrived, job should jump to top priority
    if (weights.poReceivedBoost.enabled && !job.openPOs && job.closedPOs) {
        factors.poReceivedBoost = weights.poReceivedBoost.bonusPoints || 35;
    }

    // 9. Custom Factors
    if (weights.customFactors) {
        weights.customFactors.forEach(factor => {
            if (!factor.enabled || !factor.id) return;

            let matches = false;
            // Check match condition (simple text include in description or notes for now)
            // Can extend to check specific fields if needed
            if (factor.matchCondition) {
                const term = factor.matchCondition.toUpperCase();
                const desc = (job.description || '').toUpperCase();
                const notes = (job.notes || '').toUpperCase();
                const name = (job.name || '').toUpperCase();

                if (desc.includes(term) || notes.includes(term) || name.includes(term)) {
                    matches = true;
                }
            }

            if (matches) {
                factors[factor.id] = factor.bonusPoints || 0;
            }
        });
    }

    const totalScore = Object.values(factors).reduce((sum, val) => sum + val, 0);

    return {
        score: totalScore,
        factors
    };
};
