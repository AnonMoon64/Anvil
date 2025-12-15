/**
 * Anvil Wallet - API Client
 * Connects to Anvil consensus nodes
 */

// Config URL - fetches current seed node address (can be updated without rebuilding wallet)
const SEED_CONFIG_URL = 'https://vaultlock.org/api/functions/publicNodeAddress';

// Fallback nodes if config fetch fails
const DEFAULT_NODES = [
    { name: 'Local Node', url: 'http://localhost:4001' },
    { name: 'Local Node 2', url: 'http://localhost:4002' },
];

// Fetch seed node URL from vaultlock.org
export async function fetchSeedNodes() {
    try {
        const response = await fetch(SEED_CONFIG_URL, { cache: 'no-store' });
        if (response.ok) {
            const config = await response.json();
            console.log('Fetched seed config:', config);
            // Parse nodeAddress from vaultlock API response
            if (config.nodeAddress) {
                return [
                    { name: 'Anvil Seed', url: config.nodeAddress },
                    ...DEFAULT_NODES
                ];
            }
        }
    } catch (err) {
        console.warn('Could not fetch seed config:', err.message);
    }
    return DEFAULT_NODES;
}

export class AnvilClient {
    constructor(nodeUrl = 'http://localhost:4001') {
        this.nodeUrl = nodeUrl;
        this.connected = false;
    }

    setNode(url) {
        this.nodeUrl = url;
        this.connected = false;
    }

    async request(path, method = 'GET', data = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',  // Required for ngrok free tier
            },
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.nodeUrl}${path}`, options);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    }

    // Check node connection
    async checkConnection() {
        try {
            console.log('Connecting to:', this.nodeUrl);
            const health = await this.getHealth();
            console.log('Connected! Health:', health);
            this.connected = true;
            return { connected: true, health };
        } catch (err) {
            console.error('Connection failed:', this.nodeUrl, err.message);
            this.connected = false;
            return { connected: false, error: err.message };
        }
    }

    // Get node health/status
    async getHealth() {
        return this.request('/health');
    }

    // Get balance for an address
    async getBalance(address) {
        const account = await this.request(`/balance/${address}`);
        return {
            balance: account.balance || 0,
            nonce: account.nonce || 0,
        };
    }

    // Get the chain (last N blocks)
    async getChain() {
        return this.request('/chain');
    }

    // Get peer list
    async getPeers() {
        return this.request('/peers');
    }

    // Submit a signed transaction
    async submitTransaction(tx) {
        return this.request('/transaction', 'POST', tx);
    }

    // Use the node's /send endpoint (if we have keys stored there)
    async send(to, amount) {
        return this.request('/send', 'POST', { to, amount });
    }

    // Faucet (for testing)
    async faucet(amount = 1000) {
        return this.request('/faucet', 'POST', { amount });
    }

    // ================================================================
    // MINING / PARTICIPATION
    // ================================================================

    // Register as light participant
    async registerParticipant(address, publicKey) {
        return this.request('/participate/register', 'POST', { address, publicKey });
    }

    // Poll for a challenge
    async pollChallenge(address) {
        return this.request('/participate/poll', 'POST', { address });
    }

    // Respond to a challenge
    async respondChallenge(address, challengeId, response) {
        return this.request('/participate/respond', 'POST', { address, challengeId, response });
    }

    // Get participant stats
    async getParticipantStats(address) {
        return this.request(`/participate/stats/${address}`);
    }
}

// Get default nodes
export function getDefaultNodes() {
    return DEFAULT_NODES;
}

// Store preferred node
export function savePreferredNode(url) {
    localStorage.setItem('anvil_node', url);
}

// Load preferred node
export function loadPreferredNode() {
    return localStorage.getItem('anvil_node') || DEFAULT_NODES[0].url;
}
