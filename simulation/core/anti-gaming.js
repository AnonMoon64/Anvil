/**
 * Anti-Gaming Scoring Module
 * Replaces hard pass/fail thresholds with continuous scoring
 * Makes "edge compliance" strategy expensive
 */

import CONFIG from '../config.js';

/**
 * Scoring configuration
 */
export const SCORING_CONFIG = {
    // Soft target (not a cliff)
    softTarget: 0.85,           // Aim for 85% score, not pass/fail

    // Score components and weights
    weights: {
        workQuality: 0.35,        // Bounded work completion quality
        responsiveness: 0.30,     // Challenge latency score
        availability: 0.25,       // Data availability success rate
        consistency: 0.10,        // Low variance in performance
    },

    // Edge grazing detection
    edgeGrazing: {
        windowEpochs: 14,         // Rolling window for detection
        edgeThreshold: 0.10,      // Within 10% of minimum = "edge grazing"
        penaltyMultiplier: 0.85,  // 15% reward reduction for edge grazers
        auditProbabilityBoost: 0.20, // +20% audit chance
    },

    // Burst audit configuration
    burstAudit: {
        baseProbability: 0.05,    // 5% chance per epoch
        failurePenalty: 0.25,     // Lose 25% effectiveness on burst failure
        decayAcceleration: 2.0,   // 2x decay rate after burst failure
        cooldownEpochs: 7,        // Minimum epochs between burst audits
    },

    // Two-stage EMA smoothing
    smoothing: {
        fastAlpha: 0.3,           // Fast EMA for entry detection
        slowAlpha: 0.1,           // Slow EMA for stability
        entryDetectionThreshold: 0.15, // Change >15% triggers fast tracking
    },
};

/**
 * Calculate continuous participation score (not pass/fail)
 * @param {Object} metrics - Performance metrics for the epoch
 * @returns {Object} Score breakdown and total
 */
export function calculateParticipationScore(metrics) {
    const w = SCORING_CONFIG.weights;

    // Work quality: 0-1 based on proof completeness and correctness
    const workScore = calculateWorkQualityScore(metrics.workProofs || []);

    // Responsiveness: latency-weighted challenge response
    const responsivenessScore = calculateResponsivenessScore(
        metrics.challengeLatencies || [],
        metrics.challengeDeadlines || []
    );

    // Availability: fraction of data challenges served
    const availabilityScore = metrics.challengesServed / Math.max(1, metrics.challengesReceived);

    // Consistency: inverse of variance in recent scores
    const consistencyScore = calculateConsistencyScore(metrics.recentScores || []);

    // Weighted total
    const totalScore =
        w.workQuality * workScore +
        w.responsiveness * responsivenessScore +
        w.availability * availabilityScore +
        w.consistency * consistencyScore;

    return {
        workScore,
        responsivenessScore,
        availabilityScore,
        consistencyScore,
        totalScore,
        meetsTarget: totalScore >= SCORING_CONFIG.softTarget,
        distanceFromTarget: totalScore - SCORING_CONFIG.softTarget,
    };
}

/**
 * Work quality score - measures proof completeness
 */
function calculateWorkQualityScore(workProofs) {
    if (workProofs.length === 0) return 0;

    let totalQuality = 0;
    for (const proof of workProofs) {
        // Quality based on:
        // - Completion (did they finish?)
        // - Freshness (keyed to recent chain state?)
        // - Difficulty met (not just minimum?)
        const completion = proof.completed ? 1.0 : 0.0;
        const freshness = proof.chainStateAge < 10 ? 1.0 : Math.max(0, 1 - proof.chainStateAge / 100);
        const difficultyBonus = Math.min(1.0, proof.difficulty / proof.targetDifficulty);

        totalQuality += (completion * 0.5 + freshness * 0.3 + difficultyBonus * 0.2);
    }

    return totalQuality / workProofs.length;
}

/**
 * Responsiveness score - latency-weighted
 */
function calculateResponsivenessScore(latencies, deadlines) {
    if (latencies.length === 0) return 0;

    let totalScore = 0;
    for (let i = 0; i < latencies.length; i++) {
        const latency = latencies[i];
        const deadline = deadlines[i] || 1000;

        if (latency > deadline) {
            // Missed deadline - harsh penalty
            totalScore += 0;
        } else if (latency < deadline * 0.5) {
            // Fast response - bonus
            totalScore += 1.0;
        } else {
            // Linear score between 50% and 100% of deadline
            const fraction = (deadline - latency) / (deadline * 0.5);
            totalScore += 0.5 + (fraction * 0.5);
        }
    }

    return totalScore / latencies.length;
}

/**
 * Consistency score - rewards stable performance
 */
function calculateConsistencyScore(recentScores) {
    if (recentScores.length < 3) return 0.5; // Neutral for new nodes

    const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const variance = recentScores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / recentScores.length;
    const stdDev = Math.sqrt(variance);

    // Low variance = high score
    // stdDev of 0.1 = 90% score, stdDev of 0.3 = 50% score
    return Math.max(0, 1 - stdDev * 3);
}

/**
 * Edge grazing detector
 * Tracks nodes that consistently hover near minimum thresholds
 */
export class EdgeGrazingDetector {
    constructor() {
        this.nodeHistory = new Map(); // nodeId -> score history
    }

    /**
     * Record a score and check for edge grazing
     * @param {string} nodeId - Node identifier
     * @param {number} score - This epoch's score
     * @returns {Object} Edge grazing status
     */
    recordAndCheck(nodeId, score) {
        if (!this.nodeHistory.has(nodeId)) {
            this.nodeHistory.set(nodeId, []);
        }

        const history = this.nodeHistory.get(nodeId);
        history.push(score);

        // Keep only the rolling window
        const window = SCORING_CONFIG.edgeGrazing.windowEpochs;
        while (history.length > window) {
            history.shift();
        }

        // Check for edge grazing pattern
        if (history.length < window / 2) {
            return { isGrazing: false, penalty: 1.0, auditBoost: 0 };
        }

        const threshold = SCORING_CONFIG.softTarget;
        const edgeZone = SCORING_CONFIG.edgeGrazing.edgeThreshold;

        // Count epochs in edge zone
        const edgeCount = history.filter(s =>
            s >= threshold - edgeZone && s <= threshold + edgeZone
        ).length;

        const edgeFraction = edgeCount / history.length;

        if (edgeFraction > 0.6) {
            // More than 60% of epochs in edge zone = grazing
            return {
                isGrazing: true,
                penalty: SCORING_CONFIG.edgeGrazing.penaltyMultiplier,
                auditBoost: SCORING_CONFIG.edgeGrazing.auditProbabilityBoost,
                edgeFraction,
            };
        }

        return { isGrazing: false, penalty: 1.0, auditBoost: 0, edgeFraction };
    }

    /**
     * Clear history for a node (e.g., after ban)
     */
    clearNode(nodeId) {
        this.nodeHistory.delete(nodeId);
    }
}

/**
 * Burst audit system
 * Unpredictable, costly-to-fail extra verification
 */
export class BurstAuditSystem {
    constructor() {
        this.lastAuditEpoch = new Map(); // nodeId -> last audit epoch
        this.failedNodes = new Set();     // Nodes in accelerated decay
    }

    /**
     * Check if a burst audit triggers this epoch
     * @param {string} nodeId - Node identifier
     * @param {number} currentEpoch - Current epoch number
     * @param {number} auditBoost - Additional probability from edge grazing
     * @returns {Object} Audit trigger result
     */
    checkTrigger(nodeId, currentEpoch, auditBoost = 0) {
        const config = SCORING_CONFIG.burstAudit;
        const lastAudit = this.lastAuditEpoch.get(nodeId) || -Infinity;

        // Respect cooldown
        if (currentEpoch - lastAudit < config.cooldownEpochs) {
            return { triggered: false, reason: 'cooldown' };
        }

        // Random trigger
        const probability = config.baseProbability + auditBoost;
        if (Math.random() < probability) {
            this.lastAuditEpoch.set(nodeId, currentEpoch);
            return { triggered: true, probability };
        }

        return { triggered: false, reason: 'random' };
    }

    /**
     * Generate burst audit challenge
     * @returns {Object} Burst audit requirements
     */
    generateBurstAudit() {
        return {
            type: 'burst',
            // Require multiple proof types simultaneously
            requirements: {
                workProof: { deadline: 15000, difficulty: 1.5 },  // 1.5x normal difficulty
                dataChunks: { count: 5, randomOffsets: true },
                livenessChecks: { count: 3, maxLatency: 250 },   // Tight latency
            },
            penaltyOnFailure: SCORING_CONFIG.burstAudit.failurePenalty,
        };
    }

    /**
     * Record burst audit result
     * @param {string} nodeId - Node identifier
     * @param {boolean} passed - Whether audit was passed
     * @returns {Object} Consequences
     */
    recordResult(nodeId, passed) {
        if (!passed) {
            this.failedNodes.add(nodeId);
            return {
                effectivenessLoss: SCORING_CONFIG.burstAudit.failurePenalty,
                decayMultiplier: SCORING_CONFIG.burstAudit.decayAcceleration,
                inAcceleratedDecay: true,
            };
        }

        // Passed - remove from accelerated decay if applicable
        this.failedNodes.delete(nodeId);
        return {
            effectivenessLoss: 0,
            decayMultiplier: 1.0,
            inAcceleratedDecay: false,
        };
    }

    /**
     * Check if node is in accelerated decay mode
     */
    isInAcceleratedDecay(nodeId) {
        return this.failedNodes.has(nodeId);
    }
}

/**
 * Two-stage EMA smoother
 * Fast tracking for entries, slow for stability
 */
export class TwoStageEMASmoother {
    constructor() {
        this.slowValue = 0;
        this.fastValue = 0;
        this.initialized = false;
        this.config = SCORING_CONFIG.smoothing;
    }

    /**
     * Update with new total effectiveness
     * @param {number} newValue - Current total effectiveness
     * @returns {Object} Smoothed values
     */
    update(newValue) {
        if (!this.initialized) {
            this.slowValue = newValue;
            this.fastValue = newValue;
            this.initialized = true;
            return { value: newValue, mode: 'initial' };
        }

        // Update both EMAs
        this.fastValue = this.config.fastAlpha * newValue +
            (1 - this.config.fastAlpha) * this.fastValue;
        this.slowValue = this.config.slowAlpha * newValue +
            (1 - this.config.slowAlpha) * this.slowValue;

        // Detect significant change (entry/exit event)
        const change = Math.abs(newValue - this.slowValue) / Math.max(1, this.slowValue);

        if (change > this.config.entryDetectionThreshold) {
            // Use fast EMA during transitions
            return {
                value: this.fastValue,
                mode: 'fast',
                change,
            };
        }

        // Use slow EMA for stability
        return {
            value: this.slowValue,
            mode: 'slow',
            change,
        };
    }

    /**
     * Get current best estimate
     */
    getValue() {
        return this.slowValue;
    }

    reset() {
        this.slowValue = 0;
        this.fastValue = 0;
        this.initialized = false;
    }
}

/**
 * Compute effectiveness delta based on score (not binary)
 * @param {number} currentEff - Current effectiveness
 * @param {number} score - This epoch's participation score
 * @param {number} edgePenalty - Multiplier from edge grazing (1.0 = none)
 * @param {number} decayMultiplier - Multiplier from burst audit failure
 * @returns {Object} New effectiveness and delta
 */
export function computeEffectivenessUpdate(currentEff, score, edgePenalty = 1.0, decayMultiplier = 1.0) {
    const target = SCORING_CONFIG.softTarget;

    if (score >= target) {
        // Above target: ramp up normally
        const rampRate = 0.025; // ~95% in 120 days at full score
        const scoreBonus = (score - target) / (1 - target); // Bonus for exceeding target
        const deltaUp = rampRate * (1 + scoreBonus * 0.5);

        const newEff = Math.min(1.0, currentEff + deltaUp);
        return {
            effectiveness: newEff * edgePenalty,
            delta: newEff - currentEff,
            reason: 'ramp',
        };
    } else {
        // Below target: decay proportional to distance
        const distance = target - score;
        const baseDecay = 0.02;
        const decayRate = baseDecay * (1 + distance * 3) * decayMultiplier;

        const newEff = Math.max(0, currentEff - decayRate);
        return {
            effectiveness: newEff * edgePenalty,
            delta: newEff - currentEff,
            reason: 'decay',
        };
    }
}

export default {
    SCORING_CONFIG,
    calculateParticipationScore,
    EdgeGrazingDetector,
    BurstAuditSystem,
    TwoStageEMASmoother,
    computeEffectivenessUpdate,
};
