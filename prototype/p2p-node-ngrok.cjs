/**
 * Anvil P2P Node (ngrok compatible)
 * 
 * For distributed testing across internet with ngrok tunnels.
 * Each node needs its own ngrok tunnel and must know its public URL.
 * 
 * Usage:
 *   node p2p-node-ngrok.cjs <node-name> <local-port> <my-public-url> [bootstrap-peer-url]
 *   
 *   Examples:
 *   # First node (bootstrap) - on your laptop with ngrok
 *   ngrok http 3001
 *   node p2p-node-ngrok.cjs laptop 3001 https://abc123.ngrok-free.dev
 *   
 *   # VPS node joining - needs its own ngrok or public IP
 *   node p2p-node-ngrok.cjs vps1 3001 https://vps-public-url https://abc123.ngrok-free.dev
 *   
 *   # base44 node joining
 *   node p2p-node-ngrok.cjs base44 3001 https://base44-url https://abc123.ngrok-free.dev
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ============================================================================
// CONFIG
// ============================================================================

const NODE_NAME = process.argv[2] || 'node-' + Date.now();
const LOCAL_PORT = parseInt(process.argv[3]) || 3001;
const MY_PUBLIC_URL = process.argv[4] || `http://localhost:${LOCAL_PORT}`;
const BOOTSTRAP_PEER = process.argv[5] || null;

const CONFIG = {
    epochDurationMs: 5000,
    challengeTimeoutMs: 4000,
    gossipIntervalMs: 3000,
    heartbeatTimeoutMs: 60000,        // 60s timeout for internet
    challengesPerEpoch: 2,
    rampConstant: 40,
};

// ============================================================================
// CRYPTOGRAPHIC IDENTITY
// ============================================================================

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const IDENTITY = {
    name: NODE_NAME,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyHash: crypto.createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex').slice(0, 16),
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL P2P NODE (ngrok compatible)                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Node:       ${NODE_NAME}`);
console.log(`Local Port: ${LOCAL_PORT}`);
console.log(`Public URL: ${MY_PUBLIC_URL}`);
console.log(`Public Key: ${IDENTITY.publicKeyHash}...`);
console.log(`Bootstrap:  ${BOOTSTRAP_PEER || 'None (I am bootstrap)'}`);
console.log();

// ============================================================================
// STATE
// ============================================================================

const state = {
    peers: new Map(),
    pendingChallenges: new Map(),
    receipts: [],
    effectiveness: 0,
    participationDays: 0,
    failureHistory: [],
    currentEpoch: 0,
    epochRandomness: null,
    stats: {
        challengesSent: 0,
        challengesReceived: 0,
        challengesCompleted: 0,
        challengesFailed: 0,
    },
};

// ============================================================================
// CRYPTO
// ============================================================================

function signData(data) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.sign(null, Buffer.from(dataStr), privateKey).toString('base64');
}

function verifySignature(data, signature, peerPublicKeyPem) {
    try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        const pubKey = crypto.createPublicKey(peerPublicKeyPem);
        return crypto.verify(null, Buffer.from(dataStr), pubKey, Buffer.from(signature, 'base64'));
    } catch (err) {
        return false;
    }
}

function hashData(data) {
    return crypto.createHash('sha256')
        .update(typeof data === 'string' ? data : JSON.stringify(data))
        .digest('hex');
}

// ============================================================================
// DETERMINISTIC ASSIGNMENT
// ============================================================================

function computeChallengeAssignments(epoch, randomness, peerList) {
    const assignments = [];
    if (peerList.length < 2) return assignments;

    const sorted = [...peerList].sort();

    for (let i = 0; i < CONFIG.challengesPerEpoch; i++) {
        const seed = hashData(`${epoch}-${randomness}-${i}`);
        const n1 = parseInt(seed.slice(0, 8), 16);
        const n2 = parseInt(seed.slice(8, 16), 16);

        const challenger = sorted[n1 % sorted.length];
        const target = sorted[(n1 + 1 + (n2 % (sorted.length - 1))) % sorted.length];

        if (challenger !== target) {
            assignments.push({
                challenger, target,
                challengeId: `e${epoch}-c${i}-${seed.slice(0, 8)}`,
            });
        }
    }

    return assignments;
}

// ============================================================================
// NETWORKING
// ============================================================================

function request(url, method, path, data) {
    return new Promise((resolve, reject) => {
        const fullUrl = new URL(path, url);
        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const req = client.request({
            hostname: fullUrl.hostname,
            port: fullUrl.port || (isHttps ? 443 : 80),
            path: fullUrl.pathname,
            method,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'User-Agent': 'AnvilP2P/1.0',
            },
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { resolve(body); }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

// ============================================================================
// HTTP SERVER
// ============================================================================

const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => handleRequest(req, res, body));
});

function handleRequest(req, res, body) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const url = new URL(req.url, `http://localhost:${LOCAL_PORT}`);
        const path = url.pathname;

        if (path === '/peers' && req.method === 'GET') {
            const peerList = [...state.peers.entries()].map(([id, p]) => ({
                id, url: p.url, publicKeyHash: p.publicKeyHash,
            }));
            peerList.push({ id: NODE_NAME, url: MY_PUBLIC_URL, publicKeyHash: IDENTITY.publicKeyHash });
            res.end(JSON.stringify(peerList));
            return;
        }

        if (path === '/announce' && req.method === 'POST') {
            const data = JSON.parse(body);
            state.peers.set(data.id, {
                url: data.url,
                publicKey: data.publicKey,
                publicKeyHash: data.publicKeyHash,
                lastSeen: Date.now(),
            });
            console.log(`✓ Peer joined: ${data.id} (${data.url})`);
            res.end(JSON.stringify({ ok: true, peers: state.peers.size + 1 }));
            return;
        }

        if (path === '/challenge' && req.method === 'POST') {
            handleChallenge(JSON.parse(body), res);
            return;
        }

        if (path === '/gossip' && req.method === 'POST') {
            handleGossip(JSON.parse(body));
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (path === '/receipts' && req.method === 'GET') {
            res.end(JSON.stringify(state.receipts.slice(-50)));
            return;
        }

        if (path === '/health') {
            res.end(JSON.stringify({
                name: NODE_NAME,
                url: MY_PUBLIC_URL,
                peers: state.peers.size,
                epoch: state.currentEpoch,
                stats: state.stats,
                receipts: state.receipts.length,
            }));
            return;
        }

        res.statusCode = 404;
        res.end('{}');
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// ============================================================================
// CHALLENGE HANDLING
// ============================================================================

function handleChallenge(challenge, res) {
    const start = Date.now();
    state.stats.challengesReceived++;

    // Do work
    let result = 0;
    for (let i = 0; i < 10000; i++) result = (result * 31 + i) % 1000000007;

    const receipt = {
        challengeId: challenge.challengeId,
        from: challenge.from,
        to: NODE_NAME,
        epoch: challenge.epoch,
        success: true,
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
        result,
    };

    receipt.signature = signData({ ...receipt, signature: undefined });

    state.stats.challengesCompleted++;
    console.log(`Challenge completed: ${challenge.challengeId} (${receipt.latencyMs}ms)`);

    res.end(JSON.stringify({ receipt, publicKey: IDENTITY.publicKey }));
}

function handleGossip(data) {
    if (data.epoch > state.currentEpoch) {
        state.currentEpoch = data.epoch;
        state.epochRandomness = data.epochRandomness;
    }

    if (data.peers) {
        for (const peer of data.peers) {
            if (peer.id !== NODE_NAME && !state.peers.has(peer.id)) {
                state.peers.set(peer.id, {
                    url: peer.url,
                    publicKeyHash: peer.publicKeyHash,
                    lastSeen: Date.now(),
                });
                console.log(`Discovered via gossip: ${peer.id}`);
            }
        }
    }

    // Update peer lastSeen
    if (data.from && state.peers.has(data.from)) {
        state.peers.get(data.from).lastSeen = Date.now();
    }
}

// ============================================================================
// GOSSIP
// ============================================================================

async function gossip() {
    const msg = {
        from: NODE_NAME,
        epoch: state.currentEpoch,
        epochRandomness: state.epochRandomness,
        peers: [{ id: NODE_NAME, url: MY_PUBLIC_URL, publicKeyHash: IDENTITY.publicKeyHash }],
    };

    for (const [id, peer] of state.peers) {
        try {
            await request(peer.url, 'POST', '/gossip', msg);
            peer.lastSeen = Date.now();
        } catch (err) {
            if (Date.now() - peer.lastSeen > CONFIG.heartbeatTimeoutMs) {
                console.log(`Peer timed out: ${id}`);
                state.peers.delete(id);
            }
        }
    }
}

// ============================================================================
// EPOCH
// ============================================================================

async function runEpoch() {
    state.currentEpoch++;

    const keys = [...state.peers.values()].map(p => p.publicKeyHash || '').sort().join('');
    state.epochRandomness = hashData(`e${state.currentEpoch}-${keys}-${IDENTITY.publicKeyHash}`);

    const peerList = [NODE_NAME, ...state.peers.keys()];
    const assignments = computeChallengeAssignments(state.currentEpoch, state.epochRandomness, peerList);

    for (const a of assignments) {
        if (a.challenger === NODE_NAME && state.peers.has(a.target)) {
            const peer = state.peers.get(a.target);

            const challenge = {
                challengeId: a.challengeId,
                from: NODE_NAME,
                to: a.target,
                type: 'work',
                epoch: state.currentEpoch,
                epochRandomness: state.epochRandomness,
            };

            state.stats.challengesSent++;

            try {
                const response = await request(peer.url, 'POST', '/challenge', challenge);
                if (response.receipt) {
                    // Verify signature
                    const valid = verifySignature(
                        { ...response.receipt, signature: undefined },
                        response.receipt.signature,
                        response.publicKey
                    );

                    if (valid) {
                        state.receipts.push({ ...response.receipt, verified: true });
                        console.log(`✓ Receipt verified: ${response.receipt.challengeId}`);
                    } else {
                        console.log(`✗ Invalid signature: ${response.receipt.challengeId}`);
                        state.stats.challengesFailed++;
                    }
                }
            } catch (err) {
                console.log(`Challenge to ${a.target} failed: ${err.message}`);
                state.stats.challengesFailed++;
            }
        }
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    await new Promise(r => server.listen(LOCAL_PORT, r));
    console.log(`Listening on port ${LOCAL_PORT}\n`);

    if (BOOTSTRAP_PEER) {
        try {
            await request(BOOTSTRAP_PEER, 'POST', '/announce', {
                id: NODE_NAME,
                url: MY_PUBLIC_URL,
                publicKey: IDENTITY.publicKey,
                publicKeyHash: IDENTITY.publicKeyHash,
            });
            console.log('Announced to bootstrap');

            const peers = await request(BOOTSTRAP_PEER, 'GET', '/peers');
            for (const p of peers) {
                if (p.id !== NODE_NAME) {
                    state.peers.set(p.id, { url: p.url, publicKeyHash: p.publicKeyHash, lastSeen: Date.now() });
                }
            }
            console.log(`Discovered ${state.peers.size} peers\n`);
        } catch (err) {
            console.error('Bootstrap failed:', err.message);
        }
    }

    setInterval(gossip, CONFIG.gossipIntervalMs);
    setInterval(runEpoch, CONFIG.epochDurationMs);

    setInterval(() => {
        const successRate = state.stats.challengesSent > 0
            ? (state.stats.challengesSent - state.stats.challengesFailed) / state.stats.challengesSent * 100
            : 0;
        console.log(
            `[Epoch ${state.currentEpoch}] ` +
            `peers=${state.peers.size} ` +
            `sent=${state.stats.challengesSent} ` +
            `recv=${state.stats.challengesReceived} ` +
            `receipts=${state.receipts.length} ` +
            `success=${successRate.toFixed(0)}%`
        );
    }, 15000);

    console.log('P2P node running.\n');
}

process.on('SIGINT', () => { console.log('\nShutdown'); server.close(); process.exit(0); });

main().catch(console.error);
