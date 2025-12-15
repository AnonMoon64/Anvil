/**
 * Verification Sampling Attack Module
 * Models probabilistic verification and fraud exploitation
 */

import CONFIG from '../config.js';

/**
 * Verification parameters
 */
export const VERIFICATION_CONFIG = {
    // Probability that any given receipt is sampled for verification
    sampleProbability: 0.05,     // 5% of receipts verified

    // Probability of detecting fraud IF sampled
    detectionRateIfSampled: 0.95, // 95% detection rate on sample

    // Dispute window (epochs)
    disputeWindowEpochs: 7,

    // Penalties when caught
    penalties: {
        // Immediate reward forfeiture (multiplier of epoch reward)
        rewardForfeiture: 1.0,

        // Effectiveness reset (fraction of current effectiveness lost)
        effectivenessReset: 0.5,

        // Temporary ban duration (epochs)
        banDuration: 14,

        // Historical reward clawback (epochs worth of rewards)
        clawbackEpochs: 7,
    },
};

/**
 * Fraud types with different detection characteristics
 */
export const FRAUD_TYPES = {
    // Submitting work proofs without doing work
    fakeWorkProof: {
        name: 'Fake Work Proof',
        // Extra detection probability beyond random sampling
        detectionBonus: 0.1,
        // Reward multiplier if not caught
        rewardMultiplier: 1.0,
        // Cost savings (fraction of normal cost avoided)
        costSavings: 0.7,
        // Skill required (probability of valid-looking fraud)
        skillRate: 0.8,
    },

    // Responding to challenges with invalid/reconstructed data
    invalidDataResponse: {
        name: 'Invalid Data Response',
        detectionBonus: 0.05,
        rewardMultiplier: 1.0,
        costSavings: 0.3,
        skillRate: 0.9,
    },

    // Slight timing manipulation (claim success on near-misses)
    timingManipulation: {
        name: 'Timing Manipulation',
        detectionBonus: 0.02,
        rewardMultiplier: 1.0,
        costSavings: 0.1,
        skillRate: 0.95,
    },

    // Colluding with other nodes on challenge/response
    collusionChallenge: {
        name: 'Collusion',
        detectionBonus: 0.15,  // Easier to detect patterns
        rewardMultiplier: 1.2, // Can game the system more
        costSavings: 0.5,
        skillRate: 0.7,
    },
};

/**
 * Calculate probability of fraud detection over time
 * @param {number} fraudsPerEpoch - Number of fraudulent receipts per epoch
 * @param {number} epochs - Number of epochs
 * @returns {number} Probability of being caught at least once
 */
export function probabilityOfDetection(fraudsPerEpoch, epochs) {
    const config = VERIFICATION_CONFIG;

    // Probability of a single fraud being detected
    const pSingleDetection = config.sampleProbability * config.detectionRateIfSampled;

    // Probability of NOT being detected for one fraud
    const pNotDetected = 1 - pSingleDetection;

    // Total frauds
    const totalFrauds = fraudsPerEpoch * epochs;

    // Probability of never being detected
    const pNeverCaught = Math.pow(pNotDetected, totalFrauds);

    // Probability of being caught at least once
    return 1 - pNeverCaught;
}

/**
 * Calculate expected value of fraud strategy
 * @param {string} fraudType - Type of fraud
 * @param {number} normalRewardPerEpoch - Normal reward per epoch
 * @param {number} normalCostPerEpoch - Normal cost per epoch
 * @param {number} epochs - Time horizon
 * @returns {Object} Expected value analysis
 */
export function calculateFraudExpectedValue(fraudType, normalRewardPerEpoch, normalCostPerEpoch, epochs) {
    const fraud = FRAUD_TYPES[fraudType];
    const config = VERIFICATION_CONFIG;

    if (!fraud) {
        throw new Error(`Unknown fraud type: ${fraudType}`);
    }

    // Detection probability over time horizon
    const pDetection = config.sampleProbability * (config.detectionRateIfSampled + fraud.detectionBonus);
    const pDetectedEver = 1 - Math.pow(1 - pDetection, epochs);

    // Rewards if not caught
    const fraudRewardPerEpoch = normalRewardPerEpoch * fraud.rewardMultiplier;
    const totalRewardIfNotCaught = fraudRewardPerEpoch * epochs;

    // Costs (reduced due to fraud)
    const fraudCostPerEpoch = normalCostPerEpoch * (1 - fraud.costSavings);
    const totalCostIfNotCaught = fraudCostPerEpoch * epochs;

    // Penalty if caught (assume caught at midpoint on average)
    const avgEpochsBeforeCatch = epochs / 2;
    const rewardBeforeCatch = fraudRewardPerEpoch * avgEpochsBeforeCatch;
    const costBeforeCatch = fraudCostPerEpoch * avgEpochsBeforeCatch;

    const clawback = Math.min(
        config.penalties.clawbackEpochs * normalRewardPerEpoch,
        rewardBeforeCatch
    );

    const penaltyValue =
        clawback +
        normalRewardPerEpoch * config.penalties.banDuration * 0.5; // Opportunity cost

    // Expected values
    const evNotCaught = (totalRewardIfNotCaught - totalCostIfNotCaught) * (1 - pDetectedEver);
    const evCaught = (rewardBeforeCatch - costBeforeCatch - penaltyValue) * pDetectedEver;
    const evFraud = evNotCaught + evCaught;

    // Honest expected value for comparison
    const evHonest = (normalRewardPerEpoch - normalCostPerEpoch) * epochs;

    return {
        fraudType,
        epochs,
        probabilityOfDetection: pDetectedEver,
        evFraud,
        evHonest,
        evDifference: evFraud - evHonest,
        isProfitable: evFraud > evHonest,
        breakEvenDetectionRate: fraud.costSavings / (1 + config.penalties.clawbackEpochs),
    };
}

/**
 * Simulate fraud attempts over time
 * @param {number} fraudsPerEpoch - Frauds attempted per epoch
 * @param {number} epochs - Number of epochs
 * @param {string} fraudType - Type of fraud
 * @returns {Object} Simulation results
 */
export function simulateFraudOverTime(fraudsPerEpoch, epochs, fraudType = 'fakeWorkProof') {
    const fraud = FRAUD_TYPES[fraudType];
    const config = VERIFICATION_CONFIG;

    let caughtAtEpoch = null;
    let successfulFrauds = 0;
    let detectedFrauds = 0;

    const pDetection = config.sampleProbability * (config.detectionRateIfSampled + fraud.detectionBonus);

    for (let epoch = 0; epoch < epochs; epoch++) {
        if (caughtAtEpoch !== null) break;

        for (let f = 0; f < fraudsPerEpoch; f++) {
            // Does fraud succeed in appearing valid?
            if (Math.random() > fraud.skillRate) {
                // Bad fraud, automatically detected
                detectedFrauds++;
                caughtAtEpoch = epoch;
                break;
            }

            // Is this fraud sampled and detected?
            if (Math.random() < pDetection) {
                detectedFrauds++;
                caughtAtEpoch = epoch;
                break;
            }

            successfulFrauds++;
        }
    }

    return {
        fraudType,
        attemptedEpochs: epochs,
        fraudsPerEpoch,
        successfulFrauds,
        detectedFrauds,
        caughtAtEpoch,
        wasCaught: caughtAtEpoch !== null,
        survivalRate: caughtAtEpoch === null ? 1.0 : caughtAtEpoch / epochs,
    };
}

/**
 * Run Monte Carlo simulation of fraud outcomes
 * @param {number} trials - Number of simulation runs
 * @param {number} fraudsPerEpoch - Frauds per epoch
 * @param {number} epochs - Epochs per trial
 * @param {string} fraudType - Type of fraud
 */
export function monteCarloFraudAnalysis(trials, fraudsPerEpoch, epochs, fraudType = 'fakeWorkProof') {
    const results = {
        trials,
        caughtCount: 0,
        avgEpochsBeforeCaught: 0,
        avgSuccessfulFrauds: 0,
        survivalRate: 0,
        caughtDistribution: {},
    };

    let totalEpochsBeforeCaught = 0;
    let totalSuccessfulFrauds = 0;

    for (let t = 0; t < trials; t++) {
        const sim = simulateFraudOverTime(fraudsPerEpoch, epochs, fraudType);

        if (sim.wasCaught) {
            results.caughtCount++;
            totalEpochsBeforeCaught += sim.caughtAtEpoch;

            // Track distribution by epoch bucket
            const bucket = Math.floor(sim.caughtAtEpoch / 10) * 10;
            results.caughtDistribution[bucket] = (results.caughtDistribution[bucket] || 0) + 1;
        }

        totalSuccessfulFrauds += sim.successfulFrauds;
    }

    results.caughtRate = results.caughtCount / trials;
    results.survivalRate = 1 - results.caughtRate;
    results.avgEpochsBeforeCaught = results.caughtCount > 0
        ? totalEpochsBeforeCaught / results.caughtCount
        : epochs;
    results.avgSuccessfulFrauds = totalSuccessfulFrauds / trials;

    return results;
}

/**
 * Recommend verification parameters based on security target
 * @param {number} targetDetectionRate - Target detection rate (e.g., 0.95 for 95%)
 * @param {number} maxFraudsPerEpoch - Max frauds attacker might attempt
 * @param {number} epochs - Time horizon
 */
export function recommendVerificationParams(targetDetectionRate, maxFraudsPerEpoch, epochs) {
    // pDetected = 1 - (1 - pSample * pDetectIfSampled)^(frauds * epochs)
    // Solving for pSample assuming pDetectIfSampled = 0.95

    const pDetectIfSampled = 0.95;
    const totalFrauds = maxFraudsPerEpoch * epochs;

    // pNotDetected = (1 - pSample * 0.95)^totalFrauds = 1 - targetDetectionRate
    const pNotDetected = 1 - targetDetectionRate;
    const pNotSingleDetect = Math.pow(pNotDetected, 1 / totalFrauds);
    const requiredSampleRate = (1 - pNotSingleDetect) / pDetectIfSampled;

    return {
        targetDetectionRate,
        maxFraudsPerEpoch,
        epochs,
        recommendedSampleRate: Math.min(1, Math.max(0.01, requiredSampleRate)),
        verificationCostMultiplier: requiredSampleRate / 0.05, // Relative to 5% baseline
    };
}

export default {
    VERIFICATION_CONFIG,
    FRAUD_TYPES,
    probabilityOfDetection,
    calculateFraudExpectedValue,
    simulateFraudOverTime,
    monteCarloFraudAnalysis,
    recommendVerificationParams,
};
