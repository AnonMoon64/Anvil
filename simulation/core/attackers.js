/**
 * Attacker Strategies Module
 * Models diverse attack patterns beyond naive "add nodes"
 */

import CONFIG from '../config.js';
import { calculateRamp, calculateDecay } from './effectiveness.js';

/**
 * Attacker strategy definitions
 */
export const ATTACKER_STRATEGIES = {
    // Naive: spin up nodes and keep them running
    naive: {
        name: 'Naive Wave',
        description: 'Spin up all nodes at once, keep them running',
        setupCostMultiplier: 1.0,
        operationalCostMultiplier: 1.0,
        effectivenessMultiplier: 1.0,
    },

    // Cycling: rotate cohorts to minimize decay impact
    cycling: {
        name: 'Cycling Cohorts',
        description: 'Rotate 3 cohorts to maintain presence while reducing costs',
        setupCostMultiplier: 1.0,
        operationalCostMultiplier: 0.35, // Only 1/3 active at a time
        effectivenessMultiplier: 0.33,   // But only 1/3 effectiveness at any moment
        cohortCount: 3,
        cycleIntervalDays: 7,
    },

    // Edge: just barely meet thresholds
    edge: {
        name: 'Edge Compliance',
        description: 'Meet minimum requirements, skip expensive proofs when possible',
        setupCostMultiplier: 0.8,
        operationalCostMultiplier: 0.6,
        effectivenessMultiplier: 0.85, // Occasionally miss challenges
        challengeSkipRate: 0.15,
    },

    // Grief: disrupt honest nodes rather than maximize rewards
    grief: {
        name: 'Griefing Attack',
        description: 'Focus on disrupting honest nodes via network attacks',
        setupCostMultiplier: 0.5,
        operationalCostMultiplier: 0.8,
        effectivenessMultiplier: 0.3,
        honestDisruptionRate: 0.1, // Fraction of honest nodes disrupted per epoch
        griefCostPerNode: 5,       // USD per honest node disrupted
    },

    // Sampling: gamble on not being verified
    sampling: {
        name: 'Verification Gambling',
        description: 'Submit fake proofs hoping to avoid verification sampling',
        setupCostMultiplier: 1.0,
        operationalCostMultiplier: 0.4,
        effectivenessMultiplier: 1.0,
        fraudRate: 0.8, // 80% of proofs are fraudulent
        banProbabilityPerEpoch: 0.05,
    },

    // Whale: maximize at all costs, professional operation
    whale: {
        name: 'Whale Operation',
        description: 'Professional, well-funded attack maximizing network share',
        setupCostMultiplier: 1.5,  // Premium for reliability
        operationalCostMultiplier: 1.3,
        effectivenessMultiplier: 0.98, // Very high uptime
        targetNetworkShare: 0.33,
    },
};

/**
 * Simulate attacker behavior for one epoch
 */
export class AttackerSimulator {
    constructor(strategy, nodeCount, networkSize) {
        this.strategy = strategy;
        this.config = ATTACKER_STRATEGIES[strategy];
        this.nodeCount = nodeCount;
        this.networkSize = networkSize;

        // State
        this.epoch = 0;
        this.totalRewards = 0;
        this.totalCosts = 0;
        this.isBanned = false;
        this.banUntilEpoch = 0;
        this.activeCohort = 0;
        this.history = [];
    }

    /**
     * Run one epoch of attack
     * @param {number} epochEmission - Total tokens emitted this epoch
     * @param {number} networkTotalEff - Total network effectiveness
     * @param {number} baseCostPerNode - Base cost per node per epoch
     * @returns {Object} Epoch results
     */
    runEpoch(epochEmission, networkTotalEff, baseCostPerNode) {
        this.epoch++;

        // Check if banned
        if (this.isBanned && this.epoch < this.banUntilEpoch) {
            return this.recordEpoch(0, 0, 'banned');
        }
        this.isBanned = false;

        let activeNodes = this.nodeCount;
        let effectivenessPerNode = this.config.effectivenessMultiplier;
        let costMultiplier = this.config.operationalCostMultiplier;
        let status = 'active';

        // Strategy-specific behavior
        switch (this.strategy) {
            case 'cycling':
                // Only 1/3 of nodes active at any time
                activeNodes = Math.ceil(this.nodeCount / this.config.cohortCount);
                if (this.epoch % this.config.cycleIntervalDays === 0) {
                    this.activeCohort = (this.activeCohort + 1) % this.config.cohortCount;
                    // Cohort just came online, reduced effectiveness
                    effectivenessPerNode *= 0.5;
                }
                break;

            case 'edge':
                // Occasionally skip challenges
                if (Math.random() < this.config.challengeSkipRate) {
                    effectivenessPerNode *= 0.8;
                    status = 'edge-skip';
                }
                break;

            case 'sampling':
                // Check if caught this epoch
                if (Math.random() < this.config.banProbabilityPerEpoch) {
                    this.isBanned = true;
                    this.banUntilEpoch = this.epoch + 14;
                    return this.recordEpoch(0, baseCostPerNode * this.nodeCount * 0.5, 'caught');
                }
                break;

            case 'grief':
                // Costs go toward disruption, not earning
                const griefCost = this.config.griefCostPerNode * this.networkSize *
                    this.config.honestDisruptionRate;
                return this.recordEpoch(0, griefCost, 'griefing');
        }

        // Calculate rewards
        const attackerTotalEff = activeNodes * effectivenessPerNode;
        const attackerShare = attackerTotalEff / (networkTotalEff + attackerTotalEff);
        const rewards = epochEmission * attackerShare;

        // Calculate costs
        const costs = this.nodeCount * baseCostPerNode * costMultiplier / 30; // Daily cost

        return this.recordEpoch(rewards, costs, status);
    }

    /**
     * Record epoch results
     */
    recordEpoch(rewards, costs, status) {
        this.totalRewards += rewards;
        this.totalCosts += costs;

        const result = {
            epoch: this.epoch,
            rewards,
            costs,
            profit: rewards - costs,
            status,
            cumRewards: this.totalRewards,
            cumCosts: this.totalCosts,
            cumProfit: this.totalRewards - this.totalCosts,
        };

        this.history.push(result);
        return result;
    }

    /**
     * Get summary statistics
     */
    getSummary() {
        return {
            strategy: this.strategy,
            nodeCount: this.nodeCount,
            epochs: this.epoch,
            totalRewards: this.totalRewards,
            totalCosts: this.totalCosts,
            totalProfit: this.totalRewards - this.totalCosts,
            avgDailyProfit: (this.totalRewards - this.totalCosts) / this.epoch,
            roi: this.totalCosts > 0 ? (this.totalRewards - this.totalCosts) / this.totalCosts : 0,
            profitableEpochs: this.history.filter(h => h.profit > 0).length,
        };
    }
}

/**
 * DDoS/griefing attack model
 * @param {number} attackBudget - USD budget for attack
 * @param {number} costPerNodeDisrupted - Cost to disrupt one honest node per epoch
 * @param {number} honestNodes - Total honest nodes in network
 * @returns {Object} Attack impact analysis
 */
export function modelGriefAttack(attackBudget, costPerNodeDisrupted, honestNodes) {
    const nodesDisrupted = Math.floor(attackBudget / costPerNodeDisrupted);
    const disruptionFraction = nodesDisrupted / honestNodes;

    // Compute impact on honest reward variance
    // Disrupted nodes miss challenges, increasing rewards for others temporarily
    const rewardVarianceIncrease = disruptionFraction * 2; // 2x variance multiplier per disrupted fraction

    return {
        attackBudget,
        nodesDisrupted,
        disruptionFraction,
        honestNodesAffected: nodesDisrupted,
        rewardVarianceIncrease,
        epochsOfDisruption: 1, // Assumes attack lasts one epoch
        costEfficiency: nodesDisrupted / attackBudget,
    };
}

/**
 * Compare attack strategies over time
 * @param {number} nodeCount - Attacker nodes
 * @param {number} networkSize - Network honest nodes
 * @param {number} epochs - Simulation length
 * @param {number} dailyEmission - Tokens emitted per day
 * @param {number} baseCostPerNode - Monthly cost per node
 * @param {number} networkEffPerNode - Average honest effectiveness
 */
export function compareStrategies(
    nodeCount,
    networkSize,
    epochs,
    dailyEmission,
    baseCostPerNode,
    networkEffPerNode = 0.8
) {
    const results = {};
    const networkTotalEff = networkSize * networkEffPerNode;

    for (const strategy of Object.keys(ATTACKER_STRATEGIES)) {
        const sim = new AttackerSimulator(strategy, nodeCount, networkSize);

        for (let e = 0; e < epochs; e++) {
            sim.runEpoch(dailyEmission, networkTotalEff, baseCostPerNode);
        }

        results[strategy] = sim.getSummary();
    }

    // Rank by total profit
    const ranked = Object.entries(results)
        .sort((a, b) => b[1].totalProfit - a[1].totalProfit)
        .map(([name, data], index) => ({ rank: index + 1, name, ...data }));

    return {
        strategies: results,
        ranked,
        bestStrategy: ranked[0]?.name || 'none',
        worstStrategy: ranked[ranked.length - 1]?.name || 'none',
    };
}

/**
 * Analyze EMA smoothing exploitation
 * @param {number} smoothingAlpha - EMA alpha parameter
 * @param {number} attackerNodes - Nodes joining suddenly
 * @param {number} honestNodes - Existing honest nodes
 * @param {number} dailyEmission - Daily emission
 * @param {number} epochs - Epochs to analyze
 */
export function analyzeSmooothingExploit(
    smoothingAlpha,
    attackerNodes,
    honestNodes,
    dailyEmission,
    epochs
) {
    const honestEff = honestNodes * 0.9; // Assume 90% effectiveness
    const attackerEff = attackerNodes * 0.3; // New nodes start low

    let smoothedTotal = honestEff;
    const history = [];

    let attackerRewards = 0;
    let honestRewards = 0;

    // Before attacker
    for (let e = 0; e < 10; e++) {
        smoothedTotal = smoothingAlpha * honestEff + (1 - smoothingAlpha) * smoothedTotal;
        const perNodeReward = dailyEmission / honestNodes;
        honestRewards += dailyEmission;
    }

    // Attacker enters
    for (let e = 0; e < epochs; e++) {
        const instantTotal = honestEff + attackerEff;
        smoothedTotal = smoothingAlpha * instantTotal + (1 - smoothingAlpha) * smoothedTotal;

        // Rewards based on smoothed total
        const attackerShare = attackerEff / smoothedTotal;
        const honestShare = honestEff / smoothedTotal;

        const epochAttackerReward = dailyEmission * attackerShare;
        const epochHonestReward = dailyEmission * honestShare;

        attackerRewards += epochAttackerReward;
        honestRewards += epochHonestReward;

        history.push({
            epoch: e,
            smoothedTotal,
            instantTotal,
            lag: smoothedTotal - instantTotal,
            attackerShare,
            attackerReward: epochAttackerReward,
        });
    }

    // Calculate exploit value
    // Compare attacker rewards with smoothing vs without
    const instantShareAvg = attackerEff / (honestEff + attackerEff);
    const rewardsWithoutSmoothing = dailyEmission * instantShareAvg * epochs;
    const exploitValue = attackerRewards - rewardsWithoutSmoothing;

    return {
        smoothingAlpha,
        attackerNodes,
        honestNodes,
        epochs,
        attackerRewards,
        rewardsWithoutSmoothing,
        exploitValue,
        exploitPercent: (exploitValue / rewardsWithoutSmoothing) * 100,
        stabilizationEpochs: Math.ceil(-Math.log(0.05) / Math.log(1 - smoothingAlpha)),
        history: history.slice(0, 30), // First 30 epochs
    };
}

export default {
    ATTACKER_STRATEGIES,
    AttackerSimulator,
    modelGriefAttack,
    compareStrategies,
    analyzeSmooothingExploit,
};
