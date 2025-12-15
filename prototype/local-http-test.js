/**
 * Anvil Local Test - Coordinator + Nodes in one process
 * Tests the HTTP protocol locally before distributed deployment
 */

import http from 'http';

const CONFIG = {
    port: 8080,
    nodeCount: 5,
    testDurationMs: 30000,
    challengeIntervalMs: 500,
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL LOCAL TEST (Coordinator + Nodes)               ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

// ============================================================================
// COORDINATOR
// ============================================================================

const nodes = new Map();
const pendingChallenges = new Map();
const results = {
    issued: 0,
    completed: 0,
    failed: 0,
    rtts: [],
};

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        try {
            const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
            const path = url.pathname;

            if (path === '/register' && req.method === 'POST') {
                const data = JSON.parse(body);
                nodes.set(data.nodeId, { lastSeen: Date.now(), stats: { c: 0, ok: 0 } });
                pendingChallenges.set(data.nodeId, []);
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            if (path.startsWith('/challenges/') && req.method === 'GET') {
                const nodeId = path.split('/')[2];
                const challenges = pendingChallenges.get(nodeId) || [];
                pendingChallenges.set(nodeId, []);
                if (nodes.has(nodeId)) nodes.get(nodeId).lastSeen = Date.now();
                res.end(JSON.stringify(challenges));
                return;
            }

            if (path === '/response' && req.method === 'POST') {
                const data = JSON.parse(body);
                const rtt = Date.now() - parseInt(data.challengeId.split('-')[1]);
                results.rtts.push(rtt);
                if (data.success) results.completed++;
                else results.failed++;
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            if (path === '/heartbeat' && req.method === 'POST') {
                const data = JSON.parse(body);
                if (nodes.has(data.nodeId)) nodes.get(data.nodeId).lastSeen = Date.now();
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            res.statusCode = 404;
            res.end('{}');
        } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
        }
    });
});

// ============================================================================
// SIMULATED NODES
// ============================================================================

class LocalNode {
    constructor(name) {
        this.name = name;
        this.stats = { challenges: 0, completed: 0 };
        this.registered = false;
    }

    async request(method, path, data) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: CONFIG.port,
                path,
                method,
                headers: { 'Content-Type': 'application/json' },
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { resolve(body); }
                });
            });
            req.on('error', reject);
            req.setTimeout(2000, () => { req.destroy(); reject(new Error('Timeout')); });
            if (data) req.write(JSON.stringify(data));
            req.end();
        });
    }

    async register() {
        try {
            await this.request('POST', '/register', { nodeId: this.name, timestamp: Date.now() });
            this.registered = true;
            return true;
        } catch (err) {
            return false;
        }
    }

    async poll() {
        if (!this.registered) return;

        try {
            const challenges = await this.request('GET', `/challenges/${this.name}`);
            if (Array.isArray(challenges)) {
                for (const c of challenges) {
                    this.stats.challenges++;

                    // Simulate work
                    let result = 0;
                    for (let i = 0; i < 5000; i++) result = (result * 31 + i) % 1000000007;

                    // Add realistic latency
                    await new Promise(r => setTimeout(r, 5 + Math.random() * 20));

                    this.stats.completed++;

                    await this.request('POST', '/response', {
                        challengeId: c.challengeId,
                        nodeId: this.name,
                        success: true,
                        latencyMs: 10,
                    });
                }
            }
        } catch (err) {
            // Silent
        }
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    // Start server
    await new Promise(resolve => server.listen(CONFIG.port, resolve));
    console.log(`Coordinator running on port ${CONFIG.port}`);

    // Create nodes
    const localNodes = [];
    for (let i = 0; i < CONFIG.nodeCount; i++) {
        const node = new LocalNode(`local-${i}`);
        localNodes.push(node);
    }

    // Register nodes
    console.log(`Registering ${CONFIG.nodeCount} nodes...`);
    for (const node of localNodes) {
        await node.register();
    }
    console.log(`${nodes.size} nodes registered\n`);

    // Issue challenges
    const issueChallenge = () => {
        for (const [nodeId] of nodes) {
            const challengeId = `c-${Date.now()}-${nodeId}`;
            const queue = pendingChallenges.get(nodeId) || [];
            queue.push({ challengeId, challengeType: 'work', iterations: 5000 });
            pendingChallenges.set(nodeId, queue);
            results.issued++;
        }
    };

    // Poll loop for nodes
    const pollNodes = async () => {
        await Promise.all(localNodes.map(n => n.poll()));
    };

    console.log('Starting test...\n');
    const startTime = Date.now();

    const issueInterval = setInterval(issueChallenge, CONFIG.challengeIntervalMs);
    const pollInterval = setInterval(pollNodes, 100);

    // Progress
    const progressInterval = setInterval(() => {
        const successRate = results.completed / (results.completed + results.failed) * 100 || 0;
        const avgRtt = results.rtts.length > 0
            ? results.rtts.reduce((a, b) => a + b, 0) / results.rtts.length
            : 0;
        console.log(
            `Progress: ${results.completed}/${results.issued} (${successRate.toFixed(1)}%), ` +
            `avg RTT: ${avgRtt.toFixed(1)}ms`
        );
    }, 5000);

    // Wait for test duration
    await new Promise(r => setTimeout(r, CONFIG.testDurationMs));

    clearInterval(issueInterval);
    clearInterval(pollInterval);
    clearInterval(progressInterval);

    // Final results
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('RESULTS');
    console.log('════════════════════════════════════════════════════════════════\n');

    const duration = (Date.now() - startTime) / 1000;
    const successRate = results.completed / (results.completed + results.failed) * 100 || 0;

    results.rtts.sort((a, b) => a - b);
    const p50 = results.rtts[Math.floor(results.rtts.length * 0.50)];
    const p95 = results.rtts[Math.floor(results.rtts.length * 0.95)];
    const p99 = results.rtts[Math.floor(results.rtts.length * 0.99)];

    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Nodes: ${nodes.size}`);
    console.log();
    console.log('Challenges:');
    console.log(`  Issued:    ${results.issued}`);
    console.log(`  Completed: ${results.completed} (${successRate.toFixed(1)}%)`);
    console.log();
    console.log('RTT:');
    console.log(`  P50: ${p50?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P95: ${p95?.toFixed(1) || 'N/A'}ms`);
    console.log(`  P99: ${p99?.toFixed(1) || 'N/A'}ms`);
    console.log();

    if (successRate > 95) {
        console.log('✅ Local test PASSED - ready for distributed testing\n');
    } else {
        console.log('⚠ Local test has issues - fix before distributed testing\n');
    }

    server.close();
    process.exit(0);
}

main().catch(console.error);
