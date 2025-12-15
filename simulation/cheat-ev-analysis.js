/**
 * Cheat Expected Value Analysis
 * Computes whether cheating is negative EV under various penalty regimes
 */

import { VERIFICATION_CONFIG, FRAUD_TYPES, monteCarloFraudAnalysis } from './core/verification.js';
import { RELIABILITY_CLASSES } from './core/reliability.js';
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
 * Penalty regime configurations
 */
const PENALTY_REGIMES = {
    mild: {
        name: 'Mild (Current)',
        rewardForfeiture: 1.0,      // Lose 1 epoch of rewards
        effectivenessReset: 0.3,    // Lose 30% effectiveness
        banDays: 7,                 // 7 day ban
        clawbackEpochs: 3,          // Clawback 3 epochs
    },
    moderate: {
        name: 'Moderate',
        rewardForfeiture: 1.0,
        effectivenessReset: 0.5,    // Lose 50% effectiveness
        banDays: 14,
        clawbackEpochs: 7,
    },
    harsh: {
        name: 'Harsh',
        rewardForfeiture: 1.0,
        effectivenessReset: 0.8,    // Lose 80% effectiveness 
        banDays: 30,
        clawbackEpochs: 14,
    },
    brutal: {
        name: 'Brutal (Recommended)',
        rewardForfeiture: 1.0,
        effectivenessReset: 1.0,    // Full reset
        banDays: 60,
        clawbackEpochs: 30,
    },
};

/**
 * Calculate expected value of cheating vs honest participation
 */
function calculateCheatEV(params) {
    const {
        fraudType,
        fraudsPerEpoch,
        epochs,
        sampleRate,
        penaltyRegime,
        rewardPerEpoch,
        costPerEpoch,
    } = params;

    const fraud = FRAUD_TYPES[fraudType];
    const penalty = PENALTY_REGIMES[penaltyRegime];

    // Detection probability per fraud
    const pDetectPerFraud = sampleRate * (0.95 + fraud.detectionBonus);

    // Probability of EVER being caught over time horizon
    const totalFrauds = fraudsPerEpoch * epochs;
    const pNeverCaught = Math.pow(1 - pDetectPerFraud, totalFrauds);
    const pCaught = 1 - pNeverCaught;

    // Expected epoch when caught (if caught) - geometric distribution mean
    const expectedCatchEpoch = pCaught > 0
        ? Math.min(epochs, 1 / (pDetectPerFraud * fraudsPerEpoch))
        : epochs;

    // Revenue if never caught
    const fraudReward = rewardPerEpoch * fraud.rewardMultiplier;
    const fraudCost = costPerEpoch * (1 - fraud.costSavings);
    const profitIfNotCaught = (fraudReward - fraudCost) * epochs;

    // Cost if caught
    const epochsBeforeCatch = expectedCatchEpoch;
    const profitBeforeCatch = (fraudReward - fraudCost) * epochsBeforeCatch;

    // Penalties
    const clawback = penalty.clawbackEpochs * rewardPerEpoch;
    const banOpportunityCost = penalty.banDays * rewardPerEpoch / 30; // Missed rewards
    const effectivenessRecoveryCost = penalty.effectivenessReset * rewardPerEpoch * 60; // ~60 days to recover

    const totalPenalty = clawback + banOpportunityCost + effectivenessRecoveryCost;
    const profitIfCaught = profitBeforeCatch - totalPenalty;

    // Expected value
    const evFraud = (pNeverCaught * profitIfNotCaught) + (pCaught * profitIfCaught);

    // Honest expected value
    const evHonest = (rewardPerEpoch - costPerEpoch) * epochs;

    return {
        fraudType,
        penaltyRegime: penalty.name,
        epochs,
        sampleRate,
        pCaught,
        expectedCatchEpoch: expectedCatchEpoch.toFixed(1),
        profitIfNotCaught: profitIfNotCaught.toFixed(2),
        profitIfCaught: profitIfCaught.toFixed(2),
        totalPenalty: totalPenalty.toFixed(2),
        evFraud: evFraud.toFixed(2),
        evHonest: evHonest.toFixed(2),
        evDifference: (evFraud - evHonest).toFixed(2),
        isProfitable: evFraud > evHonest,
        cheatAdvantage: ((evFraud - evHonest) / evHonest * 100).toFixed(1),
    };
}

/**
 * Find minimum penalty to make cheating negative EV
 */
function findMinimumPenalty(params) {
    const { fraudType, fraudsPerEpoch, epochs, sampleRate, rewardPerEpoch, costPerEpoch } = params;

    // Binary search for minimum effectiveness reset that makes cheating -EV
    let lo = 0, hi = 1;

    while (hi - lo > 0.01) {
        const mid = (lo + hi) / 2;

        // Create custom penalty regime
        const testPenalty = {
            rewardForfeiture: 1.0,
            effectivenessReset: mid,
            banDays: 14,
            clawbackEpochs: 7,
        };

        // Calculate EV with this penalty
        const fraud = FRAUD_TYPES[fraudType];
        const pDetectPerFraud = sampleRate * (0.95 + fraud.detectionBonus);
        const totalFrauds = fraudsPerEpoch * epochs;
        const pCaught = 1 - Math.pow(1 - pDetectPerFraud, totalFrauds);

        const fraudReward = rewardPerEpoch * fraud.rewardMultiplier;
        const fraudCost = costPerEpoch * (1 - fraud.costSavings);

        const profitIfNotCaught = (fraudReward - fraudCost) * epochs;
        const expectedCatchEpoch = Math.min(epochs, 1 / (pDetectPerFraud * fraudsPerEpoch));
        const profitBeforeCatch = (fraudReward - fraudCost) * expectedCatchEpoch;

        const clawback = testPenalty.clawbackEpochs * rewardPerEpoch;
        const banCost = testPenalty.banDays * rewardPerEpoch / 30;
        const recoveryCost = testPenalty.effectivenessReset * rewardPerEpoch * 60;
        const totalPenalty = clawback + banCost + recoveryCost;

        const profitIfCaught = profitBeforeCatch - totalPenalty;
        const evFraud = (1 - pCaught) * profitIfNotCaught + pCaught * profitIfCaught;
        const evHonest = (rewardPerEpoch - costPerEpoch) * epochs;

        if (evFraud > evHonest) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    return hi;
}

/**
 * Main analysis
 */
function runCheatEVAnalysis() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  CHEAT EXPECTED VALUE ANALYSIS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    const baseParams = {
        fraudsPerEpoch: 5,
        epochs: 365,
        rewardPerEpoch: 10,   // tokens
        costPerEpoch: 0.1,    // USD (hobbyist)
    };

    // Test 1: Fraud EV across penalty regimes
    console.log(`${c.yellow}▶ Fraud EV by Penalty Regime${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(60)}${c.reset}\n`);

    console.log(`  Sample Rate: 5% | Frauds/Epoch: ${baseParams.fraudsPerEpoch} | Horizon: ${baseParams.epochs} days\n`);

    console.log(`  ${'Penalty Regime'.padEnd(25)} | ${'P(Caught)'.padStart(10)} | ${'EV Cheat'.padStart(12)} | ${'EV Honest'.padStart(12)} | Cheat +EV?`);
    console.log(`  ${'─'.repeat(80)}`);

    for (const regime of Object.keys(PENALTY_REGIMES)) {
        const result = calculateCheatEV({
            ...baseParams,
            fraudType: 'fakeWorkProof',
            sampleRate: 0.05,
            penaltyRegime: regime,
        });

        const color = result.isProfitable ? c.red : c.green;
        console.log(
            `  ${result.penaltyRegime.padEnd(25)} | ` +
            `${(result.pCaught * 100).toFixed(0).padStart(8)}% | ` +
            `$${result.evFraud.padStart(10)} | ` +
            `$${result.evHonest.padStart(10)} | ` +
            `${color}${result.isProfitable ? 'YES ⚠' : 'No ✓'}${c.reset}`
        );
    }

    // Test 2: Sample rate impact
    console.log(`\n${c.yellow}▶ Sample Rate Impact (Harsh Penalties)${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(60)}${c.reset}\n`);

    const sampleRates = [0.01, 0.05, 0.10, 0.15, 0.20, 0.30];

    console.log(`  ${'Sample Rate'.padEnd(15)} | ${'P(Caught)'.padStart(10)} | ${'EV Diff'.padStart(12)} | Status`);
    console.log(`  ${'─'.repeat(55)}`);

    for (const rate of sampleRates) {
        const result = calculateCheatEV({
            ...baseParams,
            fraudType: 'fakeWorkProof',
            sampleRate: rate,
            penaltyRegime: 'harsh',
        });

        const color = result.isProfitable ? c.red : c.green;
        console.log(
            `  ${(rate * 100).toFixed(0).padStart(3)}%`.padEnd(15) + ` | ` +
            `${(result.pCaught * 100).toFixed(0).padStart(8)}% | ` +
            `$${result.evDifference.padStart(10)} | ` +
            `${color}${result.isProfitable ? 'Cheat wins' : 'Honest wins'}${c.reset}`
        );
    }

    // Test 3: Per fraud type analysis
    console.log(`\n${c.yellow}▶ EV by Fraud Type (10% Sample, Brutal Penalties)${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(60)}${c.reset}\n`);

    for (const fraudType of Object.keys(FRAUD_TYPES)) {
        const result = calculateCheatEV({
            ...baseParams,
            fraudType,
            sampleRate: 0.10,
            penaltyRegime: 'brutal',
        });

        const color = result.isProfitable ? c.red : c.green;
        console.log(
            `  ${FRAUD_TYPES[fraudType].name.padEnd(25)}: ` +
            `${color}${result.isProfitable ? 'STILL PROFITABLE ⚠' : 'Negative EV ✓'}${c.reset} ` +
            `(${result.cheatAdvantage}%)`
        );
    }

    // Test 4: Find minimum penalties
    console.log(`\n${c.yellow}▶ Minimum Effectiveness Reset for Negative Cheat EV${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(60)}${c.reset}\n`);

    for (const fraudType of Object.keys(FRAUD_TYPES)) {
        const minReset = findMinimumPenalty({
            ...baseParams,
            fraudType,
            sampleRate: 0.10,
        });

        const color = minReset >= 1.0 ? c.red : c.green;
        console.log(
            `  ${FRAUD_TYPES[fraudType].name.padEnd(25)}: ` +
            `${color}${(minReset * 100).toFixed(0)}%${c.reset} effectiveness reset required`
        );
    }

    // Recommendations
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  RECOMMENDATIONS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    console.log(`  To ensure all fraud types are negative EV:\n`);
    console.log(`  1. ${c.bold}Sample Rate:${c.reset} Minimum 10%, recommend 15%`);
    console.log(`  2. ${c.bold}Effectiveness Reset:${c.reset} 80-100% on detection`);
    console.log(`  3. ${c.bold}Ban Duration:${c.reset} 30-60 days minimum`);
    console.log(`  4. ${c.bold}Clawback:${c.reset} 14+ epochs of rewards\n`);

    console.log(`  ${c.yellow}Key insight: Without brutal penalties, even 30% sample rate`);
    console.log(`  may not deter all fraud types due to cost savings.${c.reset}\n`);
}

/**
 * Generate text-based heatmap of attack ROI
 */
function generateROIHeatmap() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  ATTACK ROI HEATMAP${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    const tokenPrices = [0.01, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.50, 0.75, 1.00];
    const nodeCounts = [5, 10, 25, 50, 100, 250];
    const networkSize = 1000;

    // Use recalibrated costs
    const costPerNode = RELIABILITY_CLASSES.hobbyist.monthlyTotalUSD;

    console.log(`  Network: ${networkSize} honest nodes | Attacker cost: $${costPerNode}/node/month\n`);

    // Header
    const header = '  Price   │' + nodeCounts.map(n => ` ${n}`.padStart(8)).join(' │');
    console.log(header);
    console.log('  ' + '─'.repeat(header.length - 2));

    for (const price of tokenPrices) {
        const dailyEmission = calculateEmission(180);
        const row = [`  $${price.toFixed(2)}`.padEnd(9) + '│'];

        for (const nodes of nodeCounts) {
            // Calculate attacker returns with recalibrated model
            const attackerEff = nodes * 0.85; // Account for edge grazing penalty
            const networkEff = networkSize * 0.80;
            const share = attackerEff / (attackerEff + networkEff);

            const monthlyRevenue = share * dailyEmission * price * 30;
            const monthlyCost = nodes * costPerNode;
            const monthlyProfit = monthlyRevenue - monthlyCost;
            const annualProfit = monthlyProfit * 12;

            let cell;
            if (annualProfit > 5000) {
                cell = c.red + '██████' + c.reset;  // Very profitable
            } else if (annualProfit > 1000) {
                cell = c.red + '████░░' + c.reset;  // Profitable
            } else if (annualProfit > 0) {
                cell = c.yellow + '██░░░░' + c.reset;  // Marginal
            } else if (annualProfit > -500) {
                cell = c.green + '░░░░░░' + c.reset;  // Slight loss
            } else {
                cell = c.green + '      ' + c.reset;  // Clear loss
            }

            row.push(` ${cell} │`);
        }

        console.log(row.join(''));
    }

    console.log('  ' + '─'.repeat(header.length - 2));
    console.log(`\n  Legend: ${c.red}██████${c.reset} Profitable  ${c.yellow}██░░░░${c.reset} Marginal  ${c.green}░░░░░░${c.reset} Unprofitable\n`);

    // Find transition prices
    console.log(`${c.yellow}▶ Break-Even Token Prices (Annual)${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(40)}${c.reset}\n`);

    for (const nodes of nodeCounts) {
        // Binary search for break-even
        let lo = 0.01, hi = 5.0;
        while (hi - lo > 0.005) {
            const mid = (lo + hi) / 2;
            const dailyEmission = calculateEmission(180);
            const attackerEff = nodes * 0.85;
            const networkEff = networkSize * 0.80;
            const share = attackerEff / (attackerEff + networkEff);
            const annualProfit = (share * dailyEmission * mid * 30 - nodes * costPerNode) * 12;

            if (annualProfit > 0) {
                hi = mid;
            } else {
                lo = mid;
            }
        }

        console.log(`  ${String(nodes).padStart(4)} nodes: $${lo.toFixed(3)} token price`);
    }

    // Honest viability with new costs
    console.log(`\n${c.yellow}▶ Honest Viability (Recalibrated Costs)${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(40)}${c.reset}\n`);

    for (const [cls, config] of Object.entries(RELIABILITY_CLASSES)) {
        const monthlyCost = config.monthlyTotalUSD;
        const expectedEff = 0.85; // Accounting for outages
        const dailyEmission = calculateEmission(365);
        const shareOf1000 = expectedEff / (1000 * 0.80);
        const tokensPerMonth = shareOf1000 * dailyEmission * 30;
        const breakEven = monthlyCost / tokensPerMonth;

        const color = breakEven < 0.15 ? c.green : breakEven < 0.30 ? c.yellow : c.red;
        console.log(
            `  ${config.name.padEnd(15)}: ${color}$${breakEven.toFixed(3)}${c.reset} ` +
            `(cost: $${monthlyCost}/mo, eff: ${(expectedEff * 100).toFixed(0)}%)`
        );
    }
}

// Run both analyses
runCheatEVAnalysis();
generateROIHeatmap();

console.log(`\n${c.bold}Analysis complete.${c.reset}\n`);
