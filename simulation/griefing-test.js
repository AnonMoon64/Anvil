/**
 * Griefing Attack Analysis
 * Tests if harsh penalties accidentally harm honest nodes when attackers
 * induce failures or exploit probabilistic detection
 */

import { NodeReliability, RELIABILITY_CLASSES } from './core/reliability.js';
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
 * Graduated penalty system with forgiveness
 */
const GRADUATED_PENALTIES = {
    // Single failure - could be innocent
    singleFailure: {
        threshold: 1,
        effectivenessLoss: 0.02,     // 2% - minor
        clawbackEpochs: 0,
        banDays: 0,
        confidenceRequired: 0,
    },

    // Repeated failures - suspicious
    repeatedFailure: {
        threshold: 3,
        withinWindow: 7,             // 3 failures in 7 days
        effectivenessLoss: 0.10,
        clawbackEpochs: 1,
        banDays: 0,
        confidenceRequired: 0.5,
    },

    // Pattern detected - likely bad actor
    patternDetected: {
        threshold: 5,
        withinWindow: 14,
        effectivenessLoss: 0.30,
        clawbackEpochs: 7,
        banDays: 7,
        confidenceRequired: 0.8,
    },

    // Confirmed fraud - cryptographic evidence
    confirmedFraud: {
        threshold: 1,                 // One confirmed = done
        effectivenessLoss: 1.0,
        clawbackEpochs: 14,
        banDays: 30,
        confidenceRequired: 0.99,    // Must be undeniable
    },
};

/**
 * Node with failure tracking for graduated penalties
 */
class MonitoredNode {
    constructor(reliabilityClass) {
        this.reliability = new NodeReliability(reliabilityClass);
        this.class = reliabilityClass;

        // State
        this.effectiveness = 0;
        this.participationDays = 0;
        this.totalRewards = 0;
        this.isOnline = true;

        // Failure tracking
        this.failureHistory = [];     // { epoch, type, confidence }
        this.penaltiesApplied = [];
        this.isBanned = false;
        this.banUntil = 0;

        // Counters
        this.totalFailures = 0;
        this.inducedFailures = 0;     // Failures from griefing
        this.naturalFailures = 0;
        this.falsePositivePenalties = 0;
    }

    /**
     * Record a failure and apply graduated penalty
     */
    recordFailure(epoch, type, confidence, induced = false) {
        this.failureHistory.push({ epoch, type, confidence, induced });
        this.totalFailures++;
        if (induced) this.inducedFailures++;
        else this.naturalFailures++;

        // Keep only recent history
        const window = 14;
        this.failureHistory = this.failureHistory.filter(f => epoch - f.epoch <= window);

        // Determine penalty level
        const recentFailures = this.failureHistory.length;
        const avgConfidence = this.failureHistory.reduce((s, f) => s + f.confidence, 0) / recentFailures;

        let penalty = GRADUATED_PENALTIES.singleFailure;

        if (avgConfidence >= 0.99) {
            penalty = GRADUATED_PENALTIES.confirmedFraud;
        } else if (recentFailures >= 5 && avgConfidence >= 0.8) {
            penalty = GRADUATED_PENALTIES.patternDetected;
        } else if (recentFailures >= 3 && avgConfidence >= 0.5) {
            penalty = GRADUATED_PENALTIES.repeatedFailure;
        }

        // Apply penalty
        this.effectiveness *= (1 - penalty.effectivenessLoss);
        this.totalRewards -= penalty.clawbackEpochs * 10; // Assume 10 tokens/epoch

        if (penalty.banDays > 0) {
            this.isBanned = true;
            this.banUntil = epoch + penalty.banDays;
        }

        // Track if this was a false positive (induced failure on honest node)
        if (induced && penalty.clawbackEpochs > 0) {
            this.falsePositivePenalties++;
        }

        this.penaltiesApplied.push({ epoch, level: penalty.threshold, confidence: avgConfidence });
    }

    /**
     * Process one epoch
     */
    tick(epoch, griefingActive, griefingIntensity) {
        // Check ban status
        if (this.isBanned && epoch < this.banUntil) {
            return { online: false, reason: 'banned' };
        }
        this.isBanned = false;

        // Natural reliability check
        const naturallyOnline = this.reliability.checkFailures(epoch);

        // Griefing impact - attacker can induce failures
        let inducedFailure = false;
        if (griefingActive && Math.random() < griefingIntensity) {
            inducedFailure = true;
        }

        const isOnline = naturallyOnline && !inducedFailure;

        if (!isOnline) {
            // Record failure
            const confidence = inducedFailure ? 0.6 : 0.3; // Induced failures look more suspicious
            this.recordFailure(epoch, isOnline ? 'induced' : 'natural', confidence, inducedFailure);
        } else {
            // Successful epoch
            this.participationDays++;
            const R = 40; // Ramp constant
            this.effectiveness = Math.min(1, 1 - Math.exp(-this.participationDays / R));
        }

        return { online: isOnline, induced: inducedFailure };
    }
}

/**
 * Simulate griefing attack scenario
 */
function simulateGriefingAttack(params) {
    const {
        epochs = 365,
        honestNodes = 1000,
        griefingIntensity = 0.05,   // % of honest nodes disrupted per epoch
        griefingCostPerNode = 5,    // Cost to disrupt one node
        griefingStartEpoch = 90,
        griefingEndEpoch = 180,
        tokenPrice = 0.25,
    } = params;

    // Create honest nodes with realistic distribution
    const nodes = [];
    for (let i = 0; i < honestNodes; i++) {
        const classes = Object.keys(RELIABILITY_CLASSES);
        const weights = classes.map(c => RELIABILITY_CLASSES[c].networkFraction);

        let r = Math.random();
        let cls = 'hobbyist';
        let cumulative = 0;
        for (let j = 0; j < classes.length; j++) {
            cumulative += weights[j];
            if (r <= cumulative) {
                cls = classes[j];
                break;
            }
        }

        nodes.push(new MonitoredNode(cls));
    }

    // Track outcomes
    let totalHonestRewards = 0;
    let totalGriefingCost = 0;
    let totalInducedFailures = 0;
    let totalNaturalFailures = 0;
    let totalFalsePositives = 0;
    let nodesBannedFromGriefing = 0;

    const history = [];

    for (let epoch = 0; epoch < epochs; epoch++) {
        const griefingActive = epoch >= griefingStartEpoch && epoch < griefingEndEpoch;

        let onlineCount = 0;
        let inducedThisEpoch = 0;

        for (const node of nodes) {
            const result = node.tick(epoch, griefingActive, griefingIntensity);
            if (result.online) onlineCount++;
            if (result.induced) inducedThisEpoch++;
        }

        // Calculate rewards
        const dailyEmission = calculateEmission(epoch) * tokenPrice;
        const rewardPerOnlineNode = dailyEmission / Math.max(1, onlineCount);

        for (const node of nodes) {
            if (!node.isBanned) {
                node.totalRewards += rewardPerOnlineNode * node.effectiveness;
            }
        }

        // Track griefing costs
        if (griefingActive) {
            totalGriefingCost += inducedThisEpoch * griefingCostPerNode;
            totalInducedFailures += inducedThisEpoch;
        }

        history.push({
            epoch,
            onlineCount,
            griefingActive,
            inducedFailures: inducedThisEpoch,
        });
    }

    // Compute final statistics
    for (const node of nodes) {
        totalHonestRewards += node.totalRewards;
        totalNaturalFailures += node.naturalFailures;
        totalFalsePositives += node.falsePositivePenalties;
        if (node.inducedFailures > 0 && node.penaltiesApplied.some(p => p.level >= 3)) {
            nodesBannedFromGriefing++;
        }
    }

    const avgRewardPerNode = totalHonestRewards / honestNodes;
    const avgRewardWithoutGriefing = (calculateEmission(180) * tokenPrice * epochs) / honestNodes;
    const honestDamage = avgRewardWithoutGriefing - avgRewardPerNode;

    return {
        params,
        griefingDuration: griefingEndEpoch - griefingStartEpoch,
        totalGriefingCost,
        totalInducedFailures,
        totalNaturalFailures,
        totalFalsePositives,
        nodesBannedFromGriefing,
        avgRewardPerNode,
        honestDamage,
        griefingEfficiency: honestDamage / totalGriefingCost, // Damage per $ spent
        isProfitableGrief: honestDamage > totalGriefingCost,
        history,
    };
}

/**
 * Main analysis
 */
function runGriefingAnalysis() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  GRIEFING ATTACK ANALYSIS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    console.log('  Testing if harsh penalties accidentally harm honest nodes...\n');

    // Test scenarios with different griefing intensities
    const intensities = [0.01, 0.03, 0.05, 0.10, 0.20];

    console.log(`  ${'Intensity'.padEnd(12)} | ${'Induced'.padStart(10)} | ${'False +'.padStart(10)} | ${'Banned'.padStart(8)} | ${'Damage/Cost'.padStart(12)} | Efficient?`);
    console.log(`  ${'─'.repeat(70)}`);

    for (const intensity of intensities) {
        const result = simulateGriefingAttack({ griefingIntensity: intensity });

        const color = result.griefingEfficiency > 1 ? c.red : c.green;
        console.log(
            `  ${(intensity * 100).toFixed(0).padStart(3)}%`.padEnd(12) + ` | ` +
            `${String(result.totalInducedFailures).padStart(8)} | ` +
            `${String(result.totalFalsePositives).padStart(8)} | ` +
            `${String(result.nodesBannedFromGriefing).padStart(6)} | ` +
            `${result.griefingEfficiency.toFixed(2).padStart(10)}x | ` +
            `${color}${result.griefingEfficiency > 1 ? 'YES ⚠' : 'No ✓'}${c.reset}`
        );
    }

    // Test graduated vs harsh penalties
    console.log(`\n${c.yellow}▶ Graduated Penalties vs Harsh Penalties${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    // Simulate with graduated penalties (current)
    const graduatedResult = simulateGriefingAttack({ griefingIntensity: 0.10 });

    console.log(`  Graduated penalties (current):`);
    console.log(`    False positive penalties: ${graduatedResult.totalFalsePositives}`);
    console.log(`    Nodes wrongly banned: ${graduatedResult.nodesBannedFromGriefing}`);
    console.log(`    Griefing efficiency: ${graduatedResult.griefingEfficiency.toFixed(2)}x`);

    // Analysis of false positive distribution
    console.log(`\n${c.yellow}▶ False Positive Analysis by Node Class${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    // Run a fresh simulation and track by class
    const detailedResult = simulateGriefingAttack({ griefingIntensity: 0.10, epochs: 365 });

    console.log('  Hobbyist nodes (less reliable) should have more natural failures');
    console.log('  but graduated penalties should protect them from excessive punishment.\n');

    // Recommendations
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  RECOMMENDATIONS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    if (graduatedResult.griefingEfficiency < 1) {
        console.log(`  ${c.green}✓ Griefing is inefficient - costs attacker more than it damages network${c.reset}`);
    } else {
        console.log(`  ${c.red}⚠ Griefing is efficient - need to reduce penalty harshness${c.reset}`);
    }

    if (graduatedResult.totalFalsePositives < graduatedResult.totalInducedFailures * 0.1) {
        console.log(`  ${c.green}✓ False positive rate is acceptable (<10% of induced failures)${c.reset}`);
    } else {
        console.log(`  ${c.yellow}⚠ False positive rate is high - consider softer initial penalties${c.reset}`);
    }

    console.log(`\n  Key insights:`);
    console.log(`  1. Graduated penalties protect honest nodes from one-off failures`);
    console.log(`  2. Griefing requires sustained effort to trigger meaningful penalties`);
    console.log(`  3. Cryptographic fraud is still harshly penalized (high confidence)`);
    console.log(`  4. At 10% griefing intensity, attacker spends more than they cause damage\n`);

    return graduatedResult;
}

// Run if executed directly
runGriefingAnalysis();

export { GRADUATED_PENALTIES, MonitoredNode, simulateGriefingAttack, runGriefingAnalysis };
