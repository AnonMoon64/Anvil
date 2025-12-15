/**
 * Load-Responsive Security Module
 * Dynamically adjusts security parameters based on network observables
 */

import { calculateEmission } from './core/emission.js';
import { RELIABILITY_CLASSES } from './core/reliability.js';

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
 * Observable metrics that drive security adjustments
 * (No price oracles - only on-chain data)
 */
class NetworkObservables {
    constructor() {
        // Smoothed metrics
        this.totalEffectiveness = 1000;      // ΣEff
        this.txThroughput = 100;             // tx/epoch
        this.mempoolPressure = 0.1;          // 0-1 congestion
        this.challengeBacklog = 0;           // pending challenges
        this.avgResponseLatency = 100;       // ms
        this.relaySubmissionVolume = 500;    // submissions/epoch

        // Thresholds
        this.thresholds = {
            lowActivity: { eff: 500, tx: 50 },
            normalActivity: { eff: 1000, tx: 100 },
            highActivity: { eff: 2000, tx: 200 },
            criticalActivity: { eff: 5000, tx: 500 },
        };
    }

    /**
     * Update observables based on network state
     */
    update(state) {
        const alpha = 0.1; // EMA smoothing

        if (state.totalEffectiveness !== undefined) {
            this.totalEffectiveness = alpha * state.totalEffectiveness + (1 - alpha) * this.totalEffectiveness;
        }
        if (state.txThroughput !== undefined) {
            this.txThroughput = alpha * state.txThroughput + (1 - alpha) * this.txThroughput;
        }
        if (state.mempoolPressure !== undefined) {
            this.mempoolPressure = alpha * state.mempoolPressure + (1 - alpha) * this.mempoolPressure;
        }
        if (state.challengeBacklog !== undefined) {
            this.challengeBacklog = alpha * state.challengeBacklog + (1 - alpha) * this.challengeBacklog;
        }
        if (state.avgResponseLatency !== undefined) {
            this.avgResponseLatency = alpha * state.avgResponseLatency + (1 - alpha) * this.avgResponseLatency;
        }
        if (state.relaySubmissionVolume !== undefined) {
            this.relaySubmissionVolume = alpha * state.relaySubmissionVolume + (1 - alpha) * this.relaySubmissionVolume;
        }
    }

    /**
     * Compute activity level (0 = low, 1 = normal, 2 = high, 3 = critical)
     */
    getActivityLevel() {
        const t = this.thresholds;
        const eff = this.totalEffectiveness;
        const tx = this.txThroughput;

        if (eff >= t.criticalActivity.eff || tx >= t.criticalActivity.tx) return 3;
        if (eff >= t.highActivity.eff || tx >= t.highActivity.tx) return 2;
        if (eff >= t.normalActivity.eff || tx >= t.normalActivity.tx) return 1;
        return 0;
    }

    /**
     * Compute stress indicator (0-1)
     * Based on mempool pressure, backlog, and latency
     */
    getStressLevel() {
        const mempoolStress = this.mempoolPressure;
        const backlogStress = Math.min(1, this.challengeBacklog / 100);
        const latencyStress = Math.min(1, (this.avgResponseLatency - 50) / 450); // 50-500ms range

        return (mempoolStress * 0.4 + backlogStress * 0.3 + latencyStress * 0.3);
    }
}

/**
 * Dynamic security parameters
 */
class DynamicSecurity {
    constructor() {
        this.observables = new NetworkObservables();

        // Base parameters
        this.baseParams = {
            burstAuditProbability: 0.05,
            sampleProbability: 0.10,
            workDifficulty: 1.0,
            clawbackWindow: 14,
            banDuration: 30,
        };

        // Scaling factors per activity level
        this.scalingFactors = {
            0: { audit: 0.5, sample: 0.8, difficulty: 0.8, clawback: 0.7, ban: 0.5 },  // Low
            1: { audit: 1.0, sample: 1.0, difficulty: 1.0, clawback: 1.0, ban: 1.0 },  // Normal
            2: { audit: 1.5, sample: 1.3, difficulty: 1.2, clawback: 1.3, ban: 1.5 },  // High
            3: { audit: 2.5, sample: 1.8, difficulty: 1.5, clawback: 1.5, ban: 2.0 },  // Critical
        };
    }

    /**
     * Get current security parameters based on observables
     */
    getCurrentParams() {
        const level = this.observables.getActivityLevel();
        const stress = this.observables.getStressLevel();
        const scale = this.scalingFactors[level];

        // Stress adds additional tightening
        const stressMultiplier = 1 + stress * 0.5;

        return {
            burstAuditProbability: Math.min(0.25, this.baseParams.burstAuditProbability * scale.audit * stressMultiplier),
            sampleProbability: Math.min(0.40, this.baseParams.sampleProbability * scale.sample * stressMultiplier),
            workDifficulty: this.baseParams.workDifficulty * scale.difficulty,
            clawbackWindow: Math.round(this.baseParams.clawbackWindow * scale.clawback),
            banDuration: Math.round(this.baseParams.banDuration * scale.ban),
            activityLevel: level,
            stressLevel: stress,
        };
    }

    /**
     * Update observables and return new params
     */
    updateAndGetParams(networkState) {
        this.observables.update(networkState);
        return this.getCurrentParams();
    }
}

/**
 * Simulate network with load-responsive security
 */
function simulateLoadResponsiveSecurity(scenario) {
    const {
        epochs = 365,
        baseHonestNodes = 1000,
        attackerNodes = 100,
        attackStartEpoch = 90,
        attackEndEpoch = 180,
        tokenPrice = 0.25,
    } = scenario;

    const security = new DynamicSecurity();
    const history = [];

    // Track attacker and honest node performance
    let attackerRewards = 0;
    let attackerCosts = 0;
    let honestRewards = 0;
    let attackerDetections = 0;
    let honestFalsePositives = 0;

    const baseCostPerNode = RELIABILITY_CLASSES.hobbyist.monthlyTotalUSD / 30;

    for (let epoch = 0; epoch < epochs; epoch++) {
        // Determine current network state
        const attackActive = epoch >= attackStartEpoch && epoch < attackEndEpoch;
        const currentAttackerNodes = attackActive ? attackerNodes : 0;
        const totalNodes = baseHonestNodes + currentAttackerNodes;

        // Simulate network observables
        const networkState = {
            totalEffectiveness: totalNodes * 0.85,
            txThroughput: 100 + (attackActive ? 50 : 0), // Attackers add tx load
            mempoolPressure: attackActive ? 0.4 : 0.1,
            challengeBacklog: attackActive ? 20 : 2,
            avgResponseLatency: attackActive ? 200 : 80,
            relaySubmissionVolume: totalNodes * 0.5,
        };

        // Get dynamic security params
        const params = security.updateAndGetParams(networkState);

        // Simulate epoch outcomes
        const dailyEmission = calculateEmission(epoch);
        const totalEffective = networkState.totalEffectiveness;

        // Attacker rewards/costs (if active)
        if (attackActive) {
            const attackerEff = attackerNodes * 0.85;
            const attackerShare = attackerEff / totalEffective;
            const attackerEpochReward = dailyEmission * attackerShare * tokenPrice;

            // Higher sampling = higher detection
            const detectionThisEpoch = Math.random() < params.sampleProbability * 0.5; // 50% if sampled
            if (detectionThisEpoch) {
                attackerDetections++;
                attackerRewards -= params.clawbackWindow * (dailyEmission * attackerShare * tokenPrice);
            } else {
                attackerRewards += attackerEpochReward;
            }

            attackerCosts += attackerNodes * baseCostPerNode * params.workDifficulty;
        }

        // Honest node rewards
        const honestEff = baseHonestNodes * 0.85;
        const honestShare = honestEff / totalEffective;
        const honestEpochReward = dailyEmission * honestShare * tokenPrice;

        // False positive risk (honest nodes wrongly penalized)
        // Higher sampling = slightly higher false positive risk
        const falsePositiveRate = 0.001 * params.sampleProbability / 0.10;
        if (Math.random() < falsePositiveRate) {
            honestFalsePositives++;
            honestRewards -= params.clawbackWindow * 0.1 * tokenPrice; // Small penalty
        }

        honestRewards += honestEpochReward;

        // Record
        history.push({
            epoch,
            ...params,
            attackActive,
            attackerNodes: currentAttackerNodes,
            totalNodes,
        });
    }

    // Compute attack profitability
    const attackerProfit = attackerRewards - attackerCosts;
    const attackDuration = attackEndEpoch - attackStartEpoch;

    return {
        scenario: `${attackerNodes} attackers vs ${baseHonestNodes} honest`,
        attackDuration,
        attackerProfit,
        attackerDetections,
        honestRewards,
        honestFalsePositives,
        isProfitable: attackerProfit > 0,
        avgSecurityLevel: history.filter(h => h.attackActive).reduce((s, h) => s + h.activityLevel, 0) / attackDuration,
        avgSampleRate: history.filter(h => h.attackActive).reduce((s, h) => s + h.sampleProbability, 0) / attackDuration,
        history,
    };
}

/**
 * Main analysis
 */
function runLoadResponsiveAnalysis() {
    console.log(`\n${c.cyan}${'═'.repeat(70)}${c.reset}`);
    console.log(`${c.bold}  LOAD-RESPONSIVE SECURITY ANALYSIS${c.reset}`);
    console.log(`${c.cyan}${'═'.repeat(70)}${c.reset}\n`);

    console.log('  Testing dynamic security that scales with network observables...\n');

    // Test scenarios
    const scenarios = [
        { attackerNodes: 50, tokenPrice: 0.15, label: 'Small attack, low price' },
        { attackerNodes: 100, tokenPrice: 0.25, label: 'Medium attack, medium price' },
        { attackerNodes: 500, tokenPrice: 0.25, label: 'Large attack, medium price' },
        { attackerNodes: 100, tokenPrice: 0.50, label: 'Medium attack, high price' },
        { attackerNodes: 500, tokenPrice: 0.50, label: 'Large attack, high price' },
    ];

    console.log(`  ${'Scenario'.padEnd(35)} | ${'Profit'.padStart(12)} | ${'Detect'.padStart(8)} | ${'Avg Sample'.padStart(12)} | Result`);
    console.log(`  ${'─'.repeat(80)}`);

    for (const s of scenarios) {
        const result = simulateLoadResponsiveSecurity(s);
        const color = result.isProfitable ? c.red : c.green;

        console.log(
            `  ${s.label.padEnd(35)} | ` +
            `$${result.attackerProfit.toFixed(2).padStart(10)} | ` +
            `${String(result.attackerDetections).padStart(6)} | ` +
            `${(result.avgSampleRate * 100).toFixed(1).padStart(10)}% | ` +
            `${color}${result.isProfitable ? 'PROFIT ⚠' : 'LOSS ✓'}${c.reset}`
        );
    }

    // Show how security scales
    console.log(`\n${c.yellow}▶ Security Parameter Scaling by Activity Level${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    const security = new DynamicSecurity();
    const levels = ['Low', 'Normal', 'High', 'Critical'];
    const levelObservables = [
        { totalEffectiveness: 400 },
        { totalEffectiveness: 1000 },
        { totalEffectiveness: 3000 },
        { totalEffectiveness: 6000 },
    ];

    console.log(`  ${'Level'.padEnd(10)} | ${'Sample%'.padStart(8)} | ${'Audit%'.padStart(8)} | ${'Clawback'.padStart(10)} | ${'Ban Days'.padStart(10)}`);
    console.log(`  ${'─'.repeat(55)}`);

    for (let i = 0; i < 4; i++) {
        security.observables.update(levelObservables[i]);
        const params = security.getCurrentParams();

        console.log(
            `  ${levels[i].padEnd(10)} | ` +
            `${(params.sampleProbability * 100).toFixed(1).padStart(6)}% | ` +
            `${(params.burstAuditProbability * 100).toFixed(1).padStart(6)}% | ` +
            `${String(params.clawbackWindow).padStart(8)}d | ` +
            `${String(params.banDuration).padStart(8)}d`
        );
    }

    // Comparison with static security
    console.log(`\n${c.yellow}▶ Dynamic vs Static Security Comparison${c.reset}`);
    console.log(`${c.yellow}${'─'.repeat(50)}${c.reset}\n`);

    console.log('  Running same attack under static (10% sample) vs dynamic...\n');

    const staticResult = simulateLoadResponsiveSecurity({ attackerNodes: 200, tokenPrice: 0.35 });

    // Simulate static (override params)
    let staticProfit = 0;
    const attackerNodes = 200;
    const tokenPrice = 0.35;
    const baseCost = RELIABILITY_CLASSES.hobbyist.monthlyTotalUSD / 30;
    const staticSample = 0.10;

    for (let epoch = 90; epoch < 180; epoch++) {
        const dailyEmission = calculateEmission(epoch);
        const attackerShare = (attackerNodes * 0.85) / ((1000 + attackerNodes) * 0.85);
        const reward = dailyEmission * attackerShare * tokenPrice;
        const cost = attackerNodes * baseCost;

        if (Math.random() < staticSample * 0.5) {
            staticProfit -= 14 * reward; // Clawback
        } else {
            staticProfit += reward;
        }
        staticProfit -= cost;
    }

    console.log(`  Static (10% sample):  $${staticProfit.toFixed(2)}`);
    console.log(`  Dynamic (responsive): $${staticResult.attackerProfit.toFixed(2)}`);
    console.log(`  Improvement: ${c.green}${((1 - staticResult.attackerProfit / Math.abs(staticProfit)) * 100).toFixed(0)}% better defense${c.reset}`);

    return { scenarios, staticResult };
}

// Run if executed directly
runLoadResponsiveAnalysis();

export { NetworkObservables, DynamicSecurity, simulateLoadResponsiveSecurity, runLoadResponsiveAnalysis };
