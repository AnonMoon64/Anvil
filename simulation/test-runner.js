/**
 * Anvil Protocol Test Runner
 * Comprehensive unit tests for all protocol mechanics
 */

import * as effectiveness from './core/effectiveness.js';
import * as emission from './core/emission.js';
import * as rewards from './core/rewards.js';
import * as sybil from './core/sybil.js';
import { Node, NodeFactory } from './core/node.js';
import Network from './core/network.js';
import CONFIG from './config.js';

// Test framework
let testsPassed = 0;
let testsFailed = 0;
let currentSuite = '';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bright: '\x1b[1m',
};

function suite(name) {
    currentSuite = name;
    console.log(`\n${colors.cyan}▶ ${name}${colors.reset}`);
}

function test(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ${colors.green}✓${colors.reset} ${name}`);
    } catch (e) {
        testsFailed++;
        console.log(`  ${colors.red}✗${colors.reset} ${name}`);
        console.log(`    ${colors.red}${e.message}${colors.reset}`);
    }
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        throw new Error(message);
    }
}

function assertApprox(actual, expected, tolerance = 0.01, message = '') {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
        throw new Error(
            `${message}: Expected ~${expected}, got ${actual} (diff: ${diff}, tolerance: ${tolerance})`
        );
    }
}

function assertRange(value, min, max, message = '') {
    if (value < min || value > max) {
        throw new Error(`${message}: Expected ${value} to be in range [${min}, ${max}]`);
    }
}

// ============================================================================
// EFFECTIVENESS TESTS
// ============================================================================

suite('Effectiveness Ramp-Up');

test('effectiveness starts at 0', () => {
    const eff = effectiveness.calculateRamp(0);
    assertApprox(eff, 0, 0.001, 'Initial effectiveness');
});

test('effectiveness approaches 1 asymptotically', () => {
    const eff = effectiveness.calculateRamp(1000);
    assertRange(eff, 0.99, 1, 'Long-term effectiveness');
});

test('~63% effectiveness at R days', () => {
    const R = CONFIG.effectiveness.rampTimeConstant;
    const eff = effectiveness.calculateRamp(R);
    // At t=R, Eff = 1 - exp(-1) ≈ 0.632
    assertApprox(eff, 0.632, 0.01, 'Effectiveness at R');
});

test('~95% effectiveness at 3R days', () => {
    const R = CONFIG.effectiveness.rampTimeConstant;
    const eff = effectiveness.calculateRamp(3 * R);
    assertApprox(eff, 0.95, 0.01, 'Effectiveness at 3R');
});

test('daysToReachEffectiveness calculates correctly', () => {
    const target = 0.5;
    const days = effectiveness.daysToReachEffectiveness(target);
    const actualEff = effectiveness.calculateRamp(days);
    assertApprox(actualEff, target, 0.001, 'Calculated effectiveness');
});

// ============================================================================
// DECAY TESTS
// ============================================================================

suite('Effectiveness Decay');

test('no decay during grace period', () => {
    const startEff = 0.9;
    const graceDays = CONFIG.effectiveness.decayGracePeriodDays;
    const eff = effectiveness.calculateDecay(startEff, graceDays);
    assertApprox(eff, startEff, 0.001, 'Effectiveness during grace');
});

test('step penalty applied after grace period', () => {
    const startEff = 1.0;
    const graceDays = CONFIG.effectiveness.decayGracePeriodDays;
    const stepPenalty = CONFIG.effectiveness.decayStepPenalty;
    const eff = effectiveness.calculateDecay(startEff, graceDays + 0.1);
    assertApprox(eff, startEff * (1 - stepPenalty), 0.05, 'Effectiveness after step penalty');
});

test('decay is faster than ramp (asymmetric)', () => {
    const daysToRamp = effectiveness.daysToReachEffectiveness(0.95);
    const daysToDecay = effectiveness.daysUntilDecayThreshold(1.0, 0.05);
    assert(daysToRamp > daysToDecay * 3, 'Ramp should be much slower than decay');
});

test('effectiveness resets to 0 below threshold', () => {
    const eff = effectiveness.calculateDecay(1.0, 30);
    assertApprox(eff, 0, 0.01, 'Long decay should reset');
});

// ============================================================================
// EMISSION TESTS
// ============================================================================

suite('Emission Schedule');

test('initial emission equals initial rate', () => {
    const initialEmission = emission.calculateEmission(0);
    assertApprox(initialEmission, CONFIG.emission.initialRate, 0.001, 'Initial emission');
});

test('emission decays over time', () => {
    const early = emission.calculateEmission(100);
    const late = emission.calculateEmission(1000);
    assert(early > late, 'Emission should decrease over time');
});

test('total emitted approaches max supply', () => {
    const maxSupply = emission.calculateMaxSupply();
    const totalAt10Years = emission.calculateTotalEmitted(365 * 10);
    assertRange(totalAt10Years / maxSupply, 0.9, 1, 'Should approach max supply');
});

test('remaining supply decreases over time', () => {
    const remaining1 = emission.calculateRemainingSupply(100);
    const remaining2 = emission.calculateRemainingSupply(1000);
    assert(remaining1 > remaining2, 'Remaining supply should decrease');
});

test('max supply equals Em0 * τ', () => {
    const maxSupply = emission.calculateMaxSupply();
    const expected = CONFIG.emission.initialRate * CONFIG.emission.decayTimeConstant;
    assertApprox(maxSupply, expected, 0.001, 'Max supply formula');
});

test('50% emitted at ~τ*ln(2) days', () => {
    const daysTo50 = emission.daysToEmitPercent(50);
    const expected = CONFIG.emission.decayTimeConstant * Math.log(2);
    assertApprox(daysTo50, expected, 1, 'Days to 50% emission');
});

// ============================================================================
// REWARD TESTS
// ============================================================================

suite('Reward Distribution');

test('rewards sum to epoch emission', () => {
    const epochEmission = 100;
    const nodes = [
        { id: 'a', effectiveness: 0.5 },
        { id: 'b', effectiveness: 0.3 },
        { id: 'c', effectiveness: 0.2 },
    ];
    const totalEff = 1.0;

    let totalReward = 0;
    for (const node of nodes) {
        totalReward += rewards.calculateNodeReward(node.effectiveness, totalEff, epochEmission);
    }

    assertApprox(totalReward, epochEmission, 0.001, 'Total rewards');
});

test('reward proportional to effectiveness', () => {
    const epochEmission = 100;
    const totalEff = 1.0;
    const reward1 = rewards.calculateNodeReward(0.5, totalEff, epochEmission);
    const reward2 = rewards.calculateNodeReward(0.25, totalEff, epochEmission);

    assertApprox(reward1 / reward2, 2, 0.001, 'Reward ratio');
});

test('Gini coefficient is 0 for equal distribution', () => {
    const values = [100, 100, 100, 100, 100];
    const gini = rewards.calculateGini(values);
    assertApprox(gini, 0, 0.001, 'Gini for equal');
});

test('Gini coefficient approaches 1 for unequal distribution', () => {
    const values = [0, 0, 0, 0, 100];
    const gini = rewards.calculateGini(values);
    assertRange(gini, 0.7, 1, 'Gini for unequal');
});

test('SmoothedEffectiveness smooths changes', () => {
    const smoother = new rewards.SmoothedEffectiveness();

    // Initial value
    smoother.update(100);

    // Sudden spike
    const smoothed = smoother.update(200);

    // Should be between 100 and 200
    assertRange(smoothed, 100, 200, 'Smoothed value');
    assert(smoothed < 150, 'Should dampen sudden changes');
});

// ============================================================================
// SYBIL COST TESTS
// ============================================================================

suite('Sybil Attack Economics');

test('cost per node increases with scale (superlinear)', () => {
    const cost10 = sybil.calculateMonthlyCost(10);
    const cost100 = sybil.calculateMonthlyCost(100);

    // Per-node cost should increase at scale
    assert(cost100.perNode > cost10.perNode, 'Per-node cost should increase with scale');
});

test('failure rate increases with scale', () => {
    const failures10 = sybil.calculateDailyFailures(10);
    const failures100 = sybil.calculateDailyFailures(100);

    // Per-node failure rate should increase
    assert(failures100 / 100 > failures10 / 10, 'Per-node failure rate should increase');
});

test('effective average effectiveness decreases with scale', () => {
    const eff10 = sybil.calculateEffectiveAverageEffectiveness(10, 0.9, 365);
    const eff100 = sybil.calculateEffectiveAverageEffectiveness(100, 0.9, 365);

    assert(eff100.averageEffectivenessPerNode < eff10.averageEffectivenessPerNode,
        'Average effectiveness should decrease at scale');
});

test('ROI analysis includes all cost components', () => {
    const analysis = sybil.analyzeSybilROI(10, 110, 0.1, 100);

    assert(analysis.dailyTokensEarned > 0, 'Should earn tokens');
    assert(analysis.monthlyCost > 0, 'Should have costs');
    assert(analysis.breakEvenTokenPrice > 0, 'Should calculate break-even');
});

// ============================================================================
// NODE TESTS
// ============================================================================

suite('Node Behavior');

test('new node starts with 0 effectiveness', () => {
    const node = new Node('test', 0);
    assertApprox(node.getEffectiveness(), 0, 0.001, 'Initial effectiveness');
});

test('node builds effectiveness over time', () => {
    const node = new Node('test', 0);

    for (let day = 1; day <= 100; day++) {
        node.tick(day);
    }

    assert(node.getEffectiveness() > 0.5, 'Should have significant effectiveness after 100 days');
});

test('node decays when offline', () => {
    const node = new Node('test', 0);

    // Build up effectiveness
    for (let day = 1; day <= 100; day++) {
        node.tick(day);
    }

    const beforeOffline = node.getEffectiveness();
    node.goOffline();

    // Decay for 10 days
    for (let day = 101; day <= 110; day++) {
        node.tick(day);
    }

    assert(node.getEffectiveness() < beforeOffline, 'Should decay when offline');
});

test('node accumulates rewards', () => {
    const node = new Node('test', 0);
    node.addReward(100);
    node.addReward(50);

    assertApprox(node.totalRewards, 150, 0.001, 'Total rewards');
});

test('NodeFactory creates different types', () => {
    NodeFactory.reset();

    const honest = NodeFactory.createHonest();
    const intermittent = NodeFactory.createIntermittent(0, 80);
    const attacker = NodeFactory.createAttacker();

    assert(honest.type === 'honest', 'Honest type');
    assert(intermittent.type === 'intermittent', 'Intermittent type');
    assert(attacker.type === 'attacker', 'Attacker type');
});

// ============================================================================
// NETWORK TESTS
// ============================================================================

suite('Network Simulation');

test('network tracks nodes correctly', () => {
    const network = new Network();
    network.addNode(NodeFactory.createHonest());
    network.addNode(NodeFactory.createHonest());

    assertApprox(network.nodes.size, 2, 0, 'Node count');

    network.reset();
});

test('network distributes rewards', () => {
    const network = new Network();

    for (let i = 0; i < 5; i++) {
        network.addNode(NodeFactory.createHonest(0));
    }

    network.simulate(30);

    const stats = network.getStats();
    assert(stats.totalRewardsDistributed > 0, 'Should distribute rewards');

    network.reset();
});

test('network calculates Gini coefficient', () => {
    const network = new Network();

    // Add nodes with different join times
    for (let i = 0; i < 10; i++) {
        network.addNode(NodeFactory.createHonest(i * 10));
    }

    network.simulate(100);

    const stats = network.getStats();
    assertRange(stats.rewardGini, 0, 1, 'Gini should be in range');

    network.reset();
});

test('late joiners get proportionally less rewards', () => {
    const network = new Network();

    const early = NodeFactory.createHonest(0);
    const late = NodeFactory.createHonest(50);

    network.addNode(early);
    network.addNode(late);

    network.simulate(100);

    assert(early.totalRewards > late.totalRewards, 'Early joiner should have more rewards');

    network.reset();
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

suite('Integration Tests');

test('full simulation runs without errors', () => {
    const network = new Network();

    // Mix of node types
    for (let i = 0; i < 20; i++) {
        network.addNode(NodeFactory.createHonest(Math.random() * 30));
    }
    for (let i = 0; i < 5; i++) {
        network.addNode(NodeFactory.createIntermittent(0, 70));
    }
    for (let i = 0; i < 5; i++) {
        network.addNode(NodeFactory.createAttacker(30));
    }

    // Run for simulated year
    const results = network.simulate(365);

    assert(results.length === 365, 'Should have 365 days of results');
    assert(network.getStats().totalNodes === 30, 'Should have 30 nodes');

    network.reset();
});

test('reward distribution is proportional to effectiveness', () => {
    const network = new Network();

    const earlyNode = NodeFactory.createHonest(0);
    const lateNode = NodeFactory.createHonest(60);

    network.addNode(earlyNode);
    network.addNode(lateNode);

    network.simulate(90);

    // Early node should have significantly more rewards after 90 days
    // The ratio can be high due to ramp-up advantage
    const ratio = earlyNode.totalRewards / lateNode.totalRewards;
    assertRange(ratio, 1.5, 20, 'Early node should have significantly more rewards');

    network.reset();
});

test('effectiveness smoothing reduces reward volatility', () => {
    const network = new Network();

    // Start with 10 nodes
    for (let i = 0; i < 10; i++) {
        network.addNode(NodeFactory.createHonest(0));
    }

    // Run for 50 days
    network.simulate(50);

    // Add 10 more nodes suddenly
    for (let i = 0; i < 10; i++) {
        network.addNode(NodeFactory.createHonest(50));
    }

    // Run for 10 more days and check smoothing
    const results = network.simulate(10);

    // Smoothed total should not equal raw total
    const lastResult = results[results.length - 1];
    assert(lastResult.smoothedEffectiveness !== lastResult.totalEffectiveness,
        'Smoothing should be applied');

    network.reset();
});

// ============================================================================
// RESULTS
// ============================================================================

console.log('\n' + '═'.repeat(50));
console.log(`${colors.bright}TEST RESULTS${colors.reset}`);
console.log('═'.repeat(50));
console.log(`  ${colors.green}Passed: ${testsPassed}${colors.reset}`);
console.log(`  ${colors.red}Failed: ${testsFailed}${colors.reset}`);
console.log(`  Total: ${testsPassed + testsFailed}`);
console.log('═'.repeat(50));

if (testsFailed > 0) {
    console.log(`\n${colors.red}Some tests failed!${colors.reset}\n`);
    process.exit(1);
} else {
    console.log(`\n${colors.green}All tests passed!${colors.reset}\n`);
    process.exit(0);
}
