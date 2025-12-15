/**
 * Anvil P2P Node - No Coordinator
 * 
 * Features:
 * - Gossip-based peer discovery
 * - Cryptographic receipts (Ed25519 signed)
 * - Deterministic challenge assignment (hash-based)
 * - Graceful intermittency handling
 * 
 * Usage:
 *   node p2p-node.cjs <node-name> <port> [bootstrap-peer]
 *   
 *   Examples:
 *   node p2p-node.cjs node1 3001                      # First node (bootstrap)
 *   node p2p-node.cjs node2 3002 http://localhost:3001  # Join via node1
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ============================================================================
// CONFIG
// ============================================================================

const NODE_NAME = process.argv[2] || 'node-' + Date.now();
const PORT = parseInt(process.argv[3]) || 3001;
const BOOTSTRAP_PEER = process.argv[4] || null;

const CONFIG = {
    // Timing
    epochDurationMs: 5000,           // 5 second epochs
    challengeTimeoutMs: 3000,        // 3 second timeout
    gossipIntervalMs: 2000,          // Gossip peers every 2s
    heartbeatTimeoutMs: 30000,       // Consider peer dead after 30s

    // Challenge settings
    challengesPerEpoch: 3,           // Challenges to issue per epoch

    // Effectiveness
    rampConstant: 40,                // Days to ~63% effectiveness

    // Penalties
    penalties: {
        singleFailure: 0.02,
        repeated: 0.10,
        pattern: 0.30,
    },
};

// ============================================================================
// CRYPTOGRAPHIC IDENTITY
// ============================================================================

// Generate Ed25519-like keypair (using Node's crypto)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const IDENTITY = {
    name: NODE_NAME,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyHash: crypto.createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex').slice(0, 16),
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL P2P NODE (No Coordinator)                       ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Node:       ${NODE_NAME}`);
console.log(`Port:       ${PORT}`);
console.log(`Public Key: ${IDENTITY.publicKeyHash}...`);
console.log(`Bootstrap:  ${BOOTSTRAP_PEER || 'None (I am bootstrap)'}`);
console.log();

// ============================================================================
// STATE
// ============================================================================

const state = {
    // Peer registry
    peers: new Map(),      // peerId -> { url, publicKey, lastSeen, effectiveness }

    // Challenge tracking
    pendingChallenges: new Map(),   // challengeId -> { to, issuedAt, ... }
    receipts: [],                    // Signed receipts for verification

    // Local effectiveness tracking
    effectiveness: 0,
    participationDays: 0,
    failureHistory: [],

    // Epoch
    currentEpoch: 0,
    epochRandomness: null,

    // Stats
    stats: {
        challengesSent: 0,
        challengesReceived: 0,
        challengesCompleted: 0,
        challengesFailed: 0,
    },
};

// ============================================================================
// CRYPTOGRAPHIC FUNCTIONS
// ============================================================================

function signData(data) {
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const signature = crypto.sign(null, Buffer.from(dataStr), privateKey);
    return signature.toString('base64');
}

function verifySignature(data, signature, peerPublicKeyPem) {
    try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        const publicKeyObj = crypto.createPublicKey(peerPublicKeyPem);
        return crypto.verify(null, Buffer.from(dataStr), publicKeyObj, Buffer.from(signature, 'base64'));
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
// DETERMINISTIC CHALLENGE ASSIGNMENT
// ============================================================================

/**
 * Determine who should challenge whom this epoch
 * Uses epoch randomness + peer list to create verifiable assignments
 */
function computeChallengeAssignments(epochNumber, epochRandomness, peerList) {
    const assignments = [];

    if (peerList.length < 2) return assignments;

    // Sort peers deterministically
    const sortedPeers = [...peerList].sort((a, b) => a.localeCompare(b));

    for (let i = 0; i < CONFIG.challengesPerEpoch; i++) {
        // Hash(epoch || randomness || i) determines assignment
        const seed = hashData(`${epochNumber}-${epochRandomness}-${i}`);
        const seedNum = parseInt(seed.slice(0, 8), 16);

        // Pick challenger and target deterministically
        const challengerIdx = seedNum % sortedPeers.length;
        const targetIdx = (seedNum + 1 + (parseInt(seed.slice(8, 16), 16) % (sortedPeers.length - 1))) % sortedPeers.length;

        if (challengerIdx !== targetIdx) {
            assignments.push({
                challenger: sortedPeers[challengerIdx],
                target: sortedPeers[targetIdx],
                challengeId: `e${epochNumber}-c${i}-${seed.slice(0, 8)}`,
            });
        }
    }

    return assignments;
}

/**
 * Verify that a challenge assignment is correct
 */
function verifyChallengeAssignment(challengeId, challenger, target, epochNumber, epochRandomness, peerList) {
    const assignments = computeChallengeAssignments(epochNumber, epochRandomness, peerList);
    return assignments.some(a =>
        a.challengeId === challengeId &&
        a.challenger === challenger &&
        a.target === target
    );
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
            port: fullUrl.port,
            path: fullUrl.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
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
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
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
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const path = url.pathname;

        // Peer discovery
        if (path === '/peers' && req.method === 'GET') {
            const peerList = [...state.peers.entries()].map(([id, p]) => ({
                id, url: p.url, publicKeyHash: p.publicKeyHash, lastSeen: p.lastSeen,
            }));
            peerList.push({
                id: NODE_NAME,
                url: `http://localhost:${PORT}`,
                publicKeyHash: IDENTITY.publicKeyHash,
                lastSeen: Date.now(),
            });
            res.end(JSON.stringify(peerList));
            return;
        }

        // Announce self to peer
        if (path === '/announce' && req.method === 'POST') {
            const data = JSON.parse(body);
            state.peers.set(data.id, {
                url: data.url,
                publicKey: data.publicKey,
                publicKeyHash: data.publicKeyHash,
                lastSeen: Date.now(),
                effectiveness: 0,
            });
            console.log(`Peer joined: ${data.id}`);
            res.end(JSON.stringify({ ok: true, peers: state.peers.size + 1 }));
            return;
        }

        // Receive challenge
        if (path === '/challenge' && req.method === 'POST') {
            const data = JSON.parse(body);
            handleIncomingChallenge(data, res);
            return;
        }

        // Receive challenge response
        if (path === '/response' && req.method === 'POST') {
            const data = JSON.parse(body);
            handleChallengeResponse(data);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Get receipts for verification
        if (path === '/receipts' && req.method === 'GET') {
            res.end(JSON.stringify(state.receipts.slice(-100)));
            return;
        }

        // Gossip - share epoch randomness
        if (path === '/gossip' && req.method === 'POST') {
            const data = JSON.parse(body);
            handleGossip(data);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Health check
        if (path === '/health') {
            res.end(JSON.stringify({
                name: NODE_NAME,
                peers: state.peers.size,
                epoch: state.currentEpoch,
                effectiveness: state.effectiveness,
                stats: state.stats,
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

// ============================================================================
// CHALLENGE HANDLING
// ============================================================================

function handleIncomingChallenge(challenge, res) {
    const startTime = Date.now();
    state.stats.challengesReceived++;

    // Verify the challenge is correctly assigned
    const peerList = [NODE_NAME, ...state.peers.keys()];
    const isValid = verifyChallengeAssignment(
        challenge.challengeId,
        challenge.from,
        NODE_NAME,
        challenge.epoch,
        challenge.epochRandomness,
        peerList
    );

    if (!isValid) {
        console.log(`Invalid challenge assignment: ${challenge.challengeId}`);
        res.end(JSON.stringify({ error: 'Invalid assignment' }));
        return;
    }

    // Do the work
    let responseData = null;
    switch (challenge.type) {
        case 'liveness':
            responseData = { pong: true };
            break;
        case 'work':
            let result = 0;
            for (let i = 0; i < 10000; i++) result = (result * 31 + i) % 1000000007;
            responseData = { result };
            break;
        default:
            responseData = { echo: challenge.type };
    }

    // Create signed receipt
    const receipt = {
        challengeId: challenge.challengeId,
        from: challenge.from,
        to: NODE_NAME,
        epoch: challenge.epoch,
        success: true,
        latencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        responseHash: hashData(responseData),
    };

    receipt.signature = signData(receipt);

    state.stats.challengesCompleted++;

    res.end(JSON.stringify({
        receipt,
        publicKey: IDENTITY.publicKey,
    }));
}

function handleChallengeResponse(data) {
    const { receipt, publicKey } = data;
    const pending = state.pendingChallenges.get(receipt.challengeId);

    if (!pending) return;

    // Verify signature
    const signatureValid = verifySignature(
        { ...receipt, signature: undefined },
        receipt.signature,
        publicKey
    );

    if (!signatureValid) {
        console.log(`Invalid signature on receipt: ${receipt.challengeId}`);
        return;
    }

    // Store verified receipt
    state.receipts.push({
        ...receipt,
        verifiedBy: NODE_NAME,
        verifiedAt: Date.now(),
    });

    state.pendingChallenges.delete(receipt.challengeId);
    console.log(`Receipt verified: ${receipt.challengeId} (${receipt.latencyMs}ms)`);
}

// ============================================================================
// GOSSIP & PEER MANAGEMENT
// ============================================================================

function handleGossip(data) {
    // Update epoch randomness if newer
    if (data.epoch > state.currentEpoch ||
        (data.epoch === state.currentEpoch && !state.epochRandomness)) {
        state.currentEpoch = data.epoch;
        state.epochRandomness = data.epochRandomness;
    }

    // Learn about new peers
    if (data.peers) {
        for (const peer of data.peers) {
            if (peer.id !== NODE_NAME && !state.peers.has(peer.id)) {
                state.peers.set(peer.id, {
                    url: peer.url,
                    publicKeyHash: peer.publicKeyHash,
                    lastSeen: Date.now(),
                    effectiveness: 0,
                });
                console.log(`Discovered peer via gossip: ${peer.id}`);
            }
        }
    }
}

async function gossipToPeers() {
    const gossipData = {
        from: NODE_NAME,
        epoch: state.currentEpoch,
        epochRandomness: state.epochRandomness,
        peers: [{ id: NODE_NAME, url: `http://localhost:${PORT}`, publicKeyHash: IDENTITY.publicKeyHash }],
    };

    for (const [peerId, peer] of state.peers) {
        try {
            await request(peer.url, 'POST', '/gossip', gossipData);
            peer.lastSeen = Date.now();
        } catch (err) {
            // Check if peer is dead
            if (Date.now() - peer.lastSeen > CONFIG.heartbeatTimeoutMs) {
                console.log(`Peer timed out: ${peerId}`);
                state.peers.delete(peerId);
            }
        }
    }
}

// ============================================================================
// EPOCH LOOP
// ============================================================================

async function runEpoch() {
    state.currentEpoch++;

    // Generate epoch randomness (in real network, this comes from chain)
    // For now, we use a hash of epoch + all peer public keys
    const peerKeys = [...state.peers.values()].map(p => p.publicKeyHash).sort().join('');
    state.epochRandomness = hashData(`epoch-${state.currentEpoch}-${peerKeys}-${IDENTITY.publicKeyHash}`);

    // Compute challenge assignments
    const peerList = [NODE_NAME, ...state.peers.keys()];
    const assignments = computeChallengeAssignments(state.currentEpoch, state.epochRandomness, peerList);

    // Issue challenges where I am the challenger
    for (const assignment of assignments) {
        if (assignment.challenger === NODE_NAME && state.peers.has(assignment.target)) {
            const peer = state.peers.get(assignment.target);

            const challenge = {
                challengeId: assignment.challengeId,
                from: NODE_NAME,
                to: assignment.target,
                type: 'work',
                epoch: state.currentEpoch,
                epochRandomness: state.epochRandomness,
                issuedAt: Date.now(),
            };

            state.pendingChallenges.set(challenge.challengeId, challenge);
            state.stats.challengesSent++;

            try {
                const response = await request(peer.url, 'POST', '/challenge', challenge);
                if (response.receipt) {
                    handleChallengeResponse(response);
                }
            } catch (err) {
                console.log(`Challenge failed to ${assignment.target}: ${err.message}`);
                state.stats.challengesFailed++;
            }
        }
    }

    // Update effectiveness
    if (state.stats.challengesCompleted > 0) {
        state.participationDays += CONFIG.epochDurationMs / (24 * 60 * 60 * 1000);
        state.effectiveness = 1 - Math.exp(-state.participationDays / CONFIG.rampConstant);
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    // Start server
    await new Promise(resolve => server.listen(PORT, resolve));
    console.log(`Listening on port ${PORT}\n`);

    // Bootstrap - join existing network
    if (BOOTSTRAP_PEER) {
        try {
            // Announce ourselves
            await request(BOOTSTRAP_PEER, 'POST', '/announce', {
                id: NODE_NAME,
                url: `http://localhost:${PORT}`,
                publicKey: IDENTITY.publicKey,
                publicKeyHash: IDENTITY.publicKeyHash,
            });
            console.log(`Announced to bootstrap peer`);

            // Get peer list
            const peers = await request(BOOTSTRAP_PEER, 'GET', '/peers');
            for (const peer of peers) {
                if (peer.id !== NODE_NAME) {
                    state.peers.set(peer.id, {
                        url: peer.url,
                        publicKeyHash: peer.publicKeyHash,
                        lastSeen: Date.now(),
                        effectiveness: 0,
                    });
                }
            }
            console.log(`Discovered ${state.peers.size} peers\n`);
        } catch (err) {
            console.error(`Bootstrap failed: ${err.message}`);
        }
    }

    // Start gossip
    setInterval(gossipToPeers, CONFIG.gossipIntervalMs);

    // Start epoch loop
    setInterval(runEpoch, CONFIG.epochDurationMs);

    // Status report
    setInterval(() => {
        console.log(
            `Epoch ${state.currentEpoch}: ` +
            `peers=${state.peers.size}, ` +
            `sent=${state.stats.challengesSent}, ` +
            `recv=${state.stats.challengesReceived}, ` +
            `receipts=${state.receipts.length}, ` +
            `eff=${(state.effectiveness * 100).toFixed(1)}%`
        );
    }, 10000);

    console.log('P2P node running. Waiting for peers...\n');
}

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close();
    process.exit(0);
});

main().catch(console.error);
