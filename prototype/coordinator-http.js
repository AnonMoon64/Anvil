/**
 * Anvil Distributed Coordinator (HTTP version)
 * Uses HTTP polling instead of WebSocket for simpler VPS compatibility
 * 
 * Usage:
 *   node coordinator-http.js [--port 8080]
 */

import http from 'http';
import { networkInterfaces } from 'os';

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
};

const CONFIG = {
    port: parseInt(getArg('port') || '8080'),

    // Test settings
    challengeIntervalMs: 1000,
    challengeTimeoutMs: 2000,  // 2 second timeout for HTTP polling
    testDurationMs: 60000,

    challengeTypes: ['liveness', 'data', 'work'],
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL DISTRIBUTED COORDINATOR (HTTP)                  ║');
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
console.log(`Nodes should connect to: http://${localIP}:${CONFIG.port}`);
console.log();

// State
const nodes = new Map();
const pendingChallenges = new Map();  // nodeId -> [challenges]
const results = {
    challengesIssued: 0,
    challengesCompleted: 0,
    challengesFailed: 0,
    timeouts: 0,
    roundTripTimes: [],
};

// HTTP Server
const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        handleRequest(req, res, body);
    });
});

function handleRequest(req, res, body) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        // Register node
        if (path === '/register' && req.method === 'POST') {
            const data = JSON.parse(body);
            nodes.set(data.nodeId, {
                ip: req.socket.remoteAddress,
                connectedAt: Date.now(),
                lastSeen: Date.now(),
                stats: { challenges: 0, completed: 0, failed: 0 },
            });
            pendingChallenges.set(data.nodeId, []);
            console.log(`✓ Node registered: ${data.nodeId} (${req.socket.remoteAddress})`);
            console.log(`  Total nodes: ${nodes.size}`);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Get pending challenges for a node
        if (path.startsWith('/challenges/') && req.method === 'GET') {
            const nodeId = path.split('/')[2];
            const challenges = pendingChallenges.get(nodeId) || [];
            pendingChallenges.set(nodeId, []);  // Clear after fetching

            if (nodes.has(nodeId)) {
                nodes.get(nodeId).lastSeen = Date.now();
            }

            res.end(JSON.stringify(challenges));
            return;
        }

        // Receive challenge response
        if (path === '/response' && req.method === 'POST') {
            const data = JSON.parse(body);
            handleChallengeResponse(data);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Heartbeat
        if (path === '/heartbeat' && req.method === 'POST') {
            const data = JSON.parse(body);
            if (nodes.has(data.nodeId)) {
                nodes.get(data.nodeId).lastSeen = Date.now();
            }
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Status
        if (path === '/status') {
            res.end(JSON.stringify({
                nodes: nodes.size,
                results,
            }));
            return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));

    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

function handleChallengeResponse(data) {
    const { challengeId, nodeId, success, latencyMs } = data;

    const rtt = Date.now() - parseInt(challengeId.split('-')[1]);
    results.roundTripTimes.push(rtt);

    if (success) {
        results.challengesCompleted++;
    } else {
        results.challengesFailed++;
    }

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

// Issue challenges
function issueChallenge() {
    if (nodes.size === 0) return;

    for (const [nodeId, node] of nodes) {
        // Check if node is still alive
        if (Date.now() - node.lastSeen > 30000) {
            console.log(`Node ${nodeId} timed out`);
            nodes.delete(nodeId);
            pendingChallenges.delete(nodeId);
            continue;
        }

        const challengeType = CONFIG.challengeTypes[
            Math.floor(Math.random() * CONFIG.challengeTypes.length)
        ];

        const challengeId = `c-${Date.now()}-${nodeId}`;
        const challenge = {
            challengeId,
            challengeType,
            issuedAt: Date.now(),
            blockIndex: Math.floor(Math.random() * 100),
            iterations: 10000,
        };

        const nodeQueue = pendingChallenges.get(nodeId) || [];
        nodeQueue.push(challenge);
        pendingChallenges.set(nodeId, nodeQueue);

        results.challengesIssued++;
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
        `nodes: ${nodes.size}`
    );
}

// Start
server.listen(CONFIG.port, () => {
    console.log(`Server listening on port ${CONFIG.port}\n`);
    console.log('Waiting for nodes to connect...\n');
});

// Start issuing challenges and reporting
let testStarted = false;
let testStartTime = null;

const waitInterval = setInterval(() => {
    if (nodes.size >= 1 && !testStarted) {
        testStarted = true;
        testStartTime = Date.now();
        console.log(`${nodes.size} node(s) connected. Starting test...\n`);

        setInterval(issueChallenge, CONFIG.challengeIntervalMs);
        setInterval(reportProgress, 5000);

        // End test after duration
        setTimeout(endTest, CONFIG.testDurationMs);
    }
}, 1000);

function endTest() {
    console.log('\n--- TEST ENDED ---\n');

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
    console.log();

    console.log('Round-Trip Time (RTT):');
    console.log(`  P50: ${p50?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P95: ${p95?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P99: ${p99?.toFixed(1) || 'N/A'}ms`);
    console.log();

    console.log('Per-Node Stats:');
    for (const [nodeId, node] of nodes) {
        const nodeSuccess = node.stats.completed / node.stats.challenges * 100 || 0;
        console.log(`  ${nodeId}: ${nodeSuccess.toFixed(1)}% success`);
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

    if (p95 && p95 < 400) {
        console.log('  ✅ RTT: EXCELLENT (<400ms)');
    } else if (p95 && p95 < 1000) {
        console.log('  ✓ RTT: ACCEPTABLE (<1s)');
    } else {
        console.log('  ⚠ RTT: HIGH - timing constraints may be too tight');
    }

    console.log('\n✅ Distributed test complete.\n');
    console.log('Coordinator still running. Press Ctrl+C to exit.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
});
