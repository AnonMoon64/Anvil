# VPS Quick Setup Script
# Run this on your VPS after SSHing in

# 1. Check if Node.js is installed
node --version 2>/dev/null || {
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
}

# 2. Create directory
mkdir -p ~/anvil
cd ~/anvil

# 3. Create the node script (paste the content below)
cat > node-standalone.js << 'NODESCRIPT'
/**
 * Anvil Distributed Node (No Dependencies)
 */

const http = require('http');
const https = require('https');

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

console.log('Anvil Node Starting...');
console.log(`Node: ${CONFIG.nodeName}`);
console.log(`Coordinator: ${CONFIG.coordinatorUrl}`);

const storage = {};
for (let i = 0; i < 100; i++) {
  storage[`block-${i}`] = Buffer.alloc(1024).fill(i % 256).toString('base64').slice(0, 32);
}

let stats = { challenges: 0, completed: 0, failed: 0 };

function parseUrl(urlStr) {
  const url = new URL(urlStr);
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
  };
}

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const urlInfo = parseUrl(CONFIG.coordinatorUrl);
    const options = {
      hostname: urlInfo.hostname,
      port: urlInfo.port,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    const client = urlInfo.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
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

async function register() {
  try {
    await request('POST', '/register', { nodeId: CONFIG.nodeName, timestamp: Date.now() });
    console.log('Registered with coordinator');
    return true;
  } catch (err) {
    console.error('Registration failed:', err.message);
    return false;
  }
}

async function pollChallenges() {
  try {
    const challenges = await request('GET', `/challenges/${CONFIG.nodeName}`);
    if (Array.isArray(challenges)) {
      for (const c of challenges) await handleChallenge(c);
    }
  } catch (err) {}
}

async function handleChallenge(challenge) {
  const start = Date.now();
  stats.challenges++;
  let success = true, responseData = null;
  
  try {
    switch (challenge.challengeType) {
      case 'liveness':
        responseData = { pong: true };
        break;
      case 'data':
        const id = `block-${challenge.blockIndex || 0}`;
        responseData = { found: !!storage[id], hash: storage[id] };
        break;
      case 'work':
        let r = 0;
        for (let i = 0; i < (challenge.iterations || 10000); i++) r = (r * 31 + i) % 1000000007;
        responseData = { result: r };
        break;
    }
    stats.completed++;
  } catch (err) {
    success = false;
    stats.failed++;
  }
  
  try {
    await request('POST', '/response', {
      challengeId: challenge.challengeId,
      nodeId: CONFIG.nodeName,
      success,
      latencyMs: Date.now() - start,
    });
  } catch (err) {}
}

async function main() {
  let registered = false;
  while (!registered) {
    registered = await register();
    if (!registered) { console.log('Retrying...'); await new Promise(r => setTimeout(r, 5000)); }
  }
  
  setInterval(pollChallenges, CONFIG.pollIntervalMs);
  setInterval(() => console.log(`Stats: ${stats.completed}/${stats.challenges}`), 10000);
}

main().catch(console.error);
NODESCRIPT

echo "Node script created!"
echo ""
echo "Run with:"
echo "  node node-standalone.js --coordinator http://YOUR_LAPTOP_IP:8080 --name vps1"
