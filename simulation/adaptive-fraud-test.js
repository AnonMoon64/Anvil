/**
 * Adaptive Fraud Strategies Module
 * Tests adversaries who adapt to detection mechanisms
 */

import { VERIFICATION_CONFIG, FRAUD_TYPES } from './core/verification.js';
import { calculateEmission } from './core/emission.js';

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
};

/**
 * Adaptive fraud strategies that real attackers would use
 */
const ADAPTIVE_STRATEGIES = {
    // Low-rate: Only cheat occasionally to stay under radar
    lowRate: {
        name: 'Low-Rate Fraud',
        description: 'Cheat only 1 epoch per week to minimize detection',
        fraudsPerEpoch: 1 / 7,  // ~1 per week
        detectionMultiplier: 1.0,
    },

    // Stochastic: Random cheating with tuned probability
    stochastic: {
        name: 'Stochastic Fraud',
        description: 'Cheat with 10% probability per opportunity',
        fraudProbability: 0.10,
        detectionMultiplier: 1.0,
    },

    // Gray fraud: Barely invalid, harder to detect
    grayFraud: {
        name: 'Gray Fraud',
        description: 'Submit barely-invalid proofs that pass casual inspection',
        fraudsPerEpoch: 5,
        detectionMultiplier: 0.6,  // Only 60% detection rate if sampled
    },

    // Burst fraud: Cheat heavily then stop
    burstFraud: {
        name: 'Burst Fraud',
        description: 'Heavy fraud for 14 days, then honest for 60 days',
        burstDays: 14,
        cooldownDays: 60,
        fraudsPerEpochDuringBurst: 20,
        detectionMultiplier: 1.0,
    },

    // Sampling-aware: Only cheat when sampling is unlikely
    samplingAware: {
        name: 'Sampling-Aware Fraud',
        description: 'Track sampling patterns and cheat in gaps',
        fraudsPerEpoch: 5,
        samplingAvoidance: 0.3,  // 30% chance to avoid any given sample
        detectionMultiplier: 1.0,
    },

    // Identity rotation: Spread fraud across many identities
    rotatingIdentity: {
        name: 'Rotating Identity Fraud',
        description: 'Use 10 identities, only 1 cheats per epoch',
        identities: 10,
        fraudsPerIdentityPerEpoch: 5,
        detectionMultiplier: 1.0,
    },
};

/**
 * Penalty configuration with forgiveness
 */
const PENALTY_CONFIG = {
    // Confidence levels for penalties
    singleDetection: {
        effectivenessLoss: 0.10,   // 10% loss on first catch
        clawbackEpochs: 1,
        banDays: 0,                // Warning, no ban
    },
    repeatedDetection: {
        threshold: 3,              // 3 detections = pattern
        effectivenessLoss: 0.50,
        clawbackEpochs: 7,
        banDays: 14,
    },
    confirmedFraud: {
        threshold: 5,              // 5+ = confirmed bad actor
        effectivenessLoss: 1.0,    // Full reset
        clawbackEpochs: 14,
        banDays: 30,
    },
};

/**
 * Simulate adaptive fraud strategy
 */
function simulateAdaptiveFraud(strategy, params) {
    const {
        epochs = 365,
        sampleRate = 0.10,
        rewardPerEpoch = 10,
        costPerEpoch = 0.1,
        numTrials = 100,
    } = params;

    const strat = ADAPTIVE_STRATEGIES[strategy];
    const baseDetection = VERIFICATION_CONFIG.detectionRateIfSampled * strat.detectionMultiplier;

    const results = {
        strategy: strat.name,
        trials: numTrials,
        caught: 0,
        avgEpochsCaught: 0,
        avgProfit: 0,
        avgHonestProfit: 0,
        profitableTrials: 0,
    };

    for (let trial = 0; trial < numTrials; trial++) {
        let detections = 0;
        let totalReward = 0;
        let totalCost = 0;
        let banned = false;
        let banUntil = 0;
        let caughtEpoch = null;

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Check if banned
            if (banned && epoch < banUntil) {
                continue;
            }
            banned = false;

            // Determine fraud this epoch based on strategy
            let fraudsThisEpoch = 0;
            let costSavings = 0.7; // Default fraud saves 70% of work cost

            switch (strategy) {
                case 'lowRate':
                    fraudsThisEpoch = Math.random() < strat.fraudsPerEpoch ? 1 : 0;
                    break;

                case 'stochastic':
                    // Each potential fraud has 10% chance
                    for (let i = 0; i < 5; i++) {
                        if (Math.random() < strat.fraudProbability) fraudsThisEpoch++;
                    }
                    break;

                case 'grayFraud':
                    fraudsThisEpoch = strat.fraudsPerEpoch;
                    costSavings = 0.3; // Gray fraud saves less (still doing most work)
                    break;

                case 'burstFraud':
                    const cycleLength = strat.burstDays + strat.cooldownDays;
                    const dayInCycle = epoch % cycleLength;
                    fraudsThisEpoch = dayInCycle < strat.burstDays ? strat.fraudsPerEpochDuringBurst : 0;
                    break;

                case 'samplingAware':
                    fraudsThisEpoch = strat.fraudsPerEpoch;
                    break;

                case 'rotatingIdentity':
                    // Only this identity's turn 10% of the time
                    fraudsThisEpoch = Math.random() < (1 / strat.identities) ? strat.fraudsPerIdentityPerEpoch : 0;
                    break;
            }

            // Calculate detection
            const effectiveSampleRate = strategy === 'samplingAware'
                ? sampleRate * (1 - strat.samplingAvoidance)
                : sampleRate;

            for (let f = 0; f < fraudsThisEpoch; f++) {
                if (Math.random() < effectiveSampleRate * baseDetection) {
                    detections++;
                    if (caughtEpoch === null) caughtEpoch = epoch;

                    // Apply graduated penalties
                    if (detections >= PENALTY_CONFIG.confirmedFraud.threshold) {
                        banned = true;
                        banUntil = epoch + PENALTY_CONFIG.confirmedFraud.banDays;
                        totalReward -= PENALTY_CONFIG.confirmedFraud.clawbackEpochs * rewardPerEpoch;
                    } else if (detections >= PENALTY_CONFIG.repeatedDetection.threshold) {
                        totalReward -= PENALTY_CONFIG.repeatedDetection.clawbackEpochs * rewardPerEpoch;
                    } else {
                        totalReward -= PENALTY_CONFIG.singleDetection.clawbackEpochs * rewardPerEpoch;
                    }
                }
            }

            // Rewards and costs
            if (!banned) {
                totalReward += rewardPerEpoch;
                totalCost += costPerEpoch * (1 - costSavings * (fraudsThisEpoch > 0 ? 1 : 0));
            }
        }

        const profit = totalReward - totalCost;
        const honestProfit = (rewardPerEpoch - costPerEpoch) * epochs;

        results.avgProfit += profit;
        results.avgHonestProfit += honestProfit;
        if (detections > 0) {
            results.caught++;
            results.avgEpochsCaught += caughtEpoch;
        }
        if (profit > honestProfit) {
            results.profitableTrials++;
        }
    }

    // Compute averages
    results.avgProfit /= numTrials;
    results.avgHonestProfit /= numTrials;
    results.caughtRate = results.caught / numTrials;
    results.avgEpochsCaught = results.caught > 0 ? results.avgEpochsCaught / results.caught : epochs;
    results.profitableRate = results.profitableTrials / numTrials;
    results.evDifference = results.avgProfit - results.avgHonestProfit;
    results.isProfitable = results.avgProfit > results.avgHonestProfit;

    return results;
}

/**
 * Main analysis
 */
function runAdaptiveFraudAnalysis() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  ADAPTIVE FRAUD STRATEGY ANALYSIS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    console.log('  Testing adversaries who adapt to detection mechanisms...\n');

    const params = {
        epochs: 365,
        sampleRate: 0.10,
        rewardPerEpoch: 10,
        costPerEpoch: 0.1,
        numTrials: 500,
    };

    console.log(`  Parameters: ${params.epochs} days, ${params.sampleRate * 100}% sampling, ${params.numTrials} trials\n`);

    console.log(`  ${'Strategy'.padEnd(25)} | ${'Caught'.padStart(8)} | ${'Avg Catch'.padStart(10)} | ${'EV Diff'.padStart(12)} | Profitable?`);
    console.log(`  ${'─'.repeat(75)}`);

    const allResults = [];

    for (const strategy of Object.keys(ADAPTIVE_STRATEGIES)) {
        const result = simulateAdaptiveFraud(strategy, params);
        allResults.push(result);

        const color = result.isProfitable ? c.red : c.green;
        console.log(
            `  ${result.strategy.padEnd(25)} | ` +
            `${(result.caughtRate * 100).toFixed(0).padStart(6)}% | ` +
            `${result.avgEpochsCaught.toFixed(0).padStart(8)}d | ` +
            `$${result.evDifference.toFixed(2).padStart(10)} | ` +
            `${color}${result.isProfitable ? 'YES ⚠' : 'No ✓'}${c.reset}`
        );
    }

    // Summary
    const profitable = allResults.filter(r => r.isProfitable);
    console.log(`\n  ${c.bold}Summary:${c.reset}`);
    if (profitable.length === 0) {
        console.log(`  ${c.green}✓ All adaptive strategies are negative EV!${c.reset}`);
    } else {
        console.log(`  ${c.red}⚠ ${profitable.length} strategies are profitable:${c.reset}`);
        for (const p of profitable) {
            console.log(`    - ${p.strategy}: +$${p.evDifference.toFixed(2)}/year`);
        }
    }

    // Test with different sampling rates
    console.log(`\n${c.yellow}▶ Gray Fraud Sensitivity to Sampling Rate${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    const sampleRates = [0.05, 0.10, 0.15, 0.20, 0.30];

    for (const rate of sampleRates) {
        const result = simulateAdaptiveFraud('grayFraud', { ...params, sampleRate: rate });
        const color = result.isProfitable ? c.red : c.green;
        console.log(
            `  ${(rate * 100).toFixed(0).padStart(3)}% sampling: ` +
            `${color}EV diff: $${result.evDifference.toFixed(2)}${c.reset} ` +
            `(caught ${(result.caughtRate * 100).toFixed(0)}%)`
        );
    }

    return allResults;
}

// Run if executed directly
runAdaptiveFraudAnalysis();

export { ADAPTIVE_STRATEGIES, PENALTY_CONFIG, simulateAdaptiveFraud, runAdaptiveFraudAnalysis };
