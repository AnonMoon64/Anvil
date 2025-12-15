/**
 * Anvil Distributed Coordinator - Phase 2
 * Runs on your laptop, coordinates challenges between distributed nodes
 * 
 * Usage:
 *   node distributed-coordinator.js [--port 8080]
 */

import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
};

const CONFIG = {
    port: parseInt(getArg('port') || '8080'),

    // Test settings
    challengeIntervalMs: 1000,     // Issue challenges every second
    challengeTimeoutMs: 500,       // 500ms timeout
    testDurationMs: 60000,         // 1 minute test

    // Challenge types
    challengeTypes: ['liveness', 'data', 'work'],
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL DISTRIBUTED COORDINATOR (Phase 2)               ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// Get local IP
function getLocalIP() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIP = getLocalIP();
console.log(`Coordinator starting on port ${CONFIG.port}`);
console.log(`Local IP: ${localIP}`);
console.log(`Nodes should connect to: ws://${localIP}:${CONFIG.port}`);
console.log();

// State
const nodes = new Map();         // nodeId -> { ws, latencies, challenges, stats }
const pendingChallenges = new Map();  // challengeId -> { nodeId, issuedAt, type }
const results = {
    challengesIssued: 0,
    challengesCompleted: 0,
    challengesFailed: 0,
    timeouts: 0,
    latencies: [],
    roundTripTimes: [],
};

// Create WebSocket server
const wss = new WebSocketServer({ port: CONFIG.port });

wss.on('connection', (ws, req) => {
    const remoteIP = req.socket.remoteAddress;
    console.log(`Connection from ${remoteIP}`);

    let nodeId = null;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
                case 'register':
                    nodeId = msg.nodeId;
                    nodes.set(nodeId, {
                        ws,
                        ip: remoteIP,
                        connectedAt: Date.now(),
                        latencies: [],
                        stats: { challenges: 0, completed: 0, failed: 0 },
                    });
                    console.log(`✓ Node registered: ${nodeId} (${remoteIP})`);
                    console.log(`  Total nodes: ${nodes.size}`);
                    break;

                case 'challengeResponse':
                    handleChallengeResponse(msg);
                    break;

                case 'pong':
                    // Latency measurement
                    const rtt = Date.now() - msg.originalTimestamp;
                    if (nodeId && nodes.has(nodeId)) {
                        nodes.get(nodeId).latencies.push(rtt);
                    }
                    break;
            }
        } catch (err) {
            console.error('Message parse error:', err.message);
        }
    });

    ws.on('close', () => {
        if (nodeId) {
            console.log(`Node disconnected: ${nodeId}`);
            nodes.delete(nodeId);
        }
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error (${nodeId || 'unknown'}):`, err.message);
    });
});

function handleChallengeResponse(msg) {
    const { challengeId, nodeId, success, latencyMs, sentAt, receivedAt } = msg;
    const pending = pendingChallenges.get(challengeId);

    if (!pending) {
        // Already timed out
        return;
    }

    pendingChallenges.delete(challengeId);

    const roundTripTime = Date.now() - pending.issuedAt;
    results.roundTripTimes.push(roundTripTime);
    results.latencies.push(latencyMs);

    if (success) {
        results.challengesCompleted++;
    } else {
        results.challengesFailed++;
    }

    // Update node stats
    const node = nodes.get(nodeId);
    if (node) {
        node.stats.challenges++;
        if (success) {
            node.stats.completed++;
        } else {
            node.stats.failed++;
        }
    }
}

// Issue challenges to all connected nodes
function issueChallenge() {
    if (nodes.size === 0) return;

    for (const [nodeId, node] of nodes) {
        const challengeType = CONFIG.challengeTypes[
            Math.floor(Math.random() * CONFIG.challengeTypes.length)
        ];

        const challengeId = `c-${Date.now()}-${nodeId}`;
        const challenge = {
            type: 'challenge',
            challengeId,
            challengeType,
            issuedAt: Date.now(),
            blockIndex: Math.floor(Math.random() * 100),
            iterations: 10000,
        };

        pendingChallenges.set(challengeId, {
            nodeId,
            issuedAt: Date.now(),
            type: challengeType,
        });

        results.challengesIssued++;

        try {
            node.ws.send(JSON.stringify(challenge));
        } catch (err) {
            console.error(`Failed to send to ${nodeId}:`, err.message);
        }
    }
}

// Check for timeouts
function checkTimeouts() {
    const now = Date.now();

    for (const [challengeId, pending] of pendingChallenges) {
        if (now - pending.issuedAt > CONFIG.challengeTimeoutMs) {
            pendingChallenges.delete(challengeId);
            results.timeouts++;
            results.challengesFailed++;

            const node = nodes.get(pending.nodeId);
            if (node) {
                node.stats.failed++;
            }
        }
    }
}

// Ping all nodes for latency measurement
function pingNodes() {
    for (const [nodeId, node] of nodes) {
        try {
            node.ws.send(JSON.stringify({
                type: 'ping',
                timestamp: Date.now(),
            }));
        } catch (err) {
            // Ignore
        }
    }
}

// Report progress
function reportProgress() {
    if (nodes.size === 0) {
        console.log('Waiting for nodes to connect...');
        return;
    }

    const successRate = results.challengesCompleted /
        (results.challengesCompleted + results.challengesFailed) * 100 || 0;

    const avgRTT = results.roundTripTimes.length > 0
        ? results.roundTripTimes.reduce((a, b) => a + b, 0) / results.roundTripTimes.length
        : 0;

    console.log(
        `Challenges: ${results.challengesCompleted}/${results.challengesIssued} ` +
        `(${successRate.toFixed(1)}%), ` +
        `avg RTT: ${avgRTT.toFixed(1)}ms, ` +
        `timeouts: ${results.timeouts}, ` +
        `nodes: ${nodes.size}`
    );
}

// Start intervals
let challengeInterval = null;
let timeoutInterval = null;
let pingInterval = null;
let reportInterval = null;
let testStartTime = null;

function startTest() {
    console.log('\n--- TEST STARTED ---\n');
    testStartTime = Date.now();

    challengeInterval = setInterval(issueChallenge, CONFIG.challengeIntervalMs);
    timeoutInterval = setInterval(checkTimeouts, 100);
    pingInterval = setInterval(pingNodes, 5000);
    reportInterval = setInterval(reportProgress, 5000);

    // End test after duration
    setTimeout(endTest, CONFIG.testDurationMs);
}

function endTest() {
    console.log('\n--- TEST ENDED ---\n');

    clearInterval(challengeInterval);
    clearInterval(timeoutInterval);
    clearInterval(pingInterval);
    clearInterval(reportInterval);

    // Calculate final stats
    const duration = (Date.now() - testStartTime) / 1000;
    const successRate = results.challengesCompleted /
        (results.challengesCompleted + results.challengesFailed) * 100 || 0;

    results.roundTripTimes.sort((a, b) => a - b);
    const p50 = results.roundTripTimes[Math.floor(results.roundTripTimes.length * 0.50)];
    const p95 = results.roundTripTimes[Math.floor(results.roundTripTimes.length * 0.95)];
    const p99 = results.roundTripTimes[Math.floor(results.roundTripTimes.length * 0.99)];

    console.log('════════════════════════════════════════════════════════════════');
    console.log('DISTRIBUTED TEST RESULTS');
    console.log('════════════════════════════════════════════════════════════════\n');

    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Nodes: ${nodes.size}`);
    console.log();

    console.log('Challenge Performance:');
    console.log(`  Issued:     ${results.challengesIssued}`);
    console.log(`  Completed:  ${results.challengesCompleted} (${successRate.toFixed(1)}%)`);
    console.log(`  Failed:     ${results.challengesFailed}`);
    console.log(`  Timeouts:   ${results.timeouts}`);
    console.log();

    console.log('Round-Trip Time (RTT):');
    console.log(`  P50: ${p50?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P95: ${p95?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P99: ${p99?.toFixed(1) || 'N/A'}ms`);
    console.log();

    console.log('Per-Node Stats:');
    for (const [nodeId, node] of nodes) {
        const nodeSuccess = node.stats.completed / node.stats.challenges * 100 || 0;
        const avgLatency = node.latencies.length > 0
            ? node.latencies.reduce((a, b) => a + b, 0) / node.latencies.length
            : 0;
        console.log(`  ${nodeId}: ${nodeSuccess.toFixed(1)}% success, avg ping ${avgLatency.toFixed(1)}ms`);
    }
    console.log();

    // Assessment
    console.log('Assessment:');
    if (successRate > 95) {
        console.log('  ✅ Challenge success rate: EXCELLENT');
    } else if (successRate > 85) {
        console.log('  ✓ Challenge success rate: ACCEPTABLE');
    } else {
        console.log('  ⚠ Challenge success rate: NEEDS WORK');
    }

    if (p95 && p95 < CONFIG.challengeTimeoutMs * 0.8) {
        console.log('  ✅ RTT headroom: EXCELLENT');
    } else if (p95 && p95 < CONFIG.challengeTimeoutMs) {
        console.log('  ✓ RTT headroom: ACCEPTABLE');
    } else {
        console.log('  ⚠ RTT headroom: TIGHT or FAILING');
    }

    console.log('\n✅ Distributed test complete.\n');

    // Keep running for manual testing
    console.log('Coordinator still running. Press Ctrl+C to exit.\n');
}

// Wait for at least one node before starting
console.log('Waiting for nodes to connect...\n');
const waitInterval = setInterval(() => {
    if (nodes.size >= 1) {
        clearInterval(waitInterval);
        console.log(`${nodes.size} node(s) connected. Starting test in 3 seconds...`);
        setTimeout(startTest, 3000);
    }
}, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');

    // Signal all nodes to disconnect
    for (const [nodeId, node] of nodes) {
        try {
            node.ws.send(JSON.stringify({ type: 'shutdown' }));
            node.ws.close();
        } catch (err) {
            // Ignore
        }
    }

    wss.close();
    process.exit(0);
});

console.log('Coordinator ready.\n');
