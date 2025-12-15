/**
 * Network Simulation Module
 * Manages the entire network of nodes
 */

import { Node, NodeFactory } from './node.js';
import { SmoothedEffectiveness, calculateNetworkRewards, calculateGini } from './rewards.js';
import { calculateEmission, calculateTotalEmitted } from './emission.js';
import CONFIG from '../config.js';

/**
 * Represents the entire network
 */
export class Network {
    constructor() {
        this.nodes = new Map();
        this.currentDay = 0;
        this.smoother = new SmoothedEffectiveness();
        this.history = [];

        NodeFactory.reset();
    }

    /**
     * Add a node to the network
     * @param {Node} node - Node to add
     */
    addNode(node) {
        this.nodes.set(node.id, node);
    }

    /**
     * Remove a node from the network
     * @param {string} nodeId - Node ID to remove
     */
    removeNode(nodeId) {
        this.nodes.delete(nodeId);
    }

    /**
     * Get a node by ID
     * @param {string} nodeId - Node ID
     * @returns {Node|undefined}
     */
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }

    /**
     * Simulate one day
     * @returns {Object} Day summary
     */
    tick() {
        this.currentDay++;

        // Update all nodes and collect effectiveness
        const nodeData = [];
        for (const node of this.nodes.values()) {
            // Handle intermittent nodes
            if (node.type === 'intermittent' && node.uptimePercent) {
                const shouldBeOnline = Math.random() * 100 < node.uptimePercent;
                if (shouldBeOnline && !node.isOnline) {
                    node.goOnline();
                } else if (!shouldBeOnline && node.isOnline) {
                    node.goOffline();
                }
            }

            const effectiveness = node.tick(this.currentDay);
            if (this.currentDay >= node.joinDay) {
                nodeData.push({
                    id: node.id,
                    effectiveness,
                    type: node.type,
                });
            }
        }

        // Calculate rewards
        const rewardData = calculateNetworkRewards(nodeData, this.currentDay, this.smoother);

        // Distribute rewards to nodes
        for (const reward of rewardData.rewards) {
            const node = this.nodes.get(reward.id);
            if (node) {
                node.addReward(reward.reward);
            }
        }

        // Record history
        const daySummary = {
            day: this.currentDay,
            nodeCount: nodeData.length,
            totalEffectiveness: rewardData.totalEffectiveness,
            smoothedEffectiveness: rewardData.smoothedTotalEffectiveness,
            epochEmission: rewardData.epochEmission,
            totalEmitted: calculateTotalEmitted(this.currentDay),
            giniCoefficient: rewardData.giniCoefficient,
            avgEffectiveness: nodeData.length > 0
                ? rewardData.totalEffectiveness / nodeData.length
                : 0,
            nodesByType: this.countByType(nodeData),
        };

        this.history.push(daySummary);

        return daySummary;
    }

    /**
     * Run simulation for multiple days
     * @param {number} days - Days to simulate
     * @param {Function} onTick - Optional callback per day
     * @returns {Array<Object>} Daily summaries
     */
    simulate(days, onTick = null) {
        const results = [];

        for (let i = 0; i < days; i++) {
            const summary = this.tick();
            results.push(summary);

            if (onTick) {
                onTick(summary);
            }
        }

        return results;
    }

    /**
     * Count nodes by type
     * @param {Array} nodeData - Node effectiveness data
     * @returns {Object}
     */
    countByType(nodeData) {
        const counts = { honest: 0, attacker: 0, intermittent: 0 };
        for (const node of nodeData) {
            counts[node.type] = (counts[node.type] || 0) + 1;
        }
        return counts;
    }

    /**
     * Get network statistics
     * @returns {Object}
     */
    getStats() {
        const nodes = Array.from(this.nodes.values());
        const rewards = nodes.map(n => n.totalRewards);

        return {
            totalNodes: nodes.length,
            currentDay: this.currentDay,
            totalRewardsDistributed: rewards.reduce((a, b) => a + b, 0),
            avgRewardPerNode: rewards.length > 0
                ? rewards.reduce((a, b) => a + b, 0) / rewards.length
                : 0,
            maxReward: Math.max(...rewards, 0),
            minReward: Math.min(...rewards, 0),
            rewardGini: calculateGini(rewards),
            nodesByType: this.countByType(nodes.map(n => ({ type: n.type }))),
        };
    }

    /**
     * Get node leaderboard
     * @param {number} limit - Max nodes to return
     * @returns {Array<Object>}
     */
    getLeaderboard(limit = 10) {
        return Array.from(this.nodes.values())
            .sort((a, b) => b.totalRewards - a.totalRewards)
            .slice(0, limit)
            .map(n => n.getSummary());
    }

    /**
     * Get effectiveness distribution
     * @returns {Object}
     */
    getEffectivenessDistribution() {
        const effectivenesses = Array.from(this.nodes.values())
            .map(n => n.getEffectiveness());

        const buckets = {
            '0-10%': 0,
            '10-25%': 0,
            '25-50%': 0,
            '50-75%': 0,
            '75-90%': 0,
            '90-100%': 0,
        };

        for (const eff of effectivenesses) {
            const percent = eff * 100;
            if (percent < 10) buckets['0-10%']++;
            else if (percent < 25) buckets['10-25%']++;
            else if (percent < 50) buckets['25-50%']++;
            else if (percent < 75) buckets['50-75%']++;
            else if (percent < 90) buckets['75-90%']++;
            else buckets['90-100%']++;
        }

        return buckets;
    }

    /**
     * Reset network state
     */
    reset() {
        this.nodes.clear();
        this.currentDay = 0;
        this.smoother.reset();
        this.history = [];
        NodeFactory.reset();
    }
}

export default Network;
