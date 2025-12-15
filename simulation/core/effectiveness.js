/**
 * Effectiveness Calculation Module
 * Handles ramp-up and decay functions for node effectiveness
 */

import CONFIG from '../config.js';

/**
 * Calculate effectiveness ramp-up
 * Eff(t) = 1 - exp(-t / R)
 * 
 * @param {number} participationDays - Cumulative successful participation time in days
 * @returns {number} Effectiveness value between 0 and 1
 */
export function calculateRamp(participationDays) {
    const R = CONFIG.effectiveness.rampTimeConstant;
    return 1 - Math.exp(-participationDays / R);
}

/**
 * Calculate effectiveness decay during offline period
 * Decay is asymmetric and punitive (faster than ramp)
 * 
 * @param {number} startingEffectiveness - Effectiveness when node went offline
 * @param {number} offlineDays - Days since going offline
 * @returns {number} Current effectiveness value
 */
export function calculateDecay(startingEffectiveness, offlineDays) {
    const { decayGracePeriodDays, decayStepPenalty, decayHalfLifeDays, decayResetThreshold } =
        CONFIG.effectiveness;

    // Within grace period - no decay
    if (offlineDays <= decayGracePeriodDays) {
        return startingEffectiveness;
    }

    // Apply step penalty after grace period
    const afterStepPenalty = startingEffectiveness * (1 - decayStepPenalty);

    // Calculate exponential decay after step penalty
    const decayDays = offlineDays - decayGracePeriodDays;
    const decayRate = Math.log(2) / decayHalfLifeDays;
    const decayedEffectiveness = afterStepPenalty * Math.exp(-decayRate * decayDays);

    // Return 0 if below reset threshold
    return decayedEffectiveness < decayResetThreshold ? 0 : decayedEffectiveness;
}

/**
 * Get effectiveness trajectory for visualization
 * 
 * @param {number} maxDays - Maximum days to calculate
 * @param {string} mode - 'ramp' or 'decay'
 * @param {number} startingEffectiveness - Starting effectiveness for decay mode
 * @returns {Array<{day: number, effectiveness: number}>}
 */
export function getEffectivenessTrajectory(maxDays, mode = 'ramp', startingEffectiveness = 1.0) {
    const trajectory = [];

    for (let day = 0; day <= maxDays; day++) {
        const effectiveness = mode === 'ramp'
            ? calculateRamp(day)
            : calculateDecay(startingEffectiveness, day);

        trajectory.push({ day, effectiveness });
    }

    return trajectory;
}

/**
 * Calculate days to reach target effectiveness during ramp-up
 * 
 * @param {number} targetEffectiveness - Target effectiveness (0-1)
 * @returns {number} Days to reach target
 */
export function daysToReachEffectiveness(targetEffectiveness) {
    const R = CONFIG.effectiveness.rampTimeConstant;
    // Eff(t) = 1 - exp(-t/R)
    // targetEff = 1 - exp(-t/R)
    // exp(-t/R) = 1 - targetEff
    // -t/R = ln(1 - targetEff)
    // t = -R * ln(1 - targetEff)
    return -R * Math.log(1 - targetEffectiveness);
}

/**
 * Calculate days until effectiveness drops below threshold during decay
 * 
 * @param {number} startingEffectiveness - Starting effectiveness
 * @param {number} threshold - Target threshold
 * @returns {number} Days until below threshold
 */
export function daysUntilDecayThreshold(startingEffectiveness, threshold) {
    const { decayGracePeriodDays, decayStepPenalty, decayHalfLifeDays } =
        CONFIG.effectiveness;

    const afterStepPenalty = startingEffectiveness * (1 - decayStepPenalty);

    if (afterStepPenalty <= threshold) {
        return decayGracePeriodDays;
    }

    const decayRate = Math.log(2) / decayHalfLifeDays;
    // afterStepPenalty * exp(-decayRate * t) = threshold
    // t = -ln(threshold / afterStepPenalty) / decayRate
    const decayDays = -Math.log(threshold / afterStepPenalty) / decayRate;

    return decayGracePeriodDays + decayDays;
}

export default {
    calculateRamp,
    calculateDecay,
    getEffectivenessTrajectory,
    daysToReachEffectiveness,
    daysUntilDecayThreshold,
};
