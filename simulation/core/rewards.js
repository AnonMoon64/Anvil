/**
 * Reward Distribution Module
 * Handles participation-normalized reward calculations
 */

import CONFIG from '../config.js';
import { calculateEmission } from './emission.js';

/**
 * Smoothed total effectiveness tracker
 * Uses exponential moving average to reduce volatility
 */
export class SmoothedEffectiveness {
    constructor() {
        this.value = 0;
        this.alpha = CONFIG.smoothing.alpha;
        this.initialized = false;
    }

    /**
     * Update with new total effectiveness
     * @param {number} totalEffectiveness - Current total effectiveness
     * @returns {number} Smoothed value
     */
    update(totalEffectiveness) {
        if (!this.initialized) {
            this.value = totalEffectiveness;
            this.initialized = true;
        } else {
            this.value = this.alpha * totalEffectiveness + (1 - this.alpha) * this.value;
        }
        return this.value;
    }

    /**
     * Get current smoothed value
     * @returns {number}
     */
    getValue() {
        return this.value;
    }

    /**
     * Reset the smoother
     */
    reset() {
        this.value = 0;
        this.initialized = false;
    }
}

/**
 * Calculate reward for a single node
 * Reward_i = Em_epoch * (Eff_i / S_t)
 * 
 * @param {number} nodeEffectiveness - Node's effectiveness weight
 * @param {number} smoothedTotalEffectiveness - Smoothed total of all effectiveness
 * @param {number} epochEmission - Total tokens emitted this epoch
 * @returns {number} Tokens rewarded to this node
 */
export function calculateNodeReward(nodeEffectiveness, smoothedTotalEffectiveness, epochEmission) {
    if (smoothedTotalEffectiveness === 0) {
        return 0;
    }
    return epochEmission * (nodeEffectiveness / smoothedTotalEffectiveness);
}

/**
 * Calculate rewards for all nodes in a network
 * 
 * @param {Array<{id: string, effectiveness: number}>} nodes - Array of node data
 * @param {number} daysSinceGenesis - Current day
 * @param {SmoothedEffectiveness} smoother - Smoothed effectiveness tracker
 * @returns {Object} Reward distribution data
 */
export function calculateNetworkRewards(nodes, daysSinceGenesis, smoother) {
    const totalEffectiveness = nodes.reduce((sum, node) => sum + node.effectiveness, 0);
    const smoothedTotal = smoother.update(totalEffectiveness);
    const epochEmission = calculateEmission(daysSinceGenesis);

    const rewards = nodes.map(node => ({
        id: node.id,
        effectiveness: node.effectiveness,
        reward: calculateNodeReward(node.effectiveness, smoothedTotal, epochEmission),
        share: totalEffectiveness > 0 ? node.effectiveness / totalEffectiveness : 0,
    }));

    return {
        day: daysSinceGenesis,
        epochEmission,
        totalEffectiveness,
        smoothedTotalEffectiveness: smoothedTotal,
        nodeCount: nodes.length,
        rewards,
        giniCoefficient: calculateGini(rewards.map(r => r.reward)),
    };
}

/**
 * Calculate Gini coefficient for inequality measurement
 * 
 * @param {number[]} values - Array of values (e.g., rewards)
 * @returns {number} Gini coefficient (0 = perfect equality, 1 = perfect inequality)
 */
export function calculateGini(values) {
    if (values.length === 0) return 0;

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    if (sum === 0) return 0;

    let cumulativeSum = 0;
    let weightedSum = 0;

    for (let i = 0; i < n; i++) {
        cumulativeSum += sorted[i];
        weightedSum += (i + 1) * sorted[i];
    }

    return (2 * weightedSum) / (n * sum) - (n + 1) / n;
}

/**
 * Simulate reward dilution when new nodes join
 * 
 * @param {number} existingNodes - Number of existing full-effectiveness nodes
 * @param {number} newNodes - Number of new nodes joining
 * @param {number} newNodeEffectiveness - Effectiveness of new nodes (0-1)
 * @param {number} epochEmission - Tokens emitted per epoch
 * @returns {Object} Dilution analysis
 */
export function analyzeRewardDilution(existingNodes, newNodes, newNodeEffectiveness, epochEmission) {
    // Before new nodes
    const beforeTotalEff = existingNodes * 1.0; // Assume full effectiveness
    const beforeRewardPerNode = epochEmission / existingNodes;

    // After new nodes
    const afterTotalEff = beforeTotalEff + (newNodes * newNodeEffectiveness);
    const afterRewardExisting = epochEmission * (1.0 / afterTotalEff);
    const afterRewardNew = epochEmission * (newNodeEffectiveness / afterTotalEff);

    return {
        before: {
            totalEffectiveness: beforeTotalEff,
            rewardPerNode: beforeRewardPerNode,
        },
        after: {
            totalEffectiveness: afterTotalEff,
            rewardPerExistingNode: afterRewardExisting,
            rewardPerNewNode: afterRewardNew,
        },
        dilutionPercent: ((beforeRewardPerNode - afterRewardExisting) / beforeRewardPerNode) * 100,
    };
}

export default {
    SmoothedEffectiveness,
    calculateNodeReward,
    calculateNetworkRewards,
    calculateGini,
    analyzeRewardDilution,
};
