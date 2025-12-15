/**
 * Node Simulation Module
 * Represents individual participants in the network
 */

import { calculateRamp, calculateDecay } from './effectiveness.js';

/**
 * Represents a single node in the network
 */
export class Node {
    /**
     * Create a new node
     * @param {string} id - Unique node identifier
     * @param {number} joinDay - Day when node joined the network
     * @param {string} type - Node type (honest, attacker, intermittent)
     */
    constructor(id, joinDay = 0, type = 'honest') {
        this.id = id;
        this.joinDay = joinDay;
        this.type = type;

        // State tracking
        this.isOnline = true;
        this.participationDays = 0;
        this.offlineDays = 0;
        this.effectivenessWhenWentOffline = 0;
        this.totalRewards = 0;

        // History for analysis
        this.history = [];
    }

    /**
     * Update node state for a new day
     * @param {number} currentDay - Current simulation day
     * @returns {number} Current effectiveness
     */
    tick(currentDay) {
        if (currentDay < this.joinDay) {
            return 0;
        }

        let effectiveness;

        if (this.isOnline) {
            this.participationDays += 1;
            this.offlineDays = 0;
            effectiveness = calculateRamp(this.participationDays);
        } else {
            this.offlineDays += 1;
            effectiveness = calculateDecay(this.effectivenessWhenWentOffline, this.offlineDays);

            // If effectively reset, clear participation
            if (effectiveness === 0) {
                this.participationDays = 0;
            }
        }

        this.history.push({
            day: currentDay,
            effectiveness,
            isOnline: this.isOnline,
            participationDays: this.participationDays,
        });

        return effectiveness;
    }

    /**
     * Take node offline
     */
    goOffline() {
        if (this.isOnline) {
            this.effectivenessWhenWentOffline = calculateRamp(this.participationDays);
            this.isOnline = false;
        }
    }

    /**
     * Bring node back online
     */
    goOnline() {
        if (!this.isOnline) {
            // Calculate current effectiveness after decay
            const currentEff = calculateDecay(this.effectivenessWhenWentOffline, this.offlineDays);

            // Convert current effectiveness back to equivalent participation days
            // Eff(t) = 1 - exp(-t/R) => t = -R * ln(1 - Eff)
            if (currentEff > 0) {
                const R = 40; // From config
                this.participationDays = -R * Math.log(1 - currentEff);
            } else {
                this.participationDays = 0;
            }

            this.isOnline = true;
            this.offlineDays = 0;
        }
    }

    /**
     * Add rewards to node
     * @param {number} amount - Reward amount
     */
    addReward(amount) {
        this.totalRewards += amount;
    }

    /**
     * Get current effectiveness
     * @returns {number}
     */
    getEffectiveness() {
        if (this.history.length === 0) {
            return 0;
        }
        return this.history[this.history.length - 1].effectiveness;
    }

    /**
     * Get node summary
     * @returns {Object}
     */
    getSummary() {
        return {
            id: this.id,
            type: this.type,
            joinDay: this.joinDay,
            participationDays: this.participationDays,
            isOnline: this.isOnline,
            currentEffectiveness: this.getEffectiveness(),
            totalRewards: this.totalRewards,
        };
    }
}

/**
 * Factory for creating different node types
 */
export class NodeFactory {
    static nodeCounter = 0;

    /**
     * Create an honest node that stays online
     */
    static createHonest(joinDay = 0) {
        return new Node(`honest-${++this.nodeCounter}`, joinDay, 'honest');
    }

    /**
     * Create an intermittent node with random availability
     * @param {number} joinDay - Day to join
     * @param {number} uptimePercent - Percentage of time online (0-100)
     */
    static createIntermittent(joinDay = 0, uptimePercent = 80) {
        const node = new Node(`intermittent-${++this.nodeCounter}`, joinDay, 'intermittent');
        node.uptimePercent = uptimePercent;
        return node;
    }

    /**
     * Create an attacker node
     */
    static createAttacker(joinDay = 0) {
        return new Node(`attacker-${++this.nodeCounter}`, joinDay, 'attacker');
    }

    /**
     * Reset counter
     */
    static reset() {
        this.nodeCounter = 0;
    }
}

export default {
    Node,
    NodeFactory,
};
