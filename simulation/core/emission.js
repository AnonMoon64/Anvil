/**
 * Emission Schedule Module
 * Handles token emission calculations with smooth decay
 */

import CONFIG from '../config.js';

/**
 * Calculate emission rate at a given time
 * Em(t) = Em0 * exp(-t / τ)
 * 
 * @param {number} daysSinceGenesis - Days since network genesis
 * @returns {number} Tokens emitted per epoch
 */
export function calculateEmission(daysSinceGenesis) {
    const { initialRate, decayTimeConstant } = CONFIG.emission;
    return initialRate * Math.exp(-daysSinceGenesis / decayTimeConstant);
}

/**
 * Calculate total tokens emitted from genesis to a given day
 * Integral of Em(t) from 0 to t
 * = Em0 * τ * (1 - exp(-t / τ))
 * 
 * @param {number} daysSinceGenesis - Days since network genesis
 * @returns {number} Total tokens emitted
 */
export function calculateTotalEmitted(daysSinceGenesis) {
    const { initialRate, decayTimeConstant } = CONFIG.emission;
    return initialRate * decayTimeConstant * (1 - Math.exp(-daysSinceGenesis / decayTimeConstant));
}

/**
 * Calculate remaining tokens to ever be emitted
 * Total supply = Em0 * τ
 * Remaining = Total - Emitted
 * 
 * @param {number} daysSinceGenesis - Days since network genesis
 * @returns {number} Remaining tokens to be emitted
 */
export function calculateRemainingSupply(daysSinceGenesis) {
    const { initialRate, decayTimeConstant } = CONFIG.emission;
    const totalSupply = initialRate * decayTimeConstant;
    return totalSupply - calculateTotalEmitted(daysSinceGenesis);
}

/**
 * Calculate the asymptotic total supply
 * As t → ∞, total emitted → Em0 * τ
 * 
 * @returns {number} Maximum total supply
 */
export function calculateMaxSupply() {
    const { initialRate, decayTimeConstant } = CONFIG.emission;
    return initialRate * decayTimeConstant;
}

/**
 * Get emission trajectory for visualization
 * 
 * @param {number} maxDays - Maximum days to calculate
 * @returns {Array<{day: number, emission: number, totalEmitted: number, percentEmitted: number}>}
 */
export function getEmissionTrajectory(maxDays) {
    const trajectory = [];
    const maxSupply = calculateMaxSupply();

    for (let day = 0; day <= maxDays; day++) {
        const emission = calculateEmission(day);
        const totalEmitted = calculateTotalEmitted(day);
        const percentEmitted = (totalEmitted / maxSupply) * 100;

        trajectory.push({ day, emission, totalEmitted, percentEmitted });
    }

    return trajectory;
}

/**
 * Calculate days until a certain percentage of supply is emitted
 * 
 * @param {number} targetPercent - Target percentage (0-100)
 * @returns {number} Days to reach target
 */
export function daysToEmitPercent(targetPercent) {
    const { decayTimeConstant } = CONFIG.emission;
    // percentEmitted = 100 * (1 - exp(-t / τ))
    // targetPercent/100 = 1 - exp(-t / τ)
    // exp(-t / τ) = 1 - targetPercent/100
    // t = -τ * ln(1 - targetPercent/100)
    return -decayTimeConstant * Math.log(1 - targetPercent / 100);
}

/**
 * Compare with Bitcoin-style halving for reference
 * 
 * @param {number} maxDays - Days to compare
 * @returns {Object} Comparison data
 */
export function compareWithHalving(maxDays) {
    const halvingInterval = 365 * 4; // ~4 years like Bitcoin
    const initialBlockReward = CONFIG.emission.initialRate;

    const smooth = [];
    const halving = [];

    for (let day = 0; day <= maxDays; day++) {
        const halvingCount = Math.floor(day / halvingInterval);
        const halvingEmission = initialBlockReward / Math.pow(2, halvingCount);

        smooth.push({ day, emission: calculateEmission(day) });
        halving.push({ day, emission: halvingEmission });
    }

    return { smooth, halving };
}

export default {
    calculateEmission,
    calculateTotalEmitted,
    calculateRemainingSupply,
    calculateMaxSupply,
    getEmissionTrajectory,
    daysToEmitPercent,
    compareWithHalving,
};
