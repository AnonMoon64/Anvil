/**
 * Final Adversarial Edge Cases
 * The nastiest tests before moving beyond simulation
 */

import { NodeReliability, RELIABILITY_CLASSES } from './core/reliability.js';
import { calculateEmission } from './core/emission.js';
import { calculateRamp } from './core/effectiveness.js';

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

// ============================================================================
// TEST A: SELECTIVE GRIEFING
// ============================================================================

/**
 * Node class with targeting vulnerabilities
 */
class TargetableNode {
    constructor(id, reliabilityClass) {
        this.id = id;
        this.class = reliabilityClass;
        this.config = RELIABILITY_CLASSES[reliabilityClass];
        this.bandwidth = this.config.bandwidthMbps?.mean || 50;

        this.effectiveness = 0;
        this.participationDays = 0;
        this.totalRewards = 0;
        this.failures = 0;
        this.inducedFailures = 0;
        this.penaltiesReceived = 0;
        this.isBanned = false;
        this.banUntil = 0;

        // Targeting vulnerability scores
        this.vulnerabilityScore = 0;
    }

    /**
     * Calculate how vulnerable this node is to targeting
     */
    calculateVulnerability() {
        // Low bandwidth = more vulnerable
        const bandwidthVuln = 1 - Math.min(1, this.bandwidth / 200);

        // Mid-ramp = valuable target (about to get rewards)
        const rampVuln = this.participationDays > 20 && this.participationDays < 80 ? 0.8 : 0.2;

        // Near edge threshold = easily tipped
        const edgeVuln = this.effectiveness > 0.75 && this.effectiveness < 0.90 ? 0.7 : 0.1;

        // Low effectiveness = already struggling
        const effVuln = 1 - this.effectiveness;

        this.vulnerabilityScore = (bandwidthVuln * 0.3 + rampVuln * 0.3 + edgeVuln * 0.2 + effVuln * 0.2);
        return this.vulnerabilityScore;
    }

    tick(epoch, induced = false) {
        if (this.isBanned && epoch < this.banUntil) {
            return false;
        }
        this.isBanned = false;

        // Natural failure check
        const naturalFailure = Math.random() > (this.config.dailyUptimeHours?.mean || 22) / 24;
        const failed = naturalFailure || induced;

        if (failed) {
            this.failures++;
            if (induced) this.inducedFailures++;

            // Graduated penalty
            if (this.failures >= 5) {
                this.penaltiesReceived++;
                this.effectiveness *= 0.7;
                if (this.failures >= 10) {
                    this.isBanned = true;
                    this.banUntil = epoch + 7;
                }
            }
        } else {
            this.participationDays++;
            this.effectiveness = calculateRamp(this.participationDays);
        }

        return !failed;
    }
}

/**
 * Selective griefing strategies
 */
function simulateSelectiveGriefing(strategy) {
    const {
        epochs = 365,
        nodeCount = 1000,
        griefingBudget = 50,        // Nodes attacker can target per epoch
        griefingCostPerTarget = 2,  // USD per target per epoch
    } = {};

    // Create diverse node population
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
        const classes = Object.keys(RELIABILITY_CLASSES);
        const weights = classes.map(c => RELIABILITY_CLASSES[c].networkFraction);
        let cum = 0, r = Math.random(), cls = 'hobbyist';
        for (let j = 0; j < classes.length; j++) {
            cum += weights[j];
            if (r <= cum) { cls = classes[j]; break; }
        }
        nodes.push(new TargetableNode(i, cls));
    }

    let totalGriefingCost = 0;
    let totalInducedFailures = 0;
    let totalBans = 0;
    let totalRewards = 0;

    const griefingStart = 90;
    const griefingEnd = 270;

    for (let epoch = 0; epoch < epochs; epoch++) {
        const griefingActive = epoch >= griefingStart && epoch < griefingEnd;

        // Update vulnerabilities and select targets
        let targets = [];
        if (griefingActive) {
            nodes.forEach(n => n.calculateVulnerability());

            switch (strategy) {
                case 'lowest-bandwidth':
                    targets = [...nodes].sort((a, b) => a.bandwidth - b.bandwidth).slice(0, griefingBudget);
                    break;
                case 'near-edge':
                    targets = nodes.filter(n => n.effectiveness > 0.75 && n.effectiveness < 0.90)
                        .slice(0, griefingBudget);
                    break;
                case 'mid-ramp':
                    targets = nodes.filter(n => n.participationDays > 20 && n.participationDays < 80)
                        .slice(0, griefingBudget);
                    break;
                case 'most-vulnerable':
                    targets = [...nodes].sort((a, b) => b.vulnerabilityScore - a.vulnerabilityScore)
                        .slice(0, griefingBudget);
                    break;
                case 'random':
                    targets = nodes.sort(() => Math.random() - 0.5).slice(0, griefingBudget);
                    break;
            }

            totalGriefingCost += targets.length * griefingCostPerTarget;
        }

        const targetIds = new Set(targets.map(t => t.id));

        // Tick all nodes
        let onlineCount = 0;
        for (const node of nodes) {
            const induced = targetIds.has(node.id);
            if (induced) totalInducedFailures++;

            const online = node.tick(epoch, induced);
            if (online) onlineCount++;
            if (node.isBanned && node.banUntil === epoch + 7) totalBans++;
        }

        // Distribute rewards
        const emission = calculateEmission(epoch) * 0.25; // $0.25/token
        const rewardPerNode = emission / Math.max(1, onlineCount);

        for (const node of nodes) {
            if (!node.isBanned) {
                node.totalRewards += rewardPerNode * node.effectiveness;
            }
        }
    }

    totalRewards = nodes.reduce((s, n) => s + n.totalRewards, 0);

    // Compute damage metrics
    const nodesWithInducedFailures = nodes.filter(n => n.inducedFailures > 0).length;
    const avgInducedPerTarget = totalInducedFailures / nodesWithInducedFailures || 0;
    const nodesBannedFromGriefing = nodes.filter(n => n.inducedFailures > 0 && n.isBanned).length;

    // Compare to baseline: run same sim without griefing
    // Simplified baseline: sum of daily emissions * avg share per node
    let baselineRewards = 0;
    for (let e = 0; e < epochs; e++) {
        const emission = calculateEmission(e) * 0.25;
        // Average effectiveness ~0.7 for honest network, ~90% online
        baselineRewards += emission * 0.9;
    }

    // Actual damage from reduced rewards due to griefing
    const rewardLoss = Math.max(0, baselineRewards - totalRewards);
    const damageEfficiency = rewardLoss / Math.max(1, totalGriefingCost);

    return {
        strategy,
        totalGriefingCost,
        totalInducedFailures,
        nodesWithInducedFailures,
        avgInducedPerTarget,
        totalBans,
        nodesBannedFromGriefing,
        totalRewards,
        baselineRewards,
        rewardLoss,
        damageEfficiency,
        isEfficient: damageEfficiency > 1,
    };
}

// ============================================================================
// TEST B: NEAR-ZERO FRAUD
// ============================================================================

/**
 * Simulate extremely sparse fraud strategies
 */
function simulateNearZeroFraud(params) {
    const {
        fraudIntervalDays = 60,     // One fraud every N days
        epochs = 365 * 3,           // 3 year horizon
        sampleRate = 0.10,
        fraudOnlyDuringCritical = false,
        rewardPerEpoch = 10,
        costPerEpoch = 0.1,
        numTrials = 500,
    } = params;

    const results = {
        trials: numTrials,
        detected: 0,
        avgDetectionEpoch: 0,
        avgFraudAttempts: 0,
        avgProfit: 0,
        avgHonestProfit: 0,
    };

    for (let trial = 0; trial < numTrials; trial++) {
        let fraudAttempts = 0;
        let detected = false;
        let detectionEpoch = null;
        let profit = 0;

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Simulate "critical load" as 10% of epochs
            const isCritical = epoch % 10 === 0;

            // Decide whether to fraud this epoch
            let doFraud = false;
            if (epoch > 0 && epoch % fraudIntervalDays === 0) {
                if (!fraudOnlyDuringCritical || isCritical) {
                    doFraud = true;
                }
            }

            if (doFraud && !detected) {
                fraudAttempts++;

                // 60% detection rate for sparse fraud (gray zone)
                const detectionRate = sampleRate * 0.60;

                if (Math.random() < detectionRate) {
                    detected = true;
                    detectionEpoch = epoch;

                    // Heavy penalty on detection
                    profit -= 14 * rewardPerEpoch; // Clawback
                    profit -= 30 * rewardPerEpoch * 0.5; // Ban opportunity cost
                } else {
                    // Fraud succeeded
                    profit += rewardPerEpoch * 0.7; // 70% cost savings
                }
            }

            // Regular rewards (if not banned)
            if (!detected || epoch > detectionEpoch + 30) {
                profit += rewardPerEpoch - costPerEpoch;
            }
        }

        if (detected) {
            results.detected++;
            results.avgDetectionEpoch += detectionEpoch;
        }
        results.avgFraudAttempts += fraudAttempts;
        results.avgProfit += profit;
    }

    results.detectionRate = results.detected / numTrials;
    results.avgDetectionEpoch = results.detected > 0 ? results.avgDetectionEpoch / results.detected : epochs;
    results.avgFraudAttempts /= numTrials;
    results.avgProfit /= numTrials;
    results.avgHonestProfit = (rewardPerEpoch - costPerEpoch) * epochs;
    results.evDifference = results.avgProfit - results.avgHonestProfit;
    results.isProfitable = results.avgProfit > results.avgHonestProfit;

    return results;
}

// ============================================================================
// TEST C: PARAMETER SENSITIVITY BANDS
// ============================================================================

/**
 * Test defense across parameter variations
 */
function runSensitivityAnalysis() {
    const baseline = {
        sampleRate: 0.10,
        auditRate: 0.05,
        honeychurn: 0.05,
        detectionProb: 0.95,
    };

    const results = [];

    // Vary each parameter ±50%
    const variations = [0.5, 0.75, 1.0, 1.25, 1.5];

    // Sample rate sensitivity
    for (const mult of variations) {
        const r = simulateWithParams({
            ...baseline,
            sampleRate: baseline.sampleRate * mult,
        });
        results.push({ param: 'sampleRate', multiplier: mult, ...r });
    }

    // Audit rate sensitivity
    for (const mult of variations) {
        const r = simulateWithParams({
            ...baseline,
            auditRate: baseline.auditRate * mult,
        });
        results.push({ param: 'auditRate', multiplier: mult, ...r });
    }

    // Churn sensitivity
    for (const mult of variations) {
        const r = simulateWithParams({
            ...baseline,
            honeychurn: baseline.honeychurn * mult,
        });
        results.push({ param: 'churn', multiplier: mult, ...r });
    }

    // Detection probability sensitivity
    for (const mult of [0.6, 0.7, 0.8, 0.9, 1.0]) {
        const r = simulateWithParams({
            ...baseline,
            detectionProb: baseline.detectionProb * mult,
        });
        results.push({ param: 'detectionProb', multiplier: mult, ...r });
    }

    return results;
}

function simulateWithParams(params) {
    const { sampleRate, auditRate, honeychurn, detectionProb } = params;
    const epochs = 365;
    const attackerNodes = 100;
    const honestNodes = 1000;

    let attackerRewards = 0;
    let attackerCosts = 0;
    let detections = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
        // Honest churn
        const activeHonest = honestNodes * (1 - honeychurn * Math.random());
        const totalNodes = activeHonest + attackerNodes;

        const emission = calculateEmission(epoch) * 0.25;
        const attackerShare = (attackerNodes * 0.8) / (totalNodes * 0.8);

        // Detection
        const detectThisEpoch = Math.random() < (sampleRate + auditRate) * detectionProb;
        if (detectThisEpoch) {
            detections++;
            attackerRewards -= 14 * emission * attackerShare; // Clawback
        } else {
            attackerRewards += emission * attackerShare;
        }

        attackerCosts += attackerNodes * 0.1; // $0.10/node/day
    }

    const profit = attackerRewards - attackerCosts;

    return {
        detections,
        profit,
        isProfitable: profit > 0,
        params,
    };
}

// ============================================================================
// MAIN
// ============================================================================

function runAllEdgeCases() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  FINAL ADVERSARIAL EDGE CASES${c.reset}`);
    console.log(`${c.dim}  "The nastiest tests before moving beyond simulation"${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    // ========== TEST A: SELECTIVE GRIEFING ==========
    console.log(`${c.yellow}▶ TEST A: Selective Griefing${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    console.log('  Attacker targets specific vulnerable nodes instead of random...\n');

    const strategies = ['random', 'lowest-bandwidth', 'near-edge', 'mid-ramp', 'most-vulnerable'];

    console.log(`  ${'Strategy'.padEnd(20)} | ${'Induced'.padStart(8)} | ${'Bans'.padStart(6)} | ${'Cost'.padStart(10)} | ${'Damage'.padStart(10)} | ${'Eff'.padStart(8)}`);
    console.log(`  ${'─'.repeat(70)}`);

    for (const strat of strategies) {
        const r = simulateSelectiveGriefing(strat);
        const color = r.isEfficient ? c.red : c.green;
        console.log(
            `  ${strat.padEnd(20)} | ` +
            `${String(r.totalInducedFailures).padStart(6)} | ` +
            `${String(r.nodesBannedFromGriefing).padStart(4)} | ` +
            `$${r.totalGriefingCost.toFixed(0).padStart(8)} | ` +
            `$${r.rewardLoss.toFixed(0).padStart(8)} | ` +
            `${color}${r.damageEfficiency.toFixed(2).padStart(6)}x${c.reset}`
        );
    }

    const mostDangerous = strategies.map(s => simulateSelectiveGriefing(s))
        .sort((a, b) => b.damageEfficiency - a.damageEfficiency)[0];

    if (mostDangerous.isEfficient) {
        console.log(`\n  ${c.red}⚠ WARNING: "${mostDangerous.strategy}" griefing is efficient (${mostDangerous.damageEfficiency.toFixed(2)}x)${c.reset}`);
    } else {
        console.log(`\n  ${c.green}✓ All selective griefing strategies are inefficient${c.reset}`);
    }

    // ========== TEST B: NEAR-ZERO FRAUD ==========
    console.log(`\n${c.yellow}▶ TEST B: Near-Zero Fraud Strategies${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    console.log('  Testing fraud so sparse it tries to hide forever (3-year horizon)...\n');

    const fraudIntervals = [30, 60, 90, 180, 365];

    console.log(`  ${'Interval'.padEnd(12)} | ${'Detected'.padStart(10)} | ${'Avg Detect'.padStart(12)} | ${'EV Diff'.padStart(12)} | Profitable?`);
    console.log(`  ${'─'.repeat(65)}`);

    for (const interval of fraudIntervals) {
        const r = simulateNearZeroFraud({ fraudIntervalDays: interval });
        const color = r.isProfitable ? c.red : c.green;
        console.log(
            `  ${(interval + 'd').padEnd(12)} | ` +
            `${(r.detectionRate * 100).toFixed(0).padStart(8)}% | ` +
            `${r.avgDetectionEpoch.toFixed(0).padStart(10)}d | ` +
            `$${r.evDifference.toFixed(2).padStart(10)} | ` +
            `${color}${r.isProfitable ? 'YES ⚠' : 'No ✓'}${c.reset}`
        );
    }

    // Test "fraud only during critical"
    console.log('\n  Testing fraud only during "Critical" load moments...\n');

    const criticalFraud = simulateNearZeroFraud({
        fraudIntervalDays: 30,
        fraudOnlyDuringCritical: true
    });
    const criticalColor = criticalFraud.isProfitable ? c.red : c.green;
    console.log(
        `  Critical-only fraud: ${criticalColor}EV diff: $${criticalFraud.evDifference.toFixed(2)}${c.reset} ` +
        `(detected ${(criticalFraud.detectionRate * 100).toFixed(0)}%)`
    );

    // ========== TEST C: PARAMETER SENSITIVITY ==========
    console.log(`\n${c.yellow}▶ TEST C: Parameter Sensitivity Bands${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    console.log('  Testing if defense degrades gracefully under parameter variation...\n');

    const sensitivity = runSensitivityAnalysis();

    // Group by parameter
    const byParam = {};
    for (const r of sensitivity) {
        if (!byParam[r.param]) byParam[r.param] = [];
        byParam[r.param].push(r);
    }

    for (const [param, results] of Object.entries(byParam)) {
        console.log(`  ${c.bold}${param}${c.reset} (baseline = ${param === 'detectionProb' ? '95%' : '1.0x'}):`);

        const row = [];
        for (const r of results) {
            const color = r.isProfitable ? c.red : c.green;
            const label = param === 'detectionProb'
                ? `${(r.multiplier * 95).toFixed(0)}%`
                : `${r.multiplier.toFixed(2)}x`;
            row.push(`${label}: ${color}${r.isProfitable ? 'FAIL' : 'OK'}${c.reset}`);
        }
        console.log(`    ${row.join(' │ ')}`);
    }

    // Find collapse points
    console.log(`\n  ${c.bold}Collapse Analysis:${c.reset}`);

    for (const [param, results] of Object.entries(byParam)) {
        const firstFail = results.find(r => r.isProfitable);
        if (firstFail) {
            const label = param === 'detectionProb'
                ? `${(firstFail.multiplier * 95).toFixed(0)}%`
                : `${firstFail.multiplier.toFixed(2)}x`;
            console.log(`    ${c.red}⚠ ${param} fails at ${label}${c.reset}`);
        } else {
            console.log(`    ${c.green}✓ ${param} holds across all variations${c.reset}`);
        }
    }

    // ========== SUMMARY ==========
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  SUMMARY${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    const allGriefingOk = strategies.every(s => !simulateSelectiveGriefing(s).isEfficient);
    const allFraudOk = fraudIntervals.every(i => !simulateNearZeroFraud({ fraudIntervalDays: i }).isProfitable);
    const sensitivityOk = !Object.values(byParam).some(results => results.some(r => r.isProfitable));

    console.log(`  Selective Griefing: ${allGriefingOk ? c.green + '✓ PASS' : c.red + '✗ FAIL'}${c.reset}`);
    console.log(`  Near-Zero Fraud:    ${allFraudOk ? c.green + '✓ PASS' : c.red + '✗ FAIL'}${c.reset}`);
    console.log(`  Sensitivity Bands:  ${sensitivityOk ? c.green + '✓ PASS' : c.yellow + '⚠ SOME FAILURES'}${c.reset}`);

    if (allGriefingOk && allFraudOk) {
        console.log(`\n  ${c.green}${c.bold}Protocol passes all edge case tests.${c.reset}`);
        console.log(`  ${c.green}Ready for multi-machine prototype.${c.reset}`);
    } else {
        console.log(`\n  ${c.yellow}Some edge cases need attention before prototype.${c.reset}`);
    }

    console.log();
}

runAllEdgeCases();

export { simulateSelectiveGriefing, simulateNearZeroFraud, runSensitivityAnalysis };
