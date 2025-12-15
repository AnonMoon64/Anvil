/**
 * Anvil Distributed Node (No Dependencies)
 * Uses native Node.js WebSocket-like HTTP for simpler deployment
 * 
 * Usage on VPS:
 *   node node-standalone.js --coordinator http://YOUR_IP:8080 --name vps1
 */

import http from 'http';
import https from 'https';

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
};

const CONFIG = {
    coordinatorUrl: getArg('coordinator') || 'http://localhost:8080',
    nodeName: getArg('name') || `node-${Date.now()}`,
    pollIntervalMs: 500,
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL DISTRIBUTED NODE (Standalone)                   ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Node name: ${CONFIG.nodeName}`);
console.log(`Coordinator: ${CONFIG.coordinatorUrl}`);
console.log();

// Simulated storage
const storage = {};
for (let i = 0; i < 100; i++) {
    storage[`block-${i}`] = Buffer.alloc(1024).fill(i % 256).toString('base64').slice(0, 32);
}

let stats = {
    challenges: 0,
    completed: 0,
    failed: 0,
};

// Parse URL
function parseUrl(urlStr) {
    const url = new URL(urlStr);
    return {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
    };
}

// Make HTTP request
function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const urlInfo = parseUrl(CONFIG.coordinatorUrl);
        const fullPath = path.startsWith('/') ? path : `/${path}`;

        const options = {
            hostname: urlInfo.hostname,
            port: urlInfo.port,
            path: fullPath,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const client = urlInfo.protocol === 'https:' ? https : http;

        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// Register with coordinator
async function register() {
    try {
        const result = await request('POST', '/register', {
            nodeId: CONFIG.nodeName,
            timestamp: Date.now(),
        });
        console.log('✓ Registered with coordinator');
        return true;
    } catch (err) {
        console.error('Registration failed:', err.message);
        return false;
    }
}

// Poll for challenges
async function pollChallenges() {
    try {
        const challenges = await request('GET', `/challenges/${CONFIG.nodeName}`);

        if (Array.isArray(challenges) && challenges.length > 0) {
            for (const challenge of challenges) {
                await handleChallenge(challenge);
            }
        }
    } catch (err) {
        // Silent failure - coordinator might be down
    }
}

// Handle a challenge
async function handleChallenge(challenge) {
    const startTime = Date.now();
    stats.challenges++;

    let success = true;
    let responseData = null;

    try {
        switch (challenge.challengeType) {
            case 'liveness':
                responseData = { pong: true, nodeId: CONFIG.nodeName };
                break;

            case 'data':
                const blockId = `block-${challenge.blockIndex || 0}`;
                responseData = {
                    found: !!storage[blockId],
                    hash: storage[blockId] || null,
                };
                break;

            case 'work':
                let result = 0;
                const iterations = challenge.iterations || 10000;
                for (let i = 0; i < iterations; i++) {
                    result = (result * 31 + i) % 1000000007;
                }
                responseData = { result, iterations };
                break;

            default:
                responseData = { echo: challenge };
        }

        stats.completed++;
    } catch (err) {
        success = false;
        stats.failed++;
    }

    const latencyMs = Date.now() - startTime;

    // Send response
    try {
        await request('POST', '/response', {
            challengeId: challenge.challengeId,
            nodeId: CONFIG.nodeName,
            success,
            latencyMs,
            responseData,
            receivedAt: startTime,
            sentAt: Date.now(),
        });
    } catch (err) {
        console.error('Failed to send response:', err.message);
    }
}

// Heartbeat
async function heartbeat() {
    try {
        await request('POST', '/heartbeat', {
            nodeId: CONFIG.nodeName,
            stats,
            timestamp: Date.now(),
        });
    } catch (err) {
        // Silent
    }
}

// Main loop
async function main() {
    let registered = false;

    while (!registered) {
        registered = await register();
        if (!registered) {
            console.log('Retrying in 5 seconds...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    console.log('Starting challenge poll loop...\n');

    // Poll loop
    setInterval(pollChallenges, CONFIG.pollIntervalMs);

    // Heartbeat
    setInterval(heartbeat, 5000);

    // Stats reporter
    setInterval(() => {
        console.log(`Stats: ${stats.completed}/${stats.challenges} challenges (${stats.failed} failed)`);
    }, 10000);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
});

main().catch(console.error);
