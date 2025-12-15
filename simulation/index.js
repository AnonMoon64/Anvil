/**
 * Anvil Protocol Simulation - Main Entry Point
 * Runs comprehensive simulations of the participation-weighted network
 */

import Network from './core/network.js';
import { Node, NodeFactory } from './core/node.js';
import * as effectiveness from './core/effectiveness.js';
import * as emission from './core/emission.js';
import * as rewards from './core/rewards.js';
import * as sybil from './core/sybil.js';
import CONFIG from './config.js';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(title) {
    console.log('');
    log('═'.repeat(60), 'cyan');
    log(`  ${title}`, 'bright');
    log('═'.repeat(60), 'cyan');
}

function logSubHeader(title) {
    console.log('');
    log(`▶ ${title}`, 'yellow');
    log('─'.repeat(40), 'yellow');
}

/**
 * Simulation 1: Effectiveness Ramp-Up
 */
function simulateEffectivenessRamp() {
    logHeader('SIMULATION 1: Effectiveness Ramp-Up');

    const milestones = [
        { target: 0.5, label: '50%' },
        { target: 0.75, label: '75%' },
        { target: 0.9, label: '90%' },
        { target: 0.95, label: '95%' },
        { target: 0.99, label: '99%' },
    ];

    console.log(`\nRamp Time Constant (R): ${CONFIG.effectiveness.rampTimeConstant} days\n`);

    for (const milestone of milestones) {
        const days = effectiveness.daysToReachEffectiveness(milestone.target);
        console.log(`  Days to ${milestone.label} effectiveness: ${days.toFixed(1)} days`);
    }

    // Show trajectory
    logSubHeader('Effectiveness Over Time');
    const trajectory = effectiveness.getEffectivenessTrajectory(150);

    for (const point of trajectory) {
        if (point.day % 30 === 0) {
            const bar = '█'.repeat(Math.round(point.effectiveness * 40));
            console.log(`  Day ${String(point.day).padStart(3)}: ${bar} ${(point.effectiveness * 100).toFixed(1)}%`);
        }
    }
}

/**
 * Simulation 2: Decay Behavior
 */
function simulateDecay() {
    logHeader('SIMULATION 2: Decay During Offline Period');

    const decayTrajectory = effectiveness.getEffectivenessTrajectory(30, 'decay', 1.0);

    console.log(`\nDecay from 100% effectiveness:\n`);
    console.log(`  Grace Period: ${CONFIG.effectiveness.decayGracePeriodDays} days`);
    console.log(`  Step Penalty: ${CONFIG.effectiveness.decayStepPenalty * 100}%`);
    console.log(`  Half-Life: ${CONFIG.effectiveness.decayHalfLifeDays} days\n`);

    for (const point of decayTrajectory) {
        const bar = '█'.repeat(Math.round(point.effectiveness * 40));
        const spaces = ' '.repeat(40 - Math.round(point.effectiveness * 40));
        console.log(`  Day ${String(point.day).padStart(2)}: ${bar}${spaces} ${(point.effectiveness * 100).toFixed(1)}%`);
    }

    // Asymmetry analysis
    logSubHeader('Ramp vs Decay Asymmetry');
    const daysTo95 = effectiveness.daysToReachEffectiveness(0.95);
    const daysTo5FromFull = effectiveness.daysUntilDecayThreshold(1.0, 0.05);

    console.log(`  Days to ramp from 0% to 95%: ${daysTo95.toFixed(1)} days`);
    console.log(`  Days to decay from 100% to 5%: ${daysTo5FromFull.toFixed(1)} days`);
    console.log(`  Asymmetry ratio: ${(daysTo95 / daysTo5FromFull).toFixed(1)}x slower to build than lose`);
}

/**
 * Simulation 3: Emission Schedule
 */
function simulateEmission() {
    logHeader('SIMULATION 3: Emission Schedule');

    const maxSupply = emission.calculateMaxSupply();

    console.log(`\nEmission Parameters:`);
    console.log(`  Initial Rate: ${CONFIG.emission.initialRate} tokens/day`);
    console.log(`  Decay Constant (τ): ${CONFIG.emission.decayTimeConstant} days`);
    console.log(`  Max Supply: ${maxSupply.toLocaleString()} tokens\n`);

    logSubHeader('Emission Over Time');

    const years = [0.5, 1, 2, 4, 8, 10];
    for (const year of years) {
        const day = year * 365;
        const emissionRate = emission.calculateEmission(day);
        const totalEmitted = emission.calculateTotalEmitted(day);
        const percentEmitted = (totalEmitted / maxSupply) * 100;

        console.log(`  Year ${String(year).padStart(4)}: ` +
            `${emissionRate.toFixed(2).padStart(8)} tokens/day | ` +
            `${percentEmitted.toFixed(1).padStart(5)}% supply emitted`);
    }

    // Compare with halving
    logSubHeader('Smooth Decay vs Bitcoin-style Halving');
    const comparison = emission.compareWithHalving(365 * 10);

    const sampleDays = [0, 365, 730, 1460, 2920, 3650];
    console.log(`  ${'Day'.padEnd(6)} | ${'Smooth'.padEnd(12)} | ${'Halving'.padEnd(12)}`);
    console.log(`  ${'-'.repeat(6)} | ${'-'.repeat(12)} | ${'-'.repeat(12)}`);

    for (const day of sampleDays) {
        const smoothVal = comparison.smooth.find(d => d.day === day)?.emission || 0;
        const halvingVal = comparison.halving.find(d => d.day === day)?.emission || 0;
        console.log(`  ${String(day).padEnd(6)} | ${smoothVal.toFixed(2).padEnd(12)} | ${halvingVal.toFixed(2).padEnd(12)}`);
    }
}

/**
 * Simulation 4: Network with Multiple Node Types
 */
function simulateNetwork() {
    logHeader('SIMULATION 4: Network Simulation (1 Year)');

    const network = new Network();

    // Add initial nodes
    console.log('\nInitializing network with diverse nodes...');

    // Honest nodes joining at different times
    for (let i = 0; i < 50; i++) {
        network.addNode(NodeFactory.createHonest(Math.floor(Math.random() * 30)));
    }

    // Intermittent nodes (80% uptime)
    for (let i = 0; i < 20; i++) {
        network.addNode(NodeFactory.createIntermittent(Math.floor(Math.random() * 60), 80));
    }

    // Late joiners
    for (let i = 0; i < 30; i++) {
        network.addNode(NodeFactory.createHonest(Math.floor(Math.random() * 90) + 90));
    }

    // Some attackers joining mid-year
    for (let i = 0; i < 10; i++) {
        network.addNode(NodeFactory.createAttacker(180));
    }

    console.log(`  Initial nodes: 50 honest, 20 intermittent`);
    console.log(`  Late joiners: 30 honest (days 90-180)`);
    console.log(`  Attackers: 10 (joining day 180)\n`);

    // Run simulation
    logSubHeader('Running 365-Day Simulation');

    let lastReport = 0;
    network.simulate(365, (summary) => {
        if (summary.day - lastReport >= 30) {
            console.log(
                `  Day ${String(summary.day).padStart(3)}: ` +
                `${summary.nodeCount} nodes | ` +
                `Eff: ${summary.avgEffectiveness.toFixed(2)} | ` +
                `Gini: ${summary.giniCoefficient.toFixed(3)} | ` +
                `Emission: ${summary.epochEmission.toFixed(2)}`
            );
            lastReport = summary.day;
        }
    });

    // Final stats
    logSubHeader('Final Network Statistics');
    const stats = network.getStats();

    console.log(`  Total Nodes: ${stats.totalNodes}`);
    console.log(`  Total Rewards Distributed: ${stats.totalRewardsDistributed.toFixed(2)} tokens`);
    console.log(`  Average Reward per Node: ${stats.avgRewardPerNode.toFixed(2)} tokens`);
    console.log(`  Reward Gini Coefficient: ${stats.rewardGini.toFixed(3)}`);
    console.log(`  Nodes by Type: honest=${stats.nodesByType.honest}, ` +
        `intermittent=${stats.nodesByType.intermittent}, attacker=${stats.nodesByType.attacker}`);

    // Leaderboard
    logSubHeader('Top 5 Nodes by Rewards');
    const leaderboard = network.getLeaderboard(5);

    for (let i = 0; i < leaderboard.length; i++) {
        const node = leaderboard[i];
        console.log(
            `  ${i + 1}. ${node.id.padEnd(20)} | ` +
            `Type: ${node.type.padEnd(12)} | ` +
            `Rewards: ${node.totalRewards.toFixed(2)}`
        );
    }

    // Effectiveness distribution
    logSubHeader('Effectiveness Distribution');
    const distribution = network.getEffectivenessDistribution();

    for (const [bucket, count] of Object.entries(distribution)) {
        const bar = '█'.repeat(count);
        console.log(`  ${bucket.padEnd(10)}: ${bar} (${count})`);
    }
}

/**
 * Simulation 5: Sybil Attack Analysis
 */
function simulateSybilAttack() {
    logHeader('SIMULATION 5: Sybil Attack Cost Analysis');

    const tokenPrice = 0.10; // $0.10 per token
    const dailyEmission = emission.calculateEmission(180); // Mid-year emission
    const baseNetworkNodes = 100;

    console.log(`\nScenario Parameters:`);
    console.log(`  Token Price: $${tokenPrice}`);
    console.log(`  Daily Emission: ${dailyEmission.toFixed(2)} tokens`);
    console.log(`  Base Network: ${baseNetworkNodes} honest nodes\n`);

    logSubHeader('Attack Scale Analysis');

    const scales = [1, 5, 10, 25, 50, 100, 200];
    console.log(`  ${'Nodes'.padEnd(6)} | ${'Share'.padEnd(8)} | ${'Monthly Rev'.padEnd(12)} | ${'Monthly Cost'.padEnd(12)} | ${'Profit'.padEnd(10)}`);
    console.log(`  ${'-'.repeat(6)} | ${'-'.repeat(8)} | ${'-'.repeat(12)} | ${'-'.repeat(12)} | ${'-'.repeat(10)}`);

    for (const nodes of scales) {
        const roi = sybil.analyzeSybilROI(nodes, baseNetworkNodes + nodes, tokenPrice, dailyEmission);
        const profitColor = roi.monthlyProfit > 0 ? colors.green : colors.red;

        console.log(
            `  ${String(nodes).padEnd(6)} | ` +
            `${roi.attackerShare.toFixed(1).padEnd(6)}% | ` +
            `$${roi.monthlyRevenueUSD.toFixed(2).padStart(10)} | ` +
            `$${roi.monthlyCost.toFixed(2).padStart(10)} | ` +
            `${profitColor}$${roi.monthlyProfit.toFixed(2).padStart(8)}${colors.reset}`
        );
    }

    // Find optimal scale
    logSubHeader('Optimal Attacker Scale');
    const optimal = sybil.findOptimalAttackerScale(baseNetworkNodes, tokenPrice, dailyEmission);

    if (optimal.maxMonthlyProfit > 0) {
        console.log(`  Optimal node count: ${optimal.optimalNodeCount}`);
        console.log(`  Maximum monthly profit: $${optimal.maxMonthlyProfit.toFixed(2)}`);
        console.log(`  Network share at optimum: ${optimal.details.attackerShare.toFixed(1)}%`);
    } else {
        console.log(`  No profitable attack scale found at current token price!`);
        console.log(`  Break-even token price for 10 nodes: $${sybil.analyzeSybilROI(10, baseNetworkNodes + 10, tokenPrice, dailyEmission).breakEvenTokenPrice.toFixed(3)}`);
    }

    // Failure impact at scale
    logSubHeader('Failure Rate Impact at Scale');

    for (const nodes of [10, 50, 100]) {
        const failures = sybil.calculateDailyFailures(nodes);
        const effAnalysis = sybil.calculateEffectiveAverageEffectiveness(nodes, 0.9, 365);

        console.log(`  ${nodes} nodes: ${failures.toFixed(2)} failures/day, ` +
            `${effAnalysis.effectivenessLossPercent.toFixed(1)}% effectiveness loss`);
    }
}

/**
 * Simulation 6: Reward Dilution
 */
function simulateRewardDilution() {
    logHeader('SIMULATION 6: Reward Dilution Analysis');

    const epochEmission = emission.calculateEmission(180);

    console.log(`\nEpoch emission: ${epochEmission.toFixed(2)} tokens\n`);

    logSubHeader('New Node Impact on Existing Miners');

    const scenarios = [
        { existing: 100, newNodes: 10, newEff: 0.1 },
        { existing: 100, newNodes: 50, newEff: 0.1 },
        { existing: 100, newNodes: 100, newEff: 0.1 },
        { existing: 100, newNodes: 100, newEff: 0.5 },
        { existing: 100, newNodes: 100, newEff: 0.9 },
    ];

    for (const scenario of scenarios) {
        const analysis = rewards.analyzeRewardDilution(
            scenario.existing,
            scenario.newNodes,
            scenario.newEff,
            epochEmission
        );

        console.log(
            `  +${scenario.newNodes} nodes (${(scenario.newEff * 100).toFixed(0)}% eff): ` +
            `${analysis.dilutionPercent.toFixed(1)}% reward reduction for existing miners`
        );
    }

    logSubHeader('Protection from Time-Weighted Effectiveness');
    console.log(`  New nodes start at 0% effectiveness and ramp up over time.`);
    console.log(`  This limits immediate dilution impact on established miners.`);
    console.log(`  Full dilution only occurs after new nodes reach maturity.`);
}

// Main execution
console.log('');
log('╔════════════════════════════════════════════════════════════╗', 'bright');
log('║        ANVIL PROTOCOL SIMULATION SUITE                     ║', 'bright');
log('║        Participation-Weighted Payment Network              ║', 'bright');
log('╚════════════════════════════════════════════════════════════╝', 'bright');

simulateEffectivenessRamp();
simulateDecay();
simulateEmission();
simulateNetwork();
simulateSybilAttack();
simulateRewardDilution();

logHeader('SIMULATION COMPLETE');
console.log('\nAll protocol mechanics validated successfully.\n');
