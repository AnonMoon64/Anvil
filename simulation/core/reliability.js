/**
 * Reliability Classes Module
 * Models realistic node uptime patterns, failure distributions, and repair times
 */

import CONFIG from '../config.js';

/**
 * Reliability class definitions with realistic distributions
 */
export const RELIABILITY_CLASSES = {
    // Hobbyist: Raspberry Pi Zero/4, truly low-power, home internet
    // Target: Viable at ~$0.15-0.20 token price
    hobbyist: {
        name: 'Hobbyist',
        // Daily uptime: 20-24 hours (auto-restart, minimal maintenance)
        dailyUptimeHours: { min: 20, max: 24, mean: 22 },
        // Weekly outage probability (router reboot, power flicker)
        weeklyOutageProb: 0.10,
        // Outage duration when it happens (hours)
        outageDuration: { min: 0.25, max: 4, mean: 1 },
        // Monthly hardware failure probability
        monthlyHardwareFailureProb: 0.01,
        // Hardware repair time (days)
        hardwareRepairDays: { min: 0.5, max: 3, mean: 1 },
        // Bandwidth cap (Mbps) - home connection
        bandwidthMbps: { min: 10, max: 100, mean: 30 },
        // Base latency (ms) 
        baseLatencyMs: { min: 15, max: 80, mean: 40 },
        // Fraction of network
        networkFraction: 0.45,
        // Cost profile (REALISTIC LOW-POWER)
        costs: {
            hardwareOneTime: 50,      // Raspberry Pi 4 + SD card
            powerWatts: 5,            // 5W idle
            powerCostKwh: 0.12,       // $0.12/kWh average
            bandwidthGB: 50,          // 50GB/month included
            bandwidthCostPerGB: 0,    // Usually included in home internet
            maintenanceHoursMonth: 0.5, // 30 min/month
        },
        // Monthly cost calculation: ~$0.50 power + $0 bandwidth + amortized HW
        monthlyTotalUSD: 3,         // Truly minimal
    },

    // Enthusiast: Gaming PC running a node, decent connection
    enthusiast: {
        name: 'Enthusiast',
        dailyUptimeHours: { min: 18, max: 24, mean: 21 },
        weeklyOutageProb: 0.08,
        outageDuration: { min: 0.25, max: 4, mean: 1 },
        monthlyHardwareFailureProb: 0.01,
        hardwareRepairDays: { min: 0.5, max: 3, mean: 1 },
        bandwidthMbps: { min: 50, max: 300, mean: 120 },
        baseLatencyMs: { min: 10, max: 50, mean: 25 },
        networkFraction: 0.30,
        costs: {
            hardwareOneTime: 200,     // Portion of existing PC
            powerWatts: 50,           // 50W for node workload
            powerCostKwh: 0.12,
            bandwidthGB: 200,
            bandwidthCostPerGB: 0,
            maintenanceHoursMonth: 1,
        },
        monthlyTotalUSD: 8,
    },

    // Professional: Dedicated mini-server, good uptime
    professional: {
        name: 'Professional',
        dailyUptimeHours: { min: 23, max: 24, mean: 23.8 },
        weeklyOutageProb: 0.03,
        outageDuration: { min: 0.1, max: 1, mean: 0.3 },
        monthlyHardwareFailureProb: 0.005,
        hardwareRepairDays: { min: 0.1, max: 1, mean: 0.25 },
        bandwidthMbps: { min: 100, max: 1000, mean: 500 },
        baseLatencyMs: { min: 5, max: 30, mean: 15 },
        networkFraction: 0.20,
        costs: {
            hardwareOneTime: 500,
            powerWatts: 100,
            powerCostKwh: 0.10,
            bandwidthGB: 1000,
            bandwidthCostPerGB: 0.01,
            maintenanceHoursMonth: 2,
        },
        monthlyTotalUSD: 25,
    },

    // Datacenter: Cloud/colo, high uptime, instant failover
    datacenter: {
        name: 'Datacenter',
        dailyUptimeHours: { min: 23.9, max: 24, mean: 23.98 },
        weeklyOutageProb: 0.01,
        outageDuration: { min: 0.05, max: 0.5, mean: 0.1 },
        monthlyHardwareFailureProb: 0.002,
        hardwareRepairDays: { min: 0.01, max: 0.25, mean: 0.05 },
        bandwidthMbps: { min: 500, max: 10000, mean: 2000 },
        baseLatencyMs: { min: 1, max: 15, mean: 5 },
        networkFraction: 0.05,
        costs: {
            hardwareOneTime: 0,       // Rented
            monthlyRental: 50,        // VPS/dedicated
            powerWatts: 0,            // Included
            powerCostKwh: 0,
            bandwidthGB: 5000,
            bandwidthCostPerGB: 0.02,
            maintenanceHoursMonth: 1,
        },
        monthlyTotalUSD: 80,
    },
};

/**
 * Sample from a triangular distribution (min, max, mode)
 */
function sampleTriangular(min, max, mode) {
    const u = Math.random();
    const fc = (mode - min) / (max - min);

    if (u < fc) {
        return min + Math.sqrt(u * (max - min) * (mode - min));
    } else {
        return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
}

/**
 * Sample from distribution object { min, max, mean }
 * Uses triangular distribution with mean as mode
 */
export function sampleDistribution(dist) {
    return sampleTriangular(dist.min, dist.max, dist.mean);
}

/**
 * Node reliability state tracker
 */
export class NodeReliability {
    constructor(reliabilityClass = 'hobbyist') {
        this.class = reliabilityClass;
        this.config = RELIABILITY_CLASSES[reliabilityClass];

        // Sample this node's specific characteristics
        this.bandwidth = sampleDistribution(this.config.bandwidthMbps);
        this.baseLatency = sampleDistribution(this.config.baseLatencyMs);

        // State
        this.isDown = false;
        this.downUntilDay = 0;
        this.downReason = null;

        // Track cumulative failures
        this.totalOutages = 0;
        this.totalDowntimeDays = 0;
    }

    /**
     * Check for failures at start of day and update state
     * @param {number} currentDay - Current simulation day
     * @returns {boolean} Whether node is operational
     */
    checkFailures(currentDay) {
        // If currently down, check if repaired
        if (this.isDown) {
            if (currentDay >= this.downUntilDay) {
                this.isDown = false;
                this.downReason = null;
            } else {
                return false;
            }
        }

        // Check for new failures

        // Weekly outage (check daily with adjusted probability)
        if (Math.random() < this.config.weeklyOutageProb / 7) {
            const outageDays = sampleDistribution(this.config.outageDuration) / 24;
            this.triggerOutage(currentDay, outageDays, 'temporary');
            return false;
        }

        // Monthly hardware failure (check daily with adjusted probability)
        if (Math.random() < this.config.monthlyHardwareFailureProb / 30) {
            const repairDays = sampleDistribution(this.config.hardwareRepairDays);
            this.triggerOutage(currentDay, repairDays, 'hardware');
            return false;
        }

        // Daily partial uptime - model as probability of missing this tick
        const uptimeHours = sampleDistribution(this.config.dailyUptimeHours);
        const uptimeFraction = uptimeHours / 24;

        if (Math.random() > uptimeFraction) {
            // Missed this day due to scheduled downtime
            return false;
        }

        return true;
    }

    /**
     * Trigger an outage
     */
    triggerOutage(currentDay, durationDays, reason) {
        this.isDown = true;
        this.downUntilDay = currentDay + durationDays;
        this.downReason = reason;
        this.totalOutages++;
        this.totalDowntimeDays += durationDays;
    }

    /**
     * Force an outage (from external attack)
     */
    forceOutage(currentDay, durationDays, reason = 'attack') {
        this.triggerOutage(currentDay, durationDays, reason);
    }

    /**
     * Get current latency including jitter and load
     * @param {number} loadFactor - Current network load (0-1)
     * @returns {number} Latency in ms
     */
    getCurrentLatency(loadFactor = 0) {
        // Jitter: ±30% random variation
        const jitter = 1 + (Math.random() - 0.5) * 0.6;

        // Load impact: up to 3x latency under heavy load
        const loadMultiplier = 1 + loadFactor * 2;

        return this.baseLatency * jitter * loadMultiplier;
    }

    /**
     * Check if node can serve a challenge given bandwidth and payload
     * @param {number} payloadMB - Payload size in MB
     * @param {number} deadlineMs - Deadline in ms
     * @param {number} loadFactor - Current network load (0-1)
     * @returns {Object} { success, actualTimeMs, reason }
     */
    canServeChallenge(payloadMB, deadlineMs, loadFactor = 0) {
        if (this.isDown) {
            return { success: false, actualTimeMs: Infinity, reason: 'offline' };
        }

        // Calculate transfer time
        const payloadBits = payloadMB * 8 * 1024 * 1024;
        const effectiveBandwidth = this.bandwidth * (1 - loadFactor * 0.5); // Load reduces bandwidth
        const transferMs = (payloadBits / (effectiveBandwidth * 1000000)) * 1000;

        // Add latency
        const latency = this.getCurrentLatency(loadFactor);
        const totalMs = transferMs + latency;

        if (totalMs > deadlineMs) {
            return { success: false, actualTimeMs: totalMs, reason: 'timeout' };
        }

        return { success: true, actualTimeMs: totalMs, reason: null };
    }

    /**
     * Get reliability summary
     */
    getSummary() {
        return {
            class: this.class,
            bandwidth: this.bandwidth,
            baseLatency: this.baseLatency,
            isDown: this.isDown,
            totalOutages: this.totalOutages,
            totalDowntimeDays: this.totalDowntimeDays,
        };
    }
}

/**
 * Assign reliability class based on weighted random selection
 */
export function assignReliabilityClass() {
    const r = Math.random();
    let cumulative = 0;

    for (const [className, config] of Object.entries(RELIABILITY_CLASSES)) {
        cumulative += config.networkFraction;
        if (r <= cumulative) {
            return className;
        }
    }

    return 'hobbyist'; // fallback
}

/**
 * Generate network-wide reliability statistics
 */
export function analyzeNetworkReliability(nodes) {
    const stats = {
        byClass: {},
        overall: {
            avgUptime: 0,
            avgOutages: 0,
            avgDowntime: 0,
        },
    };

    for (const className of Object.keys(RELIABILITY_CLASSES)) {
        stats.byClass[className] = { count: 0, avgUptime: 0, avgOutages: 0 };
    }

    for (const node of nodes) {
        if (node.reliability) {
            const cls = node.reliability.class;
            const rel = node.reliability;

            stats.byClass[cls].count++;
            stats.byClass[cls].avgOutages += rel.totalOutages;
            stats.byClass[cls].avgDowntime += rel.totalDowntimeDays;
        }
    }

    // Compute averages
    for (const className of Object.keys(stats.byClass)) {
        const s = stats.byClass[className];
        if (s.count > 0) {
            s.avgOutages /= s.count;
            s.avgDowntime /= s.count;
        }
    }

    return stats;
}

export default {
    RELIABILITY_CLASSES,
    NodeReliability,
    sampleDistribution,
    assignReliabilityClass,
    analyzeNetworkReliability,
};
