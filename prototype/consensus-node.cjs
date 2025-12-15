/**
 * Anvil Consensus Node
 * 
 * Full blockchain node with:
 * - Leader-based BFT consensus
 * - Block production and voting
 * - Transaction support
 * - Effectiveness tracking
 * - Receipt verification
 * 
 * Usage:
 *   node consensus-node.cjs <name> <port> <public-url> [bootstrap]
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const { detectConnectivity, createAnnouncement } = require('./connectivity.cjs');

// ============================================================================
// CONFIG
// ============================================================================

const NODE_NAME = process.argv[2] || 'node-' + Date.now();
const LOCAL_PORT = parseInt(process.argv[3]) || 3001;
const MY_PUBLIC_URL = process.argv[4] || `http://localhost:${LOCAL_PORT}`;
const BOOTSTRAP_PEER = process.argv[5] || null;
const DATA_DIR = `./data-${NODE_NAME}`;

const CONFIG = {
    // Timing
    epochDurationMs: 10000,          // 10 second epochs (blocks)
    voteTimeoutMs: 5000,             // 5 seconds to collect votes
    gossipIntervalMs: 3000,
    heartbeatTimeoutMs: 60000,
    viewChangeTimeoutMs: 8000,       // If leader doesn't propose in 8s, trigger view change

    // Consensus
    quorumFraction: 0.67,            // 2/3 for BFT

    // Challenges
    challengesPerEpoch: 2,

    // Economics
    rewardPerEpoch: 100,             // Tokens distributed per epoch
    slashAmount: 500,                // Penalty for Byzantine behavior

    // Effectiveness
    rampConstant: 40,                // Days to ~63% effectiveness
    decayConstant: 7,                // Days to ~37% remaining when offline
};

// ============================================================================
// CRYPTOGRAPHIC IDENTITY
// ============================================================================

// Load or generate keypair
let publicKey, privateKey;
const keyPath = `${DATA_DIR}/keypair.json`;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadOrGenerateKeys() {
    ensureDataDir();

    if (fs.existsSync(keyPath)) {
        const data = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        publicKey = crypto.createPublicKey(data.publicKey);
        privateKey = crypto.createPrivateKey(data.privateKey);
        console.log('Loaded existing keypair');
    } else {
        const pair = crypto.generateKeyPairSync('ed25519');
        publicKey = pair.publicKey;
        privateKey = pair.privateKey;

        fs.writeFileSync(keyPath, JSON.stringify({
            publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
            privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        }));
        console.log('Generated new keypair');
    }
}

loadOrGenerateKeys();

const IDENTITY = {
    name: NODE_NAME,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    publicKeyHash: crypto.createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex').slice(0, 40),
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║        ANVIL CONSENSUS NODE                                  ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log(`Node:       ${NODE_NAME}`);
console.log(`Port:       ${LOCAL_PORT}`);
console.log(`Public URL: ${MY_PUBLIC_URL}`);
console.log(`Public Key: ${IDENTITY.publicKeyHash}...`);
console.log(`Data Dir:   ${DATA_DIR}`);
console.log(`Bootstrap:  ${BOOTSTRAP_PEER || 'None (genesis node)'}`);
console.log();

// ============================================================================
// CRYPTO FUNCTIONS
// ============================================================================

function sign(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.sign(null, Buffer.from(str), privateKey).toString('base64');
}

function verify(data, signature, peerPublicKeyPem) {
    try {
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        const pubKey = crypto.createPublicKey(peerPublicKeyPem);
        return crypto.verify(null, Buffer.from(str), pubKey, Buffer.from(signature, 'base64'));
    } catch { return false; }
}

function hash(data) {
    return crypto.createHash('sha256')
        .update(typeof data === 'string' ? data : JSON.stringify(data))
        .digest('hex');
}

// Merkle tree for SPV light wallet support
function calculateMerkleRoot(hashes) {
    if (hashes.length === 0) return '0'.repeat(64);
    if (hashes.length === 1) return hashes[0];

    const nextLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
        const left = hashes[i];
        const right = hashes[i + 1] || left; // Duplicate last if odd
        nextLevel.push(hash(left + right));
    }

    return calculateMerkleRoot(nextLevel);
}

// Calculate state root from balances/nonces
function calculateStateRoot(balances, nonces) {
    const entries = [];

    // Include existing accounts from state
    for (const [addr, account] of state.accounts) {
        const balance = balances.has(addr) ? balances.get(addr) : account.balance;
        const nonce = nonces.has(addr) ? nonces.get(addr) : account.nonce;
        entries.push(`${addr}:${balance}:${nonce}`);
    }

    // Include new accounts from temp state
    for (const [addr, balance] of balances) {
        if (!state.accounts.has(addr)) {
            const nonce = nonces.get(addr) || 0;
            entries.push(`${addr}:${balance}:${nonce}`);
        }
    }

    entries.sort();
    return hash(entries.join(','));
}

// Get Merkle proof for a transaction (for light wallets)
function getMerkleProof(block, txHash) {
    const txHashes = block.transactions.map(tx => hash(tx));
    const index = txHashes.indexOf(txHash);
    if (index === -1) return null;

    const proof = [];
    let level = txHashes;
    let idx = index;

    while (level.length > 1) {
        const sibling = idx % 2 === 0 ? level[idx + 1] || level[idx] : level[idx - 1];
        proof.push({ hash: sibling, isLeft: idx % 2 === 1 });

        const nextLevel = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = level[i + 1] || left;
            nextLevel.push(hash(left + right));
        }
        level = nextLevel;
        idx = Math.floor(idx / 2);
    }

    return proof;
}

// Verify a Merkle proof
function verifyMerkleProof(txHash, proof, root) {
    let current = txHash;
    for (const { hash: sibling, isLeft } of proof) {
        current = isLeft ? hash(sibling + current) : hash(current + sibling);
    }
    return current === root;
}

// ============================================================================
// STATE
// ============================================================================

const state = {
    // Peer registry: peerId -> { url, publicKeyPem, publicKeyHash, lastSeen, effectiveness }
    peers: new Map(),

    // Blockchain
    chain: [],                       // Array of committed blocks
    pendingReceipts: [],             // Receipts waiting to be included
    pendingTransactions: [],         // Transactions waiting to be included

    // Accounts: address (pubKeyHash) -> { balance, nonce }
    accounts: new Map(),

    // Current epoch
    currentEpoch: 0,
    epochRandomness: null,
    epochStartTime: 0,               // When this epoch started
    currentView: 0,                  // View number (increments on leader failure)

    // Voting state
    proposedBlock: null,
    votes: new Map(),                // peerId -> signature
    viewChangeVotes: new Map(),      // For view change consensus

    // Equivocation detection
    seenProposals: new Map(),        // epoch -> { hash -> block } - detect conflicting proposals
    slashedNodes: new Set(),         // Addresses that have been slashed

    // My effectiveness
    effectiveness: 0,
    participationDays: 0,
    lastOnlineEpoch: 0,

    // Stats
    stats: {
        blocksProduced: 0,
        blocksCommitted: 0,
        challengesSent: 0,
        challengesReceived: 0,
        receiptsVerified: 0,
        viewChanges: 0,
        slashEvents: 0,
    },

    // Connectivity (set during startup)
    connectivity: {
        mode: 'unknown',
        reachable: false,
        endpoints: [],
        supportsRelay: true,
    },
};

// ============================================================================
// BLOCK STRUCTURE
// ============================================================================

/**
 * Block:
 * {
 *   epoch: number,
 *   previousHash: string,
 *   leader: string (node name),
 *   leaderPubKey: string,
 *   timestamp: number,
 *   
 *   receipts: Receipt[],           // Challenge completions this epoch
 *   transactions: Transaction[],   // Token transfers
 *   effectivenessUpdates: {},      // nodeId -> new effectiveness
 *   rewards: {},                   // nodeId -> tokens earned
 *   
 *   hash: string,
 *   leaderSignature: string,
 *   votes: { nodeId: signature }   // Validator votes
 * }
 */

function createBlock(epoch, receipts, transactions) {
    const previousHash = state.chain.length > 0
        ? state.chain[state.chain.length - 1].hash
        : '0'.repeat(64);

    // Calculate effectiveness updates
    const effectivenessUpdates = calculateEffectivenessUpdates(receipts);

    // Calculate rewards
    const rewards = calculateRewards(effectivenessUpdates);

    // Filter valid transactions - apply sequentially to catch double-spends
    const validTxs = [];
    const tempBalances = new Map(); // Track balance changes during validation
    const tempNonces = new Map();   // Track nonce changes during validation

    for (const tx of transactions) {
        // Special handling for coinbase (faucet) transactions
        if (tx.from === 'coinbase') {
            // Coinbase can create money - just add to recipient
            const toBalance = tempBalances.has(tx.to)
                ? tempBalances.get(tx.to)
                : (state.accounts.get(tx.to) || { balance: 0 }).balance;
            tempBalances.set(tx.to, toBalance + tx.amount);
            validTxs.push(tx);
            continue;
        }

        const account = state.accounts.get(tx.from) || { balance: 0, nonce: 0 };
        const currentBalance = tempBalances.has(tx.from)
            ? tempBalances.get(tx.from)
            : account.balance;
        const currentNonce = tempNonces.has(tx.from)
            ? tempNonces.get(tx.from)
            : account.nonce;

        // Check balance
        if (currentBalance < tx.amount) {
            console.log(`Tx rejected: insufficient balance (${currentBalance} < ${tx.amount})`);
            continue;
        }

        // Check nonce (must be exactly next)
        if (tx.nonce !== currentNonce + 1) {
            console.log(`Tx rejected: bad nonce (expected ${currentNonce + 1}, got ${tx.nonce})`);
            continue;
        }

        // Valid - update temp state
        tempBalances.set(tx.from, currentBalance - tx.amount);
        tempNonces.set(tx.from, tx.nonce);

        const toBalance = tempBalances.has(tx.to)
            ? tempBalances.get(tx.to)
            : (state.accounts.get(tx.to) || { balance: 0 }).balance;
        tempBalances.set(tx.to, toBalance + tx.amount);

        validTxs.push(tx);
    }

    // Calculate Merkle roots for SPV verification
    const txRoot = calculateMerkleRoot(validTxs.map(tx => hash(tx)));
    const receiptRoot = calculateMerkleRoot(receipts.map(r => hash(r)));
    const stateRoot = calculateStateRoot(tempBalances, tempNonces);

    const block = {
        epoch,
        previousHash,
        leader: NODE_NAME,
        leaderPubKey: IDENTITY.publicKeyPem,
        timestamp: Date.now(),

        // Merkle roots (for light wallet verification)
        txRoot,
        receiptRoot,
        stateRoot,

        // Full data (can be pruned for light sync)
        receipts,
        transactions: validTxs,
        effectivenessUpdates,
        rewards,
    };

    block.hash = hash(block);
    block.leaderSignature = sign(block.hash);
    block.votes = {};


    return block;
}

function calculateEffectivenessUpdates(receipts) {
    const updates = {};

    // Build map of nodeId -> address
    const nodeAddresses = new Map();
    nodeAddresses.set(NODE_NAME, IDENTITY.publicKeyHash);
    for (const [nodeId, peer] of state.peers) {
        if (peer.publicKeyHash) {
            nodeAddresses.set(nodeId, peer.publicKeyHash);
        }
    }

    // Get current effectiveness for all known nodes
    const allNodes = [NODE_NAME, ...state.peers.keys()];

    for (const nodeId of allNodes) {
        const addr = nodeAddresses.get(nodeId);
        if (!addr) continue;

        let eff = 0;

        // Check if node completed challenges this epoch
        const nodeReceipts = receipts.filter(r => r.to === nodeId && r.success);
        const wasOnline = nodeReceipts.length > 0;

        if (wasOnline) {
            // Ramp up
            const peer = state.peers.get(nodeId);
            const currentEff = peer?.effectiveness || (nodeId === NODE_NAME ? state.effectiveness : 0);
            const days = 1 / 144; // Assuming 10-second epochs, ~144 epochs/day
            eff = 1 - (1 - currentEff) * Math.exp(-days / CONFIG.rampConstant);
        } else {
            // Decay
            const peer = state.peers.get(nodeId);
            const currentEff = peer?.effectiveness || (nodeId === NODE_NAME ? state.effectiveness : 0);
            const days = 1 / 144;
            eff = currentEff * Math.exp(-days / CONFIG.decayConstant);
        }

        // Key by ADDRESS, not node name
        updates[addr] = Math.max(0, Math.min(1, eff));
    }

    return updates;
}

function calculateRewards(effectivenessUpdates) {
    const rewards = {};

    // Sum of all effectiveness (now keyed by address)
    const totalEff = Object.values(effectivenessUpdates).reduce((a, b) => a + b, 0);

    if (totalEff === 0) return rewards;

    // Distribute rewards proportionally (keyed by address)
    for (const [addr, eff] of Object.entries(effectivenessUpdates)) {
        if (eff > 0) {
            rewards[addr] = (eff / totalEff) * CONFIG.rewardPerEpoch;
        }
    }

    return rewards;
}

function validateBlock(block) {
    // Check previous hash
    const expectedPrev = state.chain.length > 0
        ? state.chain[state.chain.length - 1].hash
        : '0'.repeat(64);

    if (block.previousHash !== expectedPrev) {
        console.log('Block rejected: invalid previous hash');
        return false;
    }

    // Check leader is correct for this epoch
    const expectedLeader = electLeader(block.epoch);
    if (block.leader !== expectedLeader) {
        console.log(`Block rejected: wrong leader (expected ${expectedLeader}, got ${block.leader})`);
        return false;
    }

    // Verify leader signature
    const blockData = { ...block, hash: undefined, leaderSignature: undefined, votes: undefined };
    const expectedHash = hash(blockData);

    if (block.hash !== expectedHash) {
        console.log('Block rejected: hash mismatch');
        return false;
    }

    const leaderPubKey = block.leaderPubKey;
    if (!verify(block.hash, block.leaderSignature, leaderPubKey)) {
        console.log('Block rejected: invalid leader signature');
        return false;
    }

    // Validate transactions
    for (const tx of block.transactions) {
        if (!validateTransaction(tx)) {
            console.log('Block rejected: invalid transaction');
            return false;
        }
    }

    return true;
}

function commitBlock(block) {
    state.chain.push(block);

    // Apply effectiveness updates (now keyed by address)
    for (const [addr, eff] of Object.entries(block.effectivenessUpdates)) {
        if (addr === IDENTITY.publicKeyHash) {
            state.effectiveness = eff;
        }
        // Also update peer effectiveness by finding peer with this address
        for (const [peerId, peer] of state.peers) {
            if (peer.publicKeyHash === addr) {
                peer.effectiveness = eff;
            }
        }
    }

    // Apply rewards (now keyed by address directly)
    for (const [addr, reward] of Object.entries(block.rewards)) {
        if (!state.accounts.has(addr)) {
            state.accounts.set(addr, { balance: 0, nonce: 0 });
        }
        state.accounts.get(addr).balance += reward;
    }

    // Apply transactions
    for (const tx of block.transactions) {
        applyTransaction(tx);
    }

    // Clear pending items that were included
    const includedReceiptIds = new Set(block.receipts.map(r => r.challengeId));
    state.pendingReceipts = state.pendingReceipts.filter(r => !includedReceiptIds.has(r.challengeId));

    const includedTxHashes = new Set(block.transactions.map(t => hash(t)));
    state.pendingTransactions = state.pendingTransactions.filter(t => !includedTxHashes.has(hash(t)));

    state.stats.blocksCommitted++;

    // Persist chain
    saveChain();

    console.log(`✓ Block ${block.epoch} committed (${block.receipts.length} receipts, ${block.transactions.length} txs)`);
}

// ============================================================================
// LEADER ELECTION
// ============================================================================

function electLeader(epoch) {
    // Deterministic leader election based on epoch + view + peer list
    const allNodes = [NODE_NAME, ...state.peers.keys()].sort();

    if (allNodes.length === 0) return NODE_NAME;

    // Hash epoch + view to get index (view change rotates leader)
    const epochHash = hash(`epoch-${epoch}-view-${state.currentView}`);
    const index = parseInt(epochHash.slice(0, 8), 16) % allNodes.length;

    return allNodes[index];
}

function amILeader(epoch) {
    return electLeader(epoch) === NODE_NAME;
}

// ============================================================================
// BFT HARDENING
// ============================================================================

/**
 * View Change: If leader doesn't propose within timeout, increment view
 * This rotates leadership to a new node
 */
function checkViewChange() {
    const elapsed = Date.now() - state.epochStartTime;

    // If we haven't received a proposal and timeout exceeded
    if (!state.proposedBlock && elapsed > CONFIG.viewChangeTimeoutMs) {
        const oldView = state.currentView;
        state.currentView++;
        state.viewChangeVotes.clear();
        state.stats.viewChanges++;

        const newLeader = electLeader(state.currentEpoch);
        console.log(`⚠ View change ${oldView} → ${state.currentView} (new leader: ${newLeader})`);

        // Broadcast view change to peers
        broadcast('/view-change', {
            epoch: state.currentEpoch,
            oldView,
            newView: state.currentView,
            from: NODE_NAME,
            signature: sign({ epoch: state.currentEpoch, view: state.currentView }),
        });

        return true;
    }
    return false;
}

/**
 * Equivocation Detection: Detect if leader proposes multiple conflicting blocks
 * This is evidence of Byzantine behavior that should be slashed
 */
function checkEquivocation(block) {
    const epochKey = block.epoch;

    if (!state.seenProposals.has(epochKey)) {
        state.seenProposals.set(epochKey, new Map());
    }

    const epochProposals = state.seenProposals.get(epochKey);

    // Check if we've seen a different block from this leader for this epoch
    for (const [existingHash, existingBlock] of epochProposals) {
        if (existingBlock.leader === block.leader && existingHash !== block.hash) {
            // EQUIVOCATION DETECTED!
            console.log(`🚨 EQUIVOCATION: ${block.leader} proposed conflicting blocks for epoch ${epochKey}`);

            return {
                detected: true,
                evidence: {
                    block1: existingBlock,
                    block2: block,
                    leader: block.leader,
                    epoch: epochKey,
                }
            };
        }
    }

    // Store this proposal
    epochProposals.set(block.hash, block);

    // Cleanup old epochs (keep last 10)
    if (state.seenProposals.size > 10) {
        const oldestEpoch = Math.min(...state.seenProposals.keys());
        state.seenProposals.delete(oldestEpoch);
    }

    return { detected: false };
}

/**
 * Slashing: Penalize Byzantine nodes
 */
function slashNode(leaderPubKey, evidence) {
    // Get leader's address from their public key
    let addr;
    try {
        const pubKey = crypto.createPublicKey(leaderPubKey);
        addr = crypto.createHash('sha256')
            .update(pubKey.export({ type: 'spki', format: 'der' }))
            .digest('hex').slice(0, 40);
    } catch {
        console.log('Could not derive address for slashing');
        return;
    }

    // Don't slash same node twice
    if (state.slashedNodes.has(addr)) {
        return;
    }

    state.slashedNodes.add(addr);
    state.stats.slashEvents++;

    // Deduct from balance
    const account = state.accounts.get(addr);
    if (account) {
        const slashAmount = Math.min(account.balance, CONFIG.slashAmount);
        account.balance -= slashAmount;
        console.log(`💀 SLASHED ${addr}: -${slashAmount} tokens (evidence: ${evidence.epoch})`);
    }
}

/**
 * Independent Receipt Verification
 * Verify that receipts in a block are properly signed
 */
function verifyBlockReceipts(block) {
    for (const receipt of block.receipts || []) {
        if (!receipt.signature) {
            return { valid: false, reason: 'Receipt missing signature' };
        }

        // For full verification, we'd need the responder's public key
        // For now, verify the structure is correct
        if (!receipt.challengeId || !receipt.from || !receipt.to) {
            return { valid: false, reason: 'Receipt missing required fields' };
        }
    }
    return { valid: true };
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

/**
 * Transaction:
 * {
 *   from: string (pubKeyHash),
 *   to: string (pubKeyHash),
 *   amount: number,
 *   nonce: number,
 *   timestamp: number,
 *   signature: string
 * }
 */

function createTransaction(to, amount) {
    const from = IDENTITY.publicKeyHash;
    const account = state.accounts.get(from) || { balance: 0, nonce: 0 };

    const tx = {
        from,
        to,
        amount,
        nonce: account.nonce + 1,
        timestamp: Date.now(),
    };

    tx.signature = sign(tx);
    return tx;
}

function validateTransaction(tx) {
    // Check sender has funds
    const account = state.accounts.get(tx.from) || { balance: 0, nonce: 0 };

    if (account.balance < tx.amount) {
        return false;
    }

    if (tx.nonce !== account.nonce + 1) {
        return false;
    }

    // Verify signature (need sender's public key)
    // For now, we trust the signature if it's in a block (leader verified)
    return true;
}

function applyTransaction(tx) {
    const fromAccount = state.accounts.get(tx.from) || { balance: 0, nonce: 0 };
    const toAccount = state.accounts.get(tx.to) || { balance: 0, nonce: 0 };

    fromAccount.balance -= tx.amount;
    fromAccount.nonce = tx.nonce;
    toAccount.balance += tx.amount;

    state.accounts.set(tx.from, fromAccount);
    state.accounts.set(tx.to, toAccount);
}

function getAddressForNode(nodeId) {
    // Simple: use node's public key hash as address
    if (nodeId === NODE_NAME) {
        return IDENTITY.publicKeyHash;
    }
    const peer = state.peers.get(nodeId);
    return peer?.publicKeyHash || hash(nodeId).slice(0, 40);
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function saveChain() {
    ensureDataDir();
    fs.writeFileSync(`${DATA_DIR}/chain.json`, JSON.stringify(state.chain, null, 2));
    fs.writeFileSync(`${DATA_DIR}/accounts.json`, JSON.stringify([...state.accounts.entries()], null, 2));
}

function loadChain() {
    ensureDataDir();

    if (fs.existsSync(`${DATA_DIR}/chain.json`)) {
        state.chain = JSON.parse(fs.readFileSync(`${DATA_DIR}/chain.json`, 'utf8'));
        console.log(`Loaded ${state.chain.length} blocks from disk`);
    }

    if (fs.existsSync(`${DATA_DIR}/accounts.json`)) {
        const accounts = JSON.parse(fs.readFileSync(`${DATA_DIR}/accounts.json`, 'utf8'));
        state.accounts = new Map(accounts);
        console.log(`Loaded ${state.accounts.size} accounts from disk`);
    }

    if (state.chain.length > 0) {
        state.currentEpoch = state.chain[state.chain.length - 1].epoch;
    }
}

// Rebuild account state by replaying all blocks from genesis
function rebuildStateFromChain() {
    console.log(`Rebuilding state from ${state.chain.length} blocks...`);

    // Clear accounts and rebuild
    state.accounts.clear();

    for (const block of state.chain) {
        // Apply rewards (now keyed by address directly)
        for (const [addr, reward] of Object.entries(block.rewards || {})) {
            if (!state.accounts.has(addr)) {
                state.accounts.set(addr, { balance: 0, nonce: 0 });
            }
            state.accounts.get(addr).balance += reward;
        }

        // Apply transactions
        for (const tx of block.transactions || []) {
            // Coinbase transactions just credit, don't debit
            if (tx.from === 'coinbase') {
                const toAccount = state.accounts.get(tx.to) || { balance: 0, nonce: 0 };
                toAccount.balance += tx.amount;
                state.accounts.set(tx.to, toAccount);
                continue;
            }

            const fromAccount = state.accounts.get(tx.from) || { balance: 0, nonce: 0 };
            const toAccount = state.accounts.get(tx.to) || { balance: 0, nonce: 0 };

            fromAccount.balance -= tx.amount;
            fromAccount.nonce = tx.nonce;
            toAccount.balance += tx.amount;

            state.accounts.set(tx.from, fromAccount);
            state.accounts.set(tx.to, toAccount);
        }

        // Apply effectiveness (simplified - just track latest)
        for (const [nodeId, eff] of Object.entries(block.effectivenessUpdates || {})) {
            if (nodeId === NODE_NAME) {
                state.effectiveness = eff;
            }
        }
    }

    console.log(`Rebuilt ${state.accounts.size} accounts from chain`);
    saveChain();
}

// Helper to get address from block data (accounts might not exist yet)
function getAddressForNodeFromBlock(nodeId, block) {
    // If we have the leader's public key and they're the node, use their key hash
    if (nodeId === block.leader && block.leaderPubKey) {
        try {
            const pubKey = crypto.createPublicKey(block.leaderPubKey);
            return crypto.createHash('sha256')
                .update(pubKey.export({ type: 'spki', format: 'der' }))
                .digest('hex').slice(0, 40);
        } catch { }
    }
    // Fallback to hash of node name
    return hash(nodeId).slice(0, 40);
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

async function broadcast(path, data) {
    const promises = [];
    for (const [peerId, peer] of state.peers) {
        promises.push(
            request(peer.url, 'POST', path, data).catch(() => null)
        );
    }
    return Promise.all(promises);
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
    // CORS headers for browser wallet
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    try {
        const url = new URL(req.url, `http://localhost:${LOCAL_PORT}`);
        const path = url.pathname;

        // Peer discovery
        if (path === '/peers') {
            const list = [...state.peers.entries()].map(([id, p]) => ({
                id, url: p.url, publicKeyHash: p.publicKeyHash,
            }));
            list.push({ id: NODE_NAME, url: MY_PUBLIC_URL, publicKeyHash: IDENTITY.publicKeyHash });
            res.end(JSON.stringify(list));
            return;
        }

        // Announce
        if (path === '/announce' && req.method === 'POST') {
            const data = JSON.parse(body);
            state.peers.set(data.id, {
                url: data.url,
                publicKeyPem: data.publicKeyPem,
                publicKeyHash: data.publicKeyHash,
                lastSeen: Date.now(),
                effectiveness: 0,
            });
            console.log(`✓ Peer joined: ${data.id}`);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Challenge
        if (path === '/challenge' && req.method === 'POST') {
            const challenge = JSON.parse(body);
            handleChallenge(challenge, res);
            return;
        }

        // Block proposal
        if (path === '/propose' && req.method === 'POST') {
            const block = JSON.parse(body);
            handleBlockProposal(block, res);
            return;
        }

        // Vote on block
        if (path === '/vote' && req.method === 'POST') {
            const vote = JSON.parse(body);
            handleVote(vote);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // View change notification
        if (path === '/view-change' && req.method === 'POST') {
            const viewChange = JSON.parse(body);
            handleViewChange(viewChange);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Get chain
        if (path === '/chain') {
            res.end(JSON.stringify(state.chain.slice(-100)));
            return;
        }

        // SPV: Get headers only (tiny, for light wallets)
        if (path === '/headers') {
            const headers = state.chain.slice(-100).map(block => ({
                epoch: block.epoch,
                hash: block.hash,
                previousHash: block.previousHash,
                txRoot: block.txRoot,
                receiptRoot: block.receiptRoot,
                stateRoot: block.stateRoot,
                timestamp: block.timestamp,
                leader: block.leader,
                leaderSignature: block.leaderSignature,
            }));
            res.end(JSON.stringify(headers));
            return;
        }

        // SPV: Get proof for a transaction
        if (path.startsWith('/proof/')) {
            const txHash = path.split('/')[2];
            // Find block containing this tx
            for (const block of state.chain) {
                for (const tx of block.transactions || []) {
                    if (hash(tx) === txHash) {
                        const proof = getMerkleProof(block, txHash);
                        res.end(JSON.stringify({
                            found: true,
                            blockEpoch: block.epoch,
                            blockHash: block.hash,
                            txRoot: block.txRoot,
                            proof,
                        }));
                        return;
                    }
                }
            }
            res.end(JSON.stringify({ found: false }));
            return;
        }

        // Receive committed block from leader
        if (path === '/commit' && req.method === 'POST') {
            const block = JSON.parse(body);
            handleCommittedBlock(block);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Get balance
        if (path.startsWith('/balance/')) {
            const addr = path.split('/')[2];
            const account = state.accounts.get(addr) || { balance: 0, nonce: 0 };
            res.end(JSON.stringify(account));
            return;
        }

        // Faucet (for testing) - create a coinbase transaction
        if (path === '/faucet' && req.method === 'POST') {
            const data = JSON.parse(body);
            const amount = data.amount || 1000;
            const addr = IDENTITY.publicKeyHash;

            // Create a special coinbase tx (from magic address)
            const coinbaseTx = {
                from: 'coinbase',  // Special address with infinite money
                to: addr,
                amount,
                nonce: Date.now(),  // Use timestamp as nonce for coinbase
                timestamp: Date.now(),
                signature: 'coinbase',  // Special signature
            };

            state.pendingTransactions.push(coinbaseTx);

            console.log(`Faucet: queued ${amount} for ${addr}`);
            res.end(JSON.stringify({ ok: true, address: addr, pending: true }));
            return;
        }

        // Send transaction (simplified API)
        if (path === '/send' && req.method === 'POST') {
            const data = JSON.parse(body);
            const { to, amount } = data;

            const from = IDENTITY.publicKeyHash;
            const account = state.accounts.get(from) || { balance: 0, nonce: 0 };

            if (account.balance < amount) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Insufficient balance', balance: account.balance }));
                return;
            }

            const tx = {
                from,
                to,
                amount,
                nonce: account.nonce + 1,
                timestamp: Date.now(),
            };
            tx.signature = sign(tx);

            state.pendingTransactions.push(tx);
            broadcast('/transaction', tx);

            console.log(`Tx: ${from} -> ${to} : ${amount}`);
            res.end(JSON.stringify({ ok: true, tx }));
            return;
        }

        // Submit transaction
        if (path === '/transaction' && req.method === 'POST') {
            const tx = JSON.parse(body);
            // Only add if we don't have it already
            if (!state.pendingTransactions.some(t => t.signature === tx.signature)) {
                state.pendingTransactions.push(tx);
            }
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Gossip
        if (path === '/gossip' && req.method === 'POST') {
            handleGossip(JSON.parse(body));
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // Health
        if (path === '/health') {
            res.end(JSON.stringify({
                name: NODE_NAME,
                address: IDENTITY.publicKeyHash,
                epoch: state.currentEpoch,
                view: state.currentView,
                chainLength: state.chain.length,
                peers: state.peers.size,
                effectiveness: state.effectiveness,
                balance: (state.accounts.get(IDENTITY.publicKeyHash) || { balance: 0 }).balance,
                slashedNodes: state.slashedNodes.size,
                connectivity: {
                    mode: state.connectivity.mode,
                    reachable: state.connectivity.reachable,
                    endpoints: state.connectivity.endpoints,
                },
                stats: state.stats,
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

    // Do work proof
    let result = 0;
    for (let i = 0; i < 10000; i++) result = (result * 31 + i) % 1000000007;

    const receipt = {
        challengeId: challenge.challengeId,
        from: challenge.from,
        to: NODE_NAME,
        epoch: state.currentEpoch,
        success: true,
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
        workResult: result,
    };

    receipt.signature = sign(receipt);

    res.end(JSON.stringify({ receipt, publicKeyPem: IDENTITY.publicKeyPem }));
}

// ============================================================================
// CONSENSUS
// ============================================================================

function handleBlockProposal(block, res) {
    // Check for equivocation (leader proposing conflicting blocks)
    const equivResult = checkEquivocation(block);
    if (equivResult.detected) {
        // Slash the equivocating leader
        slashNode(block.leaderPubKey, equivResult.evidence);
        res.end(JSON.stringify({ ok: false, error: 'Equivocation detected', evidence: equivResult.evidence }));
        return;
    }

    // Verify block receipts independently
    const receiptResult = verifyBlockReceipts(block);
    if (!receiptResult.valid) {
        res.end(JSON.stringify({ ok: false, error: receiptResult.reason }));
        return;
    }

    // If block references a chain we don't have, we need to sync
    // Check if we're behind by comparing previousHash
    const myLastHash = state.chain.length > 0
        ? state.chain[state.chain.length - 1].hash
        : '0'.repeat(64);

    if (block.previousHash !== myLastHash) {
        // We might be behind - accept the block anyway if it has valid signature
        // This is a simplified sync: just accept the block and add to our chain
        // In production, we'd fetch missing blocks

        // Verify leader signature at minimum
        const blockData = { ...block, hash: undefined, leaderSignature: undefined, votes: undefined };
        const expectedHash = hash(blockData);

        if (block.hash !== expectedHash) {
            res.end(JSON.stringify({ ok: false, error: 'Hash mismatch' }));
            return;
        }

        if (!verify(block.hash, block.leaderSignature, block.leaderPubKey)) {
            res.end(JSON.stringify({ ok: false, error: 'Invalid signature' }));
            return;
        }

        // Accept the block anyway - simplified sync
        console.log(`Accepting block ${block.epoch} (chain sync needed)`);
    }

    // Store proposal
    state.proposedBlock = block;

    // Vote for it
    const vote = {
        epoch: block.epoch,
        blockHash: block.hash,
        voter: NODE_NAME,
        voterPubKey: IDENTITY.publicKeyPem,
        signature: sign(block.hash),
    };

    // Send vote back to leader
    res.end(JSON.stringify({ ok: true, vote }));
}

function handleVote(vote) {
    // Verify signature
    if (!verify(vote.blockHash, vote.signature, vote.voterPubKey)) {
        console.log(`Invalid vote from ${vote.voter}`);
        return;
    }

    // Only count if we're expecting votes for a proposal
    if (!state.proposedBlock || state.proposedBlock.hash !== vote.blockHash) {
        return;
    }

    state.votes.set(vote.voter, vote.signature);

    // Check if we have quorum
    const totalNodes = state.peers.size + 1;
    const votesNeeded = Math.ceil(totalNodes * CONFIG.quorumFraction);

    if (state.votes.size >= votesNeeded) {
        // Add votes to block and commit
        state.proposedBlock.votes = Object.fromEntries(state.votes);
        commitBlock(state.proposedBlock);
        state.proposedBlock = null;
        state.votes.clear();
    }
}

function handleCommittedBlock(block) {
    // Check if we already have this block
    if (state.chain.some(b => b.hash === block.hash)) {
        return;
    }

    // Verify it has valid votes (quorum)
    const voteCount = Object.keys(block.votes || {}).length;
    if (voteCount < 2) {
        console.log(`Rejected committed block ${block.epoch}: not enough votes`);
        return;
    }

    // Verify leader signature
    const blockData = { ...block, hash: undefined, leaderSignature: undefined, votes: undefined };
    const expectedHash = hash(blockData);

    if (block.hash !== expectedHash) {
        console.log(`Rejected committed block ${block.epoch}: hash mismatch`);
        return;
    }

    if (!verify(block.hash, block.leaderSignature, block.leaderPubKey)) {
        console.log(`Rejected committed block ${block.epoch}: invalid signature`);
        return;
    }

    // Commit the block
    commitBlock(block);
}

function handleViewChange(viewChange) {
    // Verify it's for current epoch
    if (viewChange.epoch !== state.currentEpoch) {
        return;
    }

    // Only accept if new view is higher than ours
    if (viewChange.newView <= state.currentView) {
        return;
    }

    // Track view change votes
    const key = `${viewChange.epoch}-${viewChange.newView}`;
    if (!state.viewChangeVotes.has(key)) {
        state.viewChangeVotes.set(key, new Set());
    }

    state.viewChangeVotes.get(key).add(viewChange.from);

    // Check if we have quorum for this view change
    const votes = state.viewChangeVotes.get(key).size;
    const totalNodes = state.peers.size + 1;
    const votesNeeded = Math.ceil(totalNodes * CONFIG.quorumFraction);

    if (votes >= votesNeeded) {
        const oldView = state.currentView;
        state.currentView = viewChange.newView;
        state.proposedBlock = null;
        state.votes.clear();
        state.stats.viewChanges++;

        const newLeader = electLeader(state.currentEpoch);
        console.log(`⚠ View change accepted: ${oldView} → ${state.currentView} (new leader: ${newLeader})`);
    }
}

function handleGossip(data) {
    // Learn peers
    if (data.peers) {
        for (const peer of data.peers) {
            if (peer.id !== NODE_NAME && !state.peers.has(peer.id)) {
                state.peers.set(peer.id, {
                    url: peer.url,
                    publicKeyHash: peer.publicKeyHash,
                    lastSeen: Date.now(),
                    effectiveness: 0,
                });
                console.log(`Discovered: ${peer.id}`);
            }
        }
    }

    // Update peer lastSeen
    if (data.from && state.peers.has(data.from)) {
        state.peers.get(data.from).lastSeen = Date.now();
    }
}

// ============================================================================
// EPOCH LOOP
// ============================================================================

async function runEpoch() {
    state.currentEpoch++;
    state.epochStartTime = Date.now();  // Track when epoch started for view change timeout
    state.currentView = 0;              // Reset view at start of each epoch
    state.viewChangeVotes.clear();      // Clear view change votes
    state.proposedBlock = null;         // Clear any pending proposal
    state.votes.clear();                // Clear votes

    const leader = electLeader(state.currentEpoch);
    const amLeader = leader === NODE_NAME;

    console.log(`\n--- Epoch ${state.currentEpoch} | Leader: ${leader} ${amLeader ? '(me)' : ''} ---`);

    // Issue challenges to peers
    const receipts = await issueChallages();

    // If not leader, set up a view change check
    if (!amLeader) {
        // Schedule view change check
        setTimeout(() => {
            if (!state.proposedBlock && state.currentView === 0) {
                checkViewChange();
            }
        }, CONFIG.viewChangeTimeoutMs);
    }

    if (amLeader) {
        // Create and propose block
        const block = createBlock(
            state.currentEpoch,
            [...state.pendingReceipts, ...receipts],
            state.pendingTransactions
        );

        state.proposedBlock = block;
        state.stats.blocksProduced++;

        // Add our own vote
        state.votes.set(NODE_NAME, sign(block.hash));

        console.log(`Proposing block ${block.epoch} (${block.receipts.length} receipts)`);

        // Broadcast to peers
        const responses = await broadcast('/propose', block);

        // Collect votes
        for (const resp of responses) {
            if (resp?.vote) {
                handleVote(resp.vote);
            }
        }

        // Small delay then check quorum
        await new Promise(r => setTimeout(r, 2000));

        // If still not committed, try to commit with what we have
        if (state.proposedBlock) {
            const totalNodes = state.peers.size + 1;
            const votesNeeded = Math.ceil(totalNodes * CONFIG.quorumFraction);

            if (state.votes.size >= votesNeeded) {
                state.proposedBlock.votes = Object.fromEntries(state.votes);
                commitBlock(state.proposedBlock);

                // Broadcast committed block to all peers
                await broadcast('/commit', state.proposedBlock);
            } else {
                console.log(`Block ${block.epoch} failed: ${state.votes.size}/${votesNeeded} votes`);
            }

            state.proposedBlock = null;
            state.votes.clear();
        }
    }
}

async function issueChallages() {
    const receipts = [];
    const peerIds = [...state.peers.keys()];

    for (let i = 0; i < CONFIG.challengesPerEpoch && i < peerIds.length; i++) {
        const targetId = peerIds[i % peerIds.length];
        const peer = state.peers.get(targetId);

        const challenge = {
            challengeId: `e${state.currentEpoch}-${NODE_NAME}-c${i}`,
            from: NODE_NAME,
            to: targetId,
            epoch: state.currentEpoch,
        };

        state.stats.challengesSent++;

        try {
            const resp = await request(peer.url, 'POST', '/challenge', challenge);
            if (resp.receipt) {
                // Verify signature
                if (verify({ ...resp.receipt, signature: undefined }, resp.receipt.signature, resp.publicKeyPem)) {
                    receipts.push(resp.receipt);
                    state.stats.receiptsVerified++;
                }
            }
        } catch (err) {
            // Node offline
        }
    }

    return receipts;
}

async function gossip() {
    const msg = {
        from: NODE_NAME,
        chainLength: state.chain.length,
        lastBlockHash: state.chain.length > 0 ? state.chain[state.chain.length - 1].hash : null,
        peers: [{ id: NODE_NAME, url: MY_PUBLIC_URL, publicKeyHash: IDENTITY.publicKeyHash }],
    };

    for (const [id, peer] of state.peers) {
        try {
            await request(peer.url, 'POST', '/gossip', msg);
            peer.lastSeen = Date.now();

            // Periodically sync chain from peers (every ~10 gossip cycles)
            if (Math.random() < 0.1) {
                const peerChain = await request(peer.url, 'GET', '/chain');
                if (Array.isArray(peerChain) && peerChain.length > state.chain.length) {
                    console.log(`Syncing ${peerChain.length - state.chain.length} blocks from ${id}`);
                    state.chain = peerChain;
                    if (peerChain.length > 0) {
                        state.currentEpoch = peerChain[peerChain.length - 1].epoch;
                    }
                    rebuildStateFromChain();
                }
            }
        } catch {
            if (Date.now() - peer.lastSeen > CONFIG.heartbeatTimeoutMs) {
                console.log(`Peer timeout: ${id}`);
                state.peers.delete(id);
            }
        }
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    loadChain();

    await new Promise(r => server.listen(LOCAL_PORT, r));
    console.log(`Listening on port ${LOCAL_PORT}\n`);

    // Detect connectivity
    console.log('Detecting network connectivity...');
    try {
        state.connectivity = await detectConnectivity(LOCAL_PORT);
        console.log(`Connectivity mode: ${state.connectivity.mode}`);
        console.log(`Reachable: ${state.connectivity.reachable}`);
        if (state.connectivity.endpoints.length > 0) {
            console.log(`Endpoints: ${state.connectivity.endpoints.map(e => e.url).join(', ')}`);
        }
    } catch (err) {
        console.log('Connectivity detection failed:', err.message);
        state.connectivity = { mode: 'outbound-only', reachable: false, endpoints: [], supportsRelay: true };
    }
    console.log('');

    // Bootstrap
    if (BOOTSTRAP_PEER) {
        try {
            await request(BOOTSTRAP_PEER, 'POST', '/announce', {
                id: NODE_NAME,
                url: MY_PUBLIC_URL,
                publicKeyPem: IDENTITY.publicKeyPem,
                publicKeyHash: IDENTITY.publicKeyHash,
            });

            const peers = await request(BOOTSTRAP_PEER, 'GET', '/peers');
            for (const p of peers) {
                if (p.id !== NODE_NAME) {
                    state.peers.set(p.id, { url: p.url, publicKeyHash: p.publicKeyHash, lastSeen: Date.now(), effectiveness: 0 });
                }
            }

            // Sync chain
            const chain = await request(BOOTSTRAP_PEER, 'GET', '/chain');
            if (chain.length > state.chain.length) {
                console.log(`Syncing ${chain.length} blocks from peer`);
                state.chain = chain;
                state.currentEpoch = chain.length > 0 ? chain[chain.length - 1].epoch : 0;
                rebuildStateFromChain();
            }

            console.log(`Synced with ${state.peers.size} peers, ${state.chain.length} blocks\n`);
        } catch (err) {
            console.error('Bootstrap failed:', err.message);
        }
    }

    // Start loops
    setInterval(gossip, CONFIG.gossipIntervalMs);
    setInterval(runEpoch, CONFIG.epochDurationMs);

    // Status report
    setInterval(() => {
        const balance = (state.accounts.get(IDENTITY.publicKeyHash) || { balance: 0 }).balance;
        console.log(
            `[Status] epoch=${state.currentEpoch} chain=${state.chain.length} peers=${state.peers.size} ` +
            `eff=${(state.effectiveness * 100).toFixed(1)}% balance=${balance.toFixed(2)}`
        );
    }, 30000);

    console.log('Consensus node running.\n');
}

process.on('SIGINT', () => {
    console.log('\nShutdown');
    saveChain();
    server.close();
    process.exit(0);
});

main().catch(console.error);
