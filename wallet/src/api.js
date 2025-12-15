/**
 * Anvil Wallet - API Client
 * Connects to Anvil consensus nodes
 */

const DEFAULT_NODES = [
    { name: 'Local Node', url: 'http://localhost:4001' },
    { name: 'Local Node 2', url: 'http://localhost:4002' },
];

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
            const health = await this.getHealth();
            this.connected = true;
            return { connected: true, health };
        } catch (err) {
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
