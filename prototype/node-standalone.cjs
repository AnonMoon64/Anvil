/**
 * Anvil Distributed Node (Standalone - No Dependencies)
 * Copy this entire file to your VPS and run:
 *   node node-standalone.js https://your-ngrok-url.ngrok-free.dev vps1
 */

const http = require('http');
const https = require('https');

const COORDINATOR = process.argv[2] || 'http://localhost:8081';
const NAME = process.argv[3] || 'vps1';

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL DISTRIBUTED NODE (Standalone)                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('Node name:', NAME);
console.log('Coordinator:', COORDINATOR);
console.log();

// Storage simulation
const storage = {};
for (let i = 0; i < 100; i++) {
    storage['block-' + i] = Buffer.alloc(32).fill(i % 256).toString('hex');
}

let stats = { challenges: 0, completed: 0, failed: 0 };

function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const url = new URL(COORDINATOR);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'User-Agent': 'AnvilNode/1.0',
            },
        };

        const req = client.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function register() {
    try {
        const result = await request('POST', '/register', {
            nodeId: NAME,
            timestamp: Date.now(),
        });
        console.log('✓ Registered with coordinator');
        return true;
    } catch (err) {
        console.error('Registration failed:', err.message);
        return false;
    }
}

async function pollChallenges() {
    try {
        const challenges = await request('GET', '/challenges/' + NAME);

        if (Array.isArray(challenges) && challenges.length > 0) {
            for (const challenge of challenges) {
                await handleChallenge(challenge);
            }
        }
    } catch (err) {
        // Silent - coordinator might be busy
    }
}

async function handleChallenge(challenge) {
    const startTime = Date.now();
    stats.challenges++;

    let success = true;
    let responseData = null;

    try {
        switch (challenge.challengeType) {
            case 'liveness':
                responseData = { pong: true, nodeId: NAME };
                break;

            case 'data':
                const blockId = 'block-' + (challenge.blockIndex || 0);
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
                responseData = { result: result, iterations: iterations };
                break;

            default:
                responseData = { echo: challenge.challengeType };
        }

        stats.completed++;
        console.log('Challenge completed:', challenge.challengeId, '(' + (Date.now() - startTime) + 'ms)');
    } catch (err) {
        success = false;
        stats.failed++;
        console.error('Challenge failed:', err.message);
    }

    try {
        await request('POST', '/response', {
            challengeId: challenge.challengeId,
            nodeId: NAME,
            success: success,
            latencyMs: Date.now() - startTime,
            responseData: responseData,
        });
    } catch (err) {
        console.error('Failed to send response:', err.message);
    }
}

async function heartbeat() {
    try {
        await request('POST', '/heartbeat', {
            nodeId: NAME,
            stats: stats,
            timestamp: Date.now(),
        });
    } catch (err) {
        // Silent
    }
}

async function main() {
    // Register loop
    let registered = false;
    while (!registered) {
        registered = await register();
        if (!registered) {
            console.log('Retrying in 5 seconds...');
            await new Promise((r) => setTimeout(r, 5000));
        }
    }

    console.log('Starting challenge poll loop...\n');

    // Poll for challenges every 500ms
    setInterval(pollChallenges, 500);

    // Heartbeat every 5 seconds
    setInterval(heartbeat, 5000);

    // Stats every 10 seconds
    setInterval(() => {
        console.log('Stats: ' + stats.completed + '/' + stats.challenges + ' completed, ' + stats.failed + ' failed');
    }, 10000);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    process.exit(0);
});

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
