/**
 * Network Constraints Module
 * Models bandwidth, latency, payload sizes, and challenge success as first-class resources
 */

import CONFIG from '../config.js';

/**
 * Challenge types with different resource requirements
 */
export const CHALLENGE_TYPES = {
    // Liveness ping - quick response required
    liveness: {
        name: 'Liveness',
        payloadMB: 0.001,        // 1 KB
        deadlineMs: 500,         // 500ms deadline
        frequency: 0.3,          // 30% of challenges
        penaltyWeight: 0.5,      // Missed = 50% of full penalty
    },

    // Recent data availability - moderate payload
    recentData: {
        name: 'Recent Data',
        payloadMB: 0.5,          // 500 KB
        deadlineMs: 2000,        // 2 second deadline
        frequency: 0.4,          // 40% of challenges
        penaltyWeight: 1.0,      // Full penalty
    },

    // Historical data availability - large payload
    historicalData: {
        name: 'Historical Data',
        payloadMB: 5,            // 5 MB
        deadlineMs: 10000,       // 10 second deadline
        frequency: 0.2,          // 20% of challenges
        penaltyWeight: 1.0,      // Full penalty
    },

    // Bounded work proof submission
    workProof: {
        name: 'Work Proof',
        payloadMB: 0.1,          // 100 KB proof
        deadlineMs: 30000,       // 30 second deadline
        frequency: 0.1,          // 10% of challenges
        penaltyWeight: 2.0,      // Double penalty for missing work
    },
};

/**
 * Generate a random challenge based on frequency weights
 */
export function generateChallenge() {
    const r = Math.random();
    let cumulative = 0;

    for (const [type, config] of Object.entries(CHALLENGE_TYPES)) {
        cumulative += config.frequency;
        if (r <= cumulative) {
            return {
                type,
                ...config,
                timestamp: Date.now(),
                id: Math.random().toString(36).substring(7),
            };
        }
    }

    return { type: 'liveness', ...CHALLENGE_TYPES.liveness };
}

/**
 * Network load simulator
 * Models global network congestion
 */
export class NetworkLoadSimulator {
    constructor() {
        this.baseLoad = 0.1;       // 10% base load
        this.currentLoad = 0.1;
        this.loadHistory = [];
    }

    /**
     * Update load for current epoch
     * @param {number} activeNodes - Number of active nodes
     * @param {number} challengeRate - Challenges per node per epoch
     */
    updateLoad(activeNodes, challengeRate = 5) {
        // Base load from normal operation
        const normalLoad = 0.1 + (activeNodes / 10000) * 0.2;

        // Random spikes (coordinated challenges, bursts)
        const spike = Math.random() < 0.1 ? Math.random() * 0.3 : 0;

        // Time-of-day variation (simplified)
        const timeVariation = 0.1 * Math.sin(this.loadHistory.length * 0.1);

        this.currentLoad = Math.min(0.95, normalLoad + spike + timeVariation);
        this.loadHistory.push(this.currentLoad);

        return this.currentLoad;
    }

    /**
     * Get load with attacker-induced congestion
     * @param {number} attackerCongestFraction - Fraction of extra load from attacker
     */
    getLoadWithAttack(attackerCongestFraction = 0) {
        return Math.min(0.95, this.currentLoad + attackerCongestFraction);
    }

    /**
     * Get average load over last N epochs
     */
    getAverageLoad(epochs = 30) {
        const recent = this.loadHistory.slice(-epochs);
        return recent.length > 0
            ? recent.reduce((a, b) => a + b, 0) / recent.length
            : this.baseLoad;
    }
}

/**
 * Calculate challenge success probability given network conditions
 */
export function calculateChallengeSuccess(node, challenge, networkLoad = 0) {
    if (!node.reliability) {
        // Fallback for nodes without reliability model
        return { success: Math.random() > 0.05, penalty: 0 };
    }

    const result = node.reliability.canServeChallenge(
        challenge.payloadMB,
        challenge.deadlineMs,
        networkLoad
    );

    return {
        success: result.success,
        penalty: result.success ? 0 : challenge.penaltyWeight,
        reason: result.reason,
        actualTimeMs: result.actualTimeMs,
    };
}

/**
 * Run a batch of challenges against a node
 * @param {Object} node - Node with reliability property
 * @param {number} challengeCount - Number of challenges this epoch
 * @param {number} networkLoad - Current network load
 * @returns {Object} Challenge results summary
 */
export function runChallenges(node, challengeCount, networkLoad = 0) {
    const results = {
        attempted: challengeCount,
        passed: 0,
        failed: 0,
        totalPenalty: 0,
        byType: {},
        failures: [],
    };

    for (let i = 0; i < challengeCount; i++) {
        const challenge = generateChallenge();
        const outcome = calculateChallengeSuccess(node, challenge, networkLoad);

        if (!results.byType[challenge.type]) {
            results.byType[challenge.type] = { passed: 0, failed: 0 };
        }

        if (outcome.success) {
            results.passed++;
            results.byType[challenge.type].passed++;
        } else {
            results.failed++;
            results.totalPenalty += outcome.penalty;
            results.byType[challenge.type].failed++;
            results.failures.push({
                type: challenge.type,
                reason: outcome.reason,
            });
        }
    }

    results.successRate = results.passed / results.attempted;

    return results;
}

/**
 * Calculate bandwidth cost for an epoch
 * @param {number} challengeCount - Challenges served
 * @param {number} avgPayloadMB - Average payload size
 * @returns {number} Total bandwidth used in MB
 */
export function calculateBandwidthUsage(challengeCount, avgPayloadMB = 1) {
    // Upload + download, plus protocol overhead (~20%)
    return challengeCount * avgPayloadMB * 2 * 1.2;
}

/**
 * Estimate monthly bandwidth cost for a node
 * @param {number} dailyChallenges - Average challenges per day
 * @param {number} costPerGB - Cost per GB in USD
 */
export function estimateBandwidthCost(dailyChallenges, costPerGB = 0.05) {
    const avgPayloadMB = Object.values(CHALLENGE_TYPES)
        .reduce((sum, c) => sum + c.payloadMB * c.frequency, 0);

    const dailyMB = calculateBandwidthUsage(dailyChallenges, avgPayloadMB);
    const monthlyGB = (dailyMB * 30) / 1024;

    return monthlyGB * costPerGB;
}

export default {
    CHALLENGE_TYPES,
    generateChallenge,
    NetworkLoadSimulator,
    calculateChallengeSuccess,
    runChallenges,
    calculateBandwidthUsage,
    estimateBandwidthCost,
};
