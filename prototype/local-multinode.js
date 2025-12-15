/**
 * Anvil Local Multi-Node Prototype
 * Phase 1: Prove the protocol isn't computationally insane
 * 
 * Uses async message passing between simulated nodes (no worker threads)
 * to measure timing, resource usage, and failure patterns.
 */

import { cpus } from 'os';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Node count
    nodeCount: 100,

    // Epoch settings
    epochDurationMs: 100,          // 100ms epochs
    totalEpochs: 100,              // 10 second test

    // Challenge settings
    challengesPerNodePerEpoch: 2,
    challengeTimeoutMs: 50,        // 50ms deadline

    // Challenge types with simulated processing time
    challengeTypes: {
        liveness: { payloadBytes: 100, processingMs: 1 },
        data: { payloadBytes: 50000, processingMs: 5 },
        work: { payloadBytes: 1000, processingMs: 10 },
    },

    // Verification
    sampleRate: 0.10,

    // Scoring
    scoreTarget: 0.85,

    // Node reliability distribution
    reliabilityClasses: {
        hobbyist: { fraction: 0.45, latencyMs: { min: 5, max: 40 }, failureRate: 0.02 },
        enthusiast: { fraction: 0.30, latencyMs: { min: 3, max: 25 }, failureRate: 0.01 },
        professional: { fraction: 0.20, latencyMs: { min: 1, max: 15 }, failureRate: 0.005 },
        datacenter: { fraction: 0.05, latencyMs: { min: 0, max: 5 }, failureRate: 0.001 },
    },
};

// ============================================================================
// NODE CLASS
// ============================================================================

class SimNode {
    constructor(id, reliabilityClass) {
        this.id = id;
        this.class = reliabilityClass;
        this.config = CONFIG.reliabilityClasses[reliabilityClass];

        // State
        this.effectiveness = 0;
        this.participationDays = 0;
        this.failures = 0;
        this.rewards = 0;
        this.score = 0;

        // Metrics
        this.challengesReceived = 0;
        this.challengesCompleted = 0;
        this.totalLatencyMs = 0;
    }

    /**
     * Process a challenge and return response
     */
    async processChallenge(challenge) {
        this.challengesReceived++;
        const startTime = Date.now();

        // Simulate network latency
        const latency = this.config.latencyMs.min +
            Math.random() * (this.config.latencyMs.max - this.config.latencyMs.min);

        // Simulate processing time
        const processingMs = CONFIG.challengeTypes[challenge.type].processingMs;

        // Total response time
        const totalMs = latency + processingMs;

        // Simulate random failures
        const failed = Math.random() < this.config.failureRate;

        // Check if we made the deadline
        const timedOut = totalMs > CONFIG.challengeTimeoutMs;

        const success = !failed && !timedOut;

        if (success) {
            this.challengesCompleted++;
        } else {
            this.failures++;
        }

        this.totalLatencyMs += totalMs;

        return {
            challengeId: challenge.id,
            nodeId: this.id,
            success,
            latencyMs: totalMs,
            timedOut,
            failed,
        };
    }
}

// ============================================================================
// COORDINATOR
// ============================================================================

async function runPrototype() {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║        ANVIL LOCAL MULTI-NODE PROTOTYPE (Phase 1)           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log(`Configuration:`);
    console.log(`  Nodes: ${CONFIG.nodeCount}`);
    console.log(`  Epoch duration: ${CONFIG.epochDurationMs}ms`);
    console.log(`  Total epochs: ${CONFIG.totalEpochs}`);
    console.log(`  Challenge timeout: ${CONFIG.challengeTimeoutMs}ms`);
    console.log(`  CPUs available: ${cpus().length}`);
    console.log();

    // Create nodes
    console.log(`Creating ${CONFIG.nodeCount} nodes...`);
    const nodes = new Map();

    for (let i = 0; i < CONFIG.nodeCount; i++) {
        // Assign reliability class based on distribution
        const r = Math.random();
        let cumulative = 0;
        let reliabilityClass = 'hobbyist';

        for (const [cls, cfg] of Object.entries(CONFIG.reliabilityClasses)) {
            cumulative += cfg.fraction;
            if (r <= cumulative) {
                reliabilityClass = cls;
                break;
            }
        }

        const nodeId = `node-${i.toString().padStart(3, '0')}`;
        nodes.set(nodeId, new SimNode(nodeId, reliabilityClass));
    }

    // Count by class
    const classCounts = {};
    for (const node of nodes.values()) {
        classCounts[node.class] = (classCounts[node.class] || 0) + 1;
    }
    console.log('  Distribution:', classCounts);
    console.log();

    // Metrics
    const metrics = {
        challengesIssued: 0,
        challengesCompleted: 0,
        challengesFailed: 0,
        timeouts: 0,
        totalLatencyMs: 0,
        latencies: [],
    };

    // Run epochs
    console.log('Running epochs...\n');
    const startTime = Date.now();

    for (let epoch = 0; epoch < CONFIG.totalEpochs; epoch++) {
        const epochStart = Date.now();
        const nodeIds = [...nodes.keys()];
        const epochPromises = [];

        // Issue challenges
        for (const nodeId of nodeIds) {
            const node = nodes.get(nodeId);

            for (let c = 0; c < CONFIG.challengesPerNodePerEpoch; c++) {
                // Pick random challenger
                const challengerIdx = Math.floor(Math.random() * nodeIds.length);
                if (nodeIds[challengerIdx] === nodeId) continue;

                // Pick challenge type
                const types = Object.keys(CONFIG.challengeTypes);
                const type = types[Math.floor(Math.random() * types.length)];

                const challenge = {
                    id: `e${epoch}-${nodeId}-${c}`,
                    type,
                    from: nodeIds[challengerIdx],
                    to: nodeId,
                };

                metrics.challengesIssued++;

                // Process challenge (async but tracked)
                epochPromises.push(
                    node.processChallenge(challenge).then(result => {
                        if (result.success) {
                            metrics.challengesCompleted++;
                        } else {
                            metrics.challengesFailed++;
                            if (result.timedOut) metrics.timeouts++;
                        }
                        metrics.totalLatencyMs += result.latencyMs;
                        metrics.latencies.push(result.latencyMs);
                    })
                );
            }
        }

        // Wait for all challenges to complete
        await Promise.all(epochPromises);

        // Update node scores
        for (const node of nodes.values()) {
            node.score = node.challengesReceived > 0
                ? node.challengesCompleted / node.challengesReceived
                : 0;

            // Ramp up effectiveness for successful nodes
            if (node.score >= CONFIG.scoreTarget) {
                node.effectiveness = Math.min(1, node.effectiveness + 0.01);
                node.participationDays++;
            }
        }

        // Maintain epoch timing
        const epochElapsed = Date.now() - epochStart;
        if (epochElapsed < CONFIG.epochDurationMs) {
            await new Promise(r => setTimeout(r, CONFIG.epochDurationMs - epochElapsed));
        }

        // Progress report
        if ((epoch + 1) % 20 === 0 || epoch === CONFIG.totalEpochs - 1) {
            const successRate = metrics.challengesCompleted /
                (metrics.challengesCompleted + metrics.challengesFailed) * 100 || 0;
            const avgLatency = metrics.totalLatencyMs /
                (metrics.challengesCompleted + metrics.challengesFailed) || 0;

            console.log(
                `  Epoch ${(epoch + 1).toString().padStart(3)}: ` +
                `${metrics.challengesCompleted}/${metrics.challengesIssued} (${successRate.toFixed(1)}% success), ` +
                `avg ${avgLatency.toFixed(1)}ms, ` +
                `${metrics.timeouts} timeouts`
            );
        }
    }

    const totalTime = Date.now() - startTime;

    // Calculate final statistics
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('FINAL RESULTS');
    console.log('════════════════════════════════════════════════════════════════\n');

    const successRate = metrics.challengesCompleted /
        (metrics.challengesCompleted + metrics.challengesFailed) * 100;

    console.log('Challenge Performance:');
    console.log(`  Total issued:    ${metrics.challengesIssued}`);
    console.log(`  Completed:       ${metrics.challengesCompleted} (${successRate.toFixed(1)}%)`);
    console.log(`  Failed:          ${metrics.challengesFailed}`);
    console.log(`  Timeouts:        ${metrics.timeouts} (${(metrics.timeouts / metrics.challengesFailed * 100 || 0).toFixed(1)}% of failures)`);
    console.log(`  Avg latency:     ${(metrics.totalLatencyMs / metrics.latencies.length).toFixed(2)}ms`);
    console.log();

    // Latency distribution
    metrics.latencies.sort((a, b) => a - b);
    const p50 = metrics.latencies[Math.floor(metrics.latencies.length * 0.50)];
    const p95 = metrics.latencies[Math.floor(metrics.latencies.length * 0.95)];
    const p99 = metrics.latencies[Math.floor(metrics.latencies.length * 0.99)];

    console.log('Latency Distribution:');
    console.log(`  P50: ${p50?.toFixed(1)}ms`);
    console.log(`  P95: ${p95?.toFixed(1)}ms`);
    console.log(`  P99: ${p99?.toFixed(1)}ms`);
    console.log();

    // Node statistics by class
    console.log('Node Statistics by Class:');
    for (const cls of Object.keys(CONFIG.reliabilityClasses)) {
        const classNodes = [...nodes.values()].filter(n => n.class === cls);
        const avgScore = classNodes.reduce((s, n) => s + n.score, 0) / classNodes.length || 0;
        const avgEff = classNodes.reduce((s, n) => s + n.effectiveness, 0) / classNodes.length || 0;
        const avgFailures = classNodes.reduce((s, n) => s + n.failures, 0) / classNodes.length || 0;

        console.log(`  ${cls.padEnd(15)}: score ${(avgScore * 100).toFixed(1)}%, eff ${(avgEff * 100).toFixed(1)}%, failures ${avgFailures.toFixed(1)}`);
    }
    console.log();

    // Resource usage
    const memUsage = process.memoryUsage();
    console.log('Resource Usage:');
    console.log(`  Memory (heap):   ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Per node:        ${(memUsage.heapUsed / CONFIG.nodeCount / 1024).toFixed(1)} KB`);
    console.log(`  Total time:      ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`  Time per epoch:  ${(totalTime / CONFIG.totalEpochs).toFixed(1)}ms`);
    console.log();

    // Timing analysis
    console.log('Timing Analysis:');
    const timingFailRate = metrics.timeouts / metrics.challengesIssued * 100;
    console.log(`  Timeout threshold: ${CONFIG.challengeTimeoutMs}ms`);
    console.log(`  Timeout rate:      ${timingFailRate.toFixed(2)}%`);

    if (timingFailRate > 10) {
        console.log(`  ⚠ HIGH TIMEOUT RATE - Consider increasing timeout threshold`);
    } else if (timingFailRate > 5) {
        console.log(`  ⚠ Moderate timeout rate - May need tuning for real network`);
    } else {
        console.log(`  ✓ Timeout rate acceptable`);
    }
    console.log();

    // Summary assessment
    console.log('════════════════════════════════════════════════════════════════');
    console.log('ASSESSMENT');
    console.log('════════════════════════════════════════════════════════════════\n');

    if (successRate > 95) {
        console.log('  ✅ Challenge success rate: EXCELLENT');
    } else if (successRate > 85) {
        console.log('  ✓ Challenge success rate: ACCEPTABLE');
    } else {
        console.log('  ⚠ Challenge success rate: NEEDS WORK');
    }

    if (p95 < CONFIG.challengeTimeoutMs * 0.8) {
        console.log('  ✅ Latency headroom: EXCELLENT');
    } else if (p95 < CONFIG.challengeTimeoutMs) {
        console.log('  ✓ Latency headroom: ACCEPTABLE');
    } else {
        console.log('  ⚠ Latency headroom: TIGHT');
    }

    if (memUsage.heapUsed / CONFIG.nodeCount < 100 * 1024) {
        console.log('  ✅ Memory per node: EXCELLENT (<100KB)');
    } else if (memUsage.heapUsed / CONFIG.nodeCount < 500 * 1024) {
        console.log('  ✓ Memory per node: ACCEPTABLE (<500KB)');
    } else {
        console.log('  ⚠ Memory per node: HIGH');
    }

    console.log('\n✅ Prototype run complete.\n');
    console.log('Next step: Test with real network latency on multiple VPS nodes.\n');
}

runPrototype();
