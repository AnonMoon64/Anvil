/**
 * Anvil Protocol Stress Test Suite
 * Tests that try to BREAK the protocol - adding realism until results get ugly
 */

import { NodeReliability, RELIABILITY_CLASSES, assignReliabilityClass, analyzeNetworkReliability } from './core/reliability.js';
import { CHALLENGE_TYPES, NetworkLoadSimulator, runChallenges } from './core/network-constraints.js';
import { VERIFICATION_CONFIG, FRAUD_TYPES, monteCarloFraudAnalysis, calculateFraudExpectedValue, recommendVerificationParams } from './core/verification.js';
import { ATTACKER_STRATEGIES, compareStrategies, analyzeSmooothingExploit, modelGriefAttack } from './core/attackers.js';
import { calculateRamp, calculateDecay, daysToReachEffectiveness } from './core/effectiveness.js';
import { calculateEmission } from './core/emission.js';
import { calculateGini } from './core/rewards.js';
import CONFIG from './config.js';

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

function header(title) {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  ${title}${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);
}

function subheader(title) {
    console.log(`\n${c.yellow}▶ ${title}${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}`);
}

function warn(msg) {
    console.log(`${c.red}  ⚠ ${msg}${c.reset}`);
}

function ok(msg) {
    console.log(`${c.green}  ✓ ${msg}${c.reset}`);
}

function info(msg) {
    console.log(`  ${msg}`);
}

// ============================================================================
// STRESS TEST 1: Realistic Churn & Reliability Classes
// ============================================================================

function stressTestReliability() {
    header('STRESS TEST 1: Realistic Churn & Reliability Classes');

    info('Simulating 1000 nodes with heterogeneous reliability...\n');

    // Create nodes with realistic reliability distribution
    const nodes = [];
    for (let i = 0; i < 1000; i++) {
        const reliabilityClass = assignReliabilityClass();
        nodes.push({
            id: i,
            reliability: new NodeReliability(reliabilityClass),
            participationDays: 0,
            effectiveness: 0,
            isDown: false,
        });
    }

    // Count by class
    const classCounts = {};
    for (const node of nodes) {
        const cls = node.reliability.class;
        classCounts[cls] = (classCounts[cls] || 0) + 1;
    }

    subheader('Node Distribution by Reliability Class');
    for (const [cls, count] of Object.entries(classCounts)) {
        const config = RELIABILITY_CLASSES[cls];
        info(`  ${config.name.padEnd(15)}: ${String(count).padStart(4)} nodes (${(count / 10).toFixed(1)}%)`);
    }

    // Simulate 365 days
    subheader('Running 365-Day Simulation with Failures');

    const effectivenessSnapshots = { day30: [], day120: [], day365: [] };
    const dailyStats = [];

    for (let day = 1; day <= 365; day++) {
        let onlineCount = 0;
        let totalEff = 0;

        for (const node of nodes) {
            // Check for failures
            const isOperational = node.reliability.checkFailures(day);

            if (isOperational && !node.isDown) {
                node.participationDays++;
                node.effectiveness = calculateRamp(node.participationDays);
                onlineCount++;
                totalEff += node.effectiveness;
            } else if (!isOperational && !node.isDown) {
                // Just went down
                node.isDown = true;
                node.effectivenessWhenDown = node.effectiveness;
            } else if (isOperational && node.isDown) {
                // Coming back online
                node.isDown = false;
                // Decay effectiveness based on time down
                const daysDown = node.reliability.totalDowntimeDays;
                node.effectiveness = calculateDecay(node.effectivenessWhenDown, daysDown);
                // Convert back to participation days
                if (node.effectiveness > 0.01) {
                    node.participationDays = -CONFIG.effectiveness.rampTimeConstant *
                        Math.log(1 - node.effectiveness);
                } else {
                    node.participationDays = 0;
                }
                onlineCount++;
                totalEff += node.effectiveness;
            } else {
                // Still down
                node.effectiveness = 0;
            }
        }

        dailyStats.push({
            day,
            onlineCount,
            avgEffectiveness: totalEff / nodes.length,
            onlineRate: onlineCount / nodes.length,
        });

        // Capture snapshots
        if (day === 30) {
            effectivenessSnapshots.day30 = nodes.map(n => n.effectiveness);
        } else if (day === 120) {
            effectivenessSnapshots.day120 = nodes.map(n => n.effectiveness);
        } else if (day === 365) {
            effectivenessSnapshots.day365 = nodes.map(n => n.effectiveness);
        }

        // Progress report
        if (day % 90 === 0) {
            info(`  Day ${day}: ${onlineCount} online (${(onlineCount / 10).toFixed(1)}%), ` +
                `avg eff = ${(totalEff / nodes.length).toFixed(3)}`);
        }
    }

    // Analyze effectiveness distribution
    subheader('Effectiveness Distribution Over Time');

    for (const [label, effList] of Object.entries(effectivenessSnapshots)) {
        const buckets = {
            '<10%': 0, '10-25%': 0, '25-50%': 0, '50-75%': 0, '75-90%': 0, '90-100%': 0
        };

        for (const e of effList) {
            const pct = e * 100;
            if (pct < 10) buckets['<10%']++;
            else if (pct < 25) buckets['10-25%']++;
            else if (pct < 50) buckets['25-50%']++;
            else if (pct < 75) buckets['50-75%']++;
            else if (pct < 90) buckets['75-90%']++;
            else buckets['90-100%']++;
        }

        info(`\n  ${label}:`);
        for (const [bucket, count] of Object.entries(buckets)) {
            const bar = '█'.repeat(Math.round(count / 20));
            info(`    ${bucket.padEnd(10)}: ${bar} ${count}`);
        }
    }

    // Check if decay is being stressed
    subheader('Decay Stress Analysis');

    const nodesBelowHalf = effectivenessSnapshots.day365.filter(e => e < 0.5).length;
    const nodesReset = effectivenessSnapshots.day365.filter(e => e < 0.1).length;
    const avgFinalEff = effectivenessSnapshots.day365.reduce((a, b) => a + b, 0) / 1000;

    info(`  Nodes <50% effectiveness: ${nodesBelowHalf} (${(nodesBelowHalf / 10).toFixed(1)}%)`);
    info(`  Nodes <10% (effectively reset): ${nodesReset} (${(nodesReset / 10).toFixed(1)}%)`);
    info(`  Average final effectiveness: ${avgFinalEff.toFixed(3)}`);

    if (avgFinalEff > 0.9 && nodesBelowHalf < 50) {
        warn('Network converged to high effectiveness - decay may not be aggressive enough!');
        warn('Consider: shorter grace period, steeper decay, or harder challenges.');
    } else {
        ok('Reasonable effectiveness distribution with realistic failures.');
    }

    // Tail risk
    const reliabilityStats = {};
    for (const node of nodes) {
        const cls = node.reliability.class;
        if (!reliabilityStats[cls]) {
            reliabilityStats[cls] = { count: 0, totalEff: 0, outages: 0, downtime: 0 };
        }
        reliabilityStats[cls].count++;
        reliabilityStats[cls].totalEff += node.effectiveness;
        reliabilityStats[cls].outages += node.reliability.totalOutages;
        reliabilityStats[cls].downtime += node.reliability.totalDowntimeDays;
    }

    subheader('Reliability Class Performance');
    for (const [cls, stats] of Object.entries(reliabilityStats)) {
        const config = RELIABILITY_CLASSES[cls];
        info(`  ${config.name}:`);
        info(`    Avg effectiveness: ${(stats.totalEff / stats.count).toFixed(3)}`);
        info(`    Avg outages/node: ${(stats.outages / stats.count).toFixed(2)}`);
        info(`    Avg downtime/node: ${(stats.downtime / stats.count).toFixed(2)} days`);
    }
}

// ============================================================================
// STRESS TEST 2: Network Constraint Failures
// ============================================================================

function stressTestNetworkConstraints() {
    header('STRESS TEST 2: Network Constraints as Limiting Factor');

    const loadSim = new NetworkLoadSimulator();

    // Test challenge success across reliability classes
    subheader('Challenge Success Rate by Class & Load');

    const loadLevels = [0.1, 0.3, 0.5, 0.7, 0.9];

    console.log(`\n  Class          | Load 10% | Load 30% | Load 50% | Load 70% | Load 90%`);
    console.log(`  ${'─'.repeat(67)}`);

    for (const [cls, config] of Object.entries(RELIABILITY_CLASSES)) {
        const row = [`  ${config.name.padEnd(14)}`];

        for (const load of loadLevels) {
            // Simulate 100 nodes of this class facing 50 challenges each
            let totalPassed = 0;
            let totalChallenges = 0;

            for (let n = 0; n < 100; n++) {
                const node = { reliability: new NodeReliability(cls) };
                const results = runChallenges(node, 50, load);
                totalPassed += results.passed;
                totalChallenges += results.attempted;
            }

            const successRate = (totalPassed / totalChallenges * 100).toFixed(1);
            row.push(`| ${successRate.padStart(6)}% `);
        }

        console.log(row.join(''));
    }

    // Test different challenge types
    subheader('Challenge Type Success Rates (50% Load)');

    for (const [type, config] of Object.entries(CHALLENGE_TYPES)) {
        info(`  ${config.name}:`);
        info(`    Payload: ${config.payloadMB} MB, Deadline: ${config.deadlineMs}ms`);

        // Test hobbyist vs datacenter
        for (const cls of ['hobbyist', 'datacenter']) {
            let passed = 0;
            for (let i = 0; i < 1000; i++) {
                const node = { reliability: new NodeReliability(cls) };
                const challenge = { ...config };
                const result = runChallenges(node, 1, 0.5);
                passed += result.passed;
            }
            info(`    ${RELIABILITY_CLASSES[cls].name}: ${(passed / 10).toFixed(1)}% success`);
        }
    }

    // Large operator disadvantage
    subheader('Large Operator Challenge Pass Rate');

    info('  Simulating operators with increasing node counts...\n');

    const operatorSizes = [1, 10, 50, 100, 500, 1000];

    for (const size of operatorSizes) {
        // More nodes = more concurrent load = higher failure rate
        const loadFromScale = Math.min(0.8, 0.1 + size * 0.001);
        let totalPassed = 0;
        let totalChallenges = 0;

        for (let n = 0; n < Math.min(size, 100); n++) {
            const node = { reliability: new NodeReliability('professional') };
            const results = runChallenges(node, 50, loadFromScale);
            totalPassed += results.passed;
            totalChallenges += results.attempted;
        }

        const rate = (totalPassed / totalChallenges * 100).toFixed(1);
        const color = parseFloat(rate) < 90 ? c.yellow : c.green;
        info(`  ${String(size).padStart(4)} nodes: ${color}${rate}%${c.reset} pass rate (load factor: ${(loadFromScale * 100).toFixed(0)}%)`);
    }
}

// ============================================================================
// STRESS TEST 3: Verification Sampling Attacks
// ============================================================================

function stressTestVerificationAttacks() {
    header('STRESS TEST 3: Verification Sampling Attack Analysis');

    subheader('Detection Probability Over Time');

    info('  How long can an attacker commit fraud before detection?\n');

    const fraudsPerEpoch = [1, 5, 10, 50];
    const epochs = [7, 30, 90, 365];

    console.log(`  Frauds/Epoch | 7 days  | 30 days | 90 days | 365 days`);
    console.log(`  ${'─'.repeat(52)}`);

    for (const frauds of fraudsPerEpoch) {
        const row = [`  ${String(frauds).padStart(12)} `];

        for (const ep of epochs) {
            const mc = monteCarloFraudAnalysis(1000, frauds, ep, 'fakeWorkProof');
            const color = mc.caughtRate > 0.9 ? c.green : mc.caughtRate > 0.5 ? c.yellow : c.red;
            row.push(`| ${color}${(mc.caughtRate * 100).toFixed(0).padStart(5)}%${c.reset} `);
        }

        console.log(row.join(''));
    }

    // Expected value analysis
    subheader('Fraud Expected Value Analysis');

    const normalReward = 10;  // tokens/epoch
    const normalCost = 5;     // USD/epoch

    for (const [fraudType, config] of Object.entries(FRAUD_TYPES)) {
        const analysis = calculateFraudExpectedValue(fraudType, normalReward, normalCost, 365);

        const color = analysis.isProfitable ? c.red : c.green;
        info(`  ${config.name}:`);
        info(`    Detection rate: ${(analysis.probabilityOfDetection * 100).toFixed(1)}%`);
        info(`    EV Fraud: $${analysis.evFraud.toFixed(2)}, EV Honest: $${analysis.evHonest.toFixed(2)}`);
        info(`    ${color}${analysis.isProfitable ? '⚠ PROFITABLE' : '✓ Unprofitable'}${c.reset}`);
    }

    // Recommend verification params
    subheader('Verification Parameter Recommendations');

    const targets = [
        { detectionRate: 0.95, fraudsPerEpoch: 10, epochs: 30 },
        { detectionRate: 0.99, fraudsPerEpoch: 10, epochs: 30 },
        { detectionRate: 0.99, fraudsPerEpoch: 50, epochs: 30 },
    ];

    for (const target of targets) {
        const rec = recommendVerificationParams(
            target.detectionRate,
            target.fraudsPerEpoch,
            target.epochs
        );
        info(`  For ${(target.detectionRate * 100).toFixed(0)}% detection of ${target.fraudsPerEpoch} frauds/epoch over ${target.epochs} days:`);
        info(`    Required sample rate: ${(rec.recommendedSampleRate * 100).toFixed(2)}%`);
        info(`    Verification cost: ${rec.verificationCostMultiplier.toFixed(1)}x baseline`);
    }
}

// ============================================================================
// STRESS TEST 4: Attack Strategy Comparison
// ============================================================================

function stressTestAttackerStrategies() {
    header('STRESS TEST 4: Attacker Strategy Comparison');

    const scenarios = [
        { nodeCount: 10, networkSize: 100, tokenPrice: 0.1, label: 'Small (10 vs 100)' },
        { nodeCount: 100, networkSize: 100, tokenPrice: 0.1, label: 'Equal (100 vs 100)' },
        { nodeCount: 100, networkSize: 1000, tokenPrice: 0.1, label: 'Minority (100 vs 1000)' },
        { nodeCount: 100, networkSize: 100, tokenPrice: 1.0, label: 'High Price ($1)' },
    ];

    for (const scenario of scenarios) {
        subheader(`Scenario: ${scenario.label}`);

        const dailyEmission = calculateEmission(180); // Mid-year
        const baseCost = 100; // Monthly cost per node

        const comparison = compareStrategies(
            scenario.nodeCount,
            scenario.networkSize,
            365,
            dailyEmission * scenario.tokenPrice,
            baseCost
        );

        info(`  Token price: $${scenario.tokenPrice}, Emission: ${dailyEmission.toFixed(2)}/day\n`);

        console.log(`  ${'Strategy'.padEnd(20)} | ${'Profit'.padStart(12)} | ${'ROI'.padStart(8)} | Viable?`);
        console.log(`  ${'─'.repeat(55)}`);

        for (const strat of comparison.ranked) {
            const viable = strat.totalProfit > 0;
            const color = viable ? c.red : c.green;
            console.log(
                `  ${strat.name.padEnd(20)} | ` +
                `$${strat.totalProfit.toFixed(2).padStart(10)} | ` +
                `${(strat.roi * 100).toFixed(1).padStart(6)}% | ` +
                `${color}${viable ? 'YES ⚠' : 'No'}${c.reset}`
            );
        }

        if (comparison.ranked.some(s => s.totalProfit > 0)) {
            warn(`Attack is profitable for: ${comparison.ranked.filter(s => s.totalProfit > 0).map(s => s.name).join(', ')}`);
        } else {
            ok('No profitable attack strategy at this price point.');
        }
    }
}

// ============================================================================
// STRESS TEST 5: EMA Smoothing Exploitation
// ============================================================================

function stressTestSmoothingExploit() {
    header('STRESS TEST 5: EMA Smoothing Lag Exploitation');

    subheader('Attacker Entry Exploit');

    const alphas = [0.05, 0.1, 0.2, 0.3];

    for (const alpha of alphas) {
        const analysis = analyzeSmooothingExploit(
            alpha,
            1000,   // Attacker nodes
            1000,   // Honest nodes
            calculateEmission(180),
            60      // Analyze 60 epochs
        );

        const color = analysis.exploitPercent > 10 ? c.red : c.yellow;
        info(`  Alpha = ${alpha}:`);
        info(`    Stabilization time: ${analysis.stabilizationEpochs} epochs`);
        info(`    ${color}Exploit value: ${analysis.exploitPercent.toFixed(1)}% extra rewards${c.reset}`);
    }

    subheader('Sudden Exit Analysis');

    info('  When attacker suddenly exits, honest nodes suffer from smoothing lag.\n');

    // Simulate exit scenario
    for (const alpha of [0.1, 0.2]) {
        let smoothedTotal = 2000 * 0.9; // With attacker
        const honestEff = 1000 * 0.9;
        const dailyEmission = calculateEmission(180);

        let honestLoss = 0;
        let epochs = 0;

        // After attacker leaves
        while (smoothedTotal > honestEff * 1.01 && epochs < 100) {
            const expectedShare = 1.0; // Honest should get all
            const actualShare = honestEff / smoothedTotal;
            honestLoss += dailyEmission * (expectedShare - actualShare);

            smoothedTotal = alpha * honestEff + (1 - alpha) * smoothedTotal;
            epochs++;
        }

        info(`  Alpha = ${alpha}: Honest nodes lose ${honestLoss.toFixed(2)} tokens over ${epochs} epochs`);
    }
}

// ============================================================================
// STRESS TEST 6: Sensitivity Analysis / Attack ROI Heatmap
// ============================================================================

function stressTestSensitivity() {
    header('STRESS TEST 6: Attack ROI Sensitivity Analysis');

    subheader('ROI Heatmap: Token Price vs Node Count');

    const tokenPrices = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0];
    const nodeCounts = [10, 25, 50, 100, 200];
    const networkSize = 1000;
    const baseCost = 100;

    console.log(`\n  ${'Price'.padEnd(8)} | ${nodeCounts.map(n => `${n} nodes`.padStart(10)).join(' | ')}`);
    console.log(`  ${'─'.repeat(8 + nodeCounts.length * 13)}`);

    for (const price of tokenPrices) {
        const row = [`  $${price.toFixed(2).padEnd(6)}`];

        for (const nodes of nodeCounts) {
            const dailyEmission = calculateEmission(180);
            const attackerEff = nodes * 0.9;
            const networkEff = networkSize * 0.8;

            const share = attackerEff / (attackerEff + networkEff);
            const monthlyRevenue = share * dailyEmission * price * 30;

            // Simplified cost model
            const monthlyCost = nodes * baseCost / 12 * (1 + nodes * 0.001);
            const monthlyProfit = monthlyRevenue - monthlyCost;
            const annualProfit = monthlyProfit * 12;

            let cell;
            if (annualProfit > 1000) {
                cell = c.red + `+${(annualProfit / 1000).toFixed(1)}k`.padStart(9) + c.reset;
            } else if (annualProfit > 0) {
                cell = c.yellow + `+${annualProfit.toFixed(0)}`.padStart(9) + c.reset;
            } else {
                cell = c.green + `${annualProfit.toFixed(0)}`.padStart(9) + c.reset;
            }

            row.push(` | ${cell}`);
        }

        console.log(row.join(''));
    }

    subheader('Break-Even Token Prices by Strategy');

    const strategies = ['naive', 'cycling', 'edge'];

    for (const strategy of strategies) {
        const config = ATTACKER_STRATEGIES[strategy];

        // Binary search for break-even price
        let lo = 0.001, hi = 10.0;
        while (hi - lo > 0.001) {
            const mid = (lo + hi) / 2;
            const comparison = compareStrategies(100, 1000, 365, calculateEmission(180) * mid, baseCost);
            if (comparison.strategies[strategy].totalProfit > 0) {
                hi = mid;
            } else {
                lo = mid;
            }
        }

        info(`  ${config.name}: break-even at $${lo.toFixed(3)} token price`);
    }

    subheader('Honest Viability Threshold');

    info('  Minimum token price for each reliability class to be net positive:\n');

    for (const [cls, config] of Object.entries(RELIABILITY_CLASSES)) {
        // Calculate expected effectiveness accounting for failures
        const uptimeFrac = config.dailyUptimeHours.mean / 24;
        const failureImpact = 1 - config.weeklyOutageProb * 0.5;
        const expectedEff = 0.9 * uptimeFrac * failureImpact;

        // Use recalibrated monthly cost from config
        const monthlyCost = config.monthlyTotalUSD || 15; // Fallback if not defined

        // Revenue needed
        const dailyEmission = calculateEmission(365); // Year 1
        const shareOf1000Nodes = expectedEff / (1000 * 0.8);
        const tokensPerMonth = shareOf1000Nodes * dailyEmission * 30;

        const breakEvenPrice = monthlyCost / tokensPerMonth;

        const color = breakEvenPrice < 0.15 ? c.green : breakEvenPrice < 0.5 ? c.yellow : c.red;
        info(`  ${config.name.padEnd(15)}: ${color}$${breakEvenPrice.toFixed(3)}${c.reset} (eff: ${(expectedEff * 100).toFixed(0)}%, cost: $${monthlyCost}/mo)`);
    }
}

// ============================================================================
// MAIN
// ============================================================================

console.log(`\n${c.bold}${c.magenta}╔════════════════════════════════════════════════════════════════════╗${c.reset}`);
console.log(`${c.bold}${c.magenta}║           ANVIL PROTOCOL STRESS TEST SUITE                         ║${c.reset}`);
console.log(`${c.bold}${c.magenta}║           "Add realism until the results get ugly"                 ║${c.reset}`);
console.log(`${c.bold}${c.magenta}╚════════════════════════════════════════════════════════════════════╝${c.reset}`);

stressTestReliability();
stressTestNetworkConstraints();
stressTestVerificationAttacks();
stressTestAttackerStrategies();
stressTestSmoothingExploit();
stressTestSensitivity();

header('STRESS TEST COMPLETE');

console.log(`  ${c.bold}Summary:${c.reset}`);
console.log(`  ─────────────────────────────────────────────────────────`);
console.log(`  These tests surface protocol weaknesses under realistic`);
console.log(`  conditions. Use findings to tune parameters until the`);
console.log(`  results are "ugly but acceptable."`);
console.log(`\n  ${c.yellow}Remember: The model is a hypothesis generator, not truth.${c.reset}\n`);
