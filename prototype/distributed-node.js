/**
 * Anvil Distributed Node - Phase 2
 * Runs on VPS or constrained nodes, connects to coordinator
 * 
 * Usage:
 *   node distributed-node.js --coordinator ws://YOUR_IP:8080 --name vps1
 */

import WebSocket from 'ws';

const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
};

const CONFIG = {
    coordinatorUrl: getArg('coordinator') || 'ws://localhost:8080',
    nodeName: getArg('name') || `node-${Date.now()}`,
    reconnectMs: 5000,
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL DISTRIBUTED NODE (Phase 2)                      ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Node name: ${CONFIG.nodeName}`);
console.log(`Coordinator: ${CONFIG.coordinatorUrl}`);
console.log();

// Simulated storage for data availability challenges
const storage = new Map();
for (let i = 0; i < 100; i++) {
    storage.set(`block-${i}`, Buffer.alloc(1024).fill(i % 256));
}

let ws = null;
let connected = false;
let stats = {
    challenges: 0,
    completed: 0,
    failed: 0,
};

function connect() {
    console.log(`Connecting to ${CONFIG.coordinatorUrl}...`);

    try {
        ws = new WebSocket(CONFIG.coordinatorUrl);
    } catch (err) {
        console.error('WebSocket creation failed:', err.message);
        setTimeout(connect, CONFIG.reconnectMs);
        return;
    }

    ws.on('open', () => {
        connected = true;
        console.log('✓ Connected to coordinator');

        // Register with coordinator
        ws.send(JSON.stringify({
            type: 'register',
            nodeId: CONFIG.nodeName,
            timestamp: Date.now(),
        }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handleMessage(msg);
        } catch (err) {
            console.error('Message parse error:', err.message);
        }
    });

    ws.on('close', () => {
        connected = false;
        console.log('Disconnected. Reconnecting...');
        setTimeout(connect, CONFIG.reconnectMs);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'challenge':
            handleChallenge(msg);
            break;

        case 'ping':
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: Date.now(),
                originalTimestamp: msg.timestamp,
            }));
            break;

        case 'shutdown':
            console.log('Received shutdown command');
            process.exit(0);
            break;
    }
}

function handleChallenge(challenge) {
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
                    found: storage.has(blockId),
                    hash: storage.has(blockId)
                        ? Buffer.from(storage.get(blockId)).toString('base64').slice(0, 32)
                        : null,
                };
                break;

            case 'work':
                // Bounded work
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
        console.error('Challenge error:', err.message);
    }

    const latencyMs = Date.now() - startTime;

    // Send response
    ws.send(JSON.stringify({
        type: 'challengeResponse',
        challengeId: challenge.challengeId,
        nodeId: CONFIG.nodeName,
        success,
        latencyMs,
        responseData,
        receivedAt: startTime,
        sentAt: Date.now(),
    }));
}

// Stats reporter
setInterval(() => {
    if (connected) {
        console.log(`Stats: ${stats.completed}/${stats.challenges} challenges (${stats.failed} failed)`);
    }
}, 10000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (ws) ws.close();
    process.exit(0);
});

// Start
connect();
