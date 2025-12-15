# Distributed Testing Setup

## Overview

Phase 2 tests real network latency between:
- Your laptop (coordinator)
- VPS node
- base44.com constrained node

## Installation

The distributed test requires the `ws` package:

```bash
npm install ws
```

## Step 1: Start Coordinator (Your Laptop)

```bash
node prototype/distributed-coordinator.js --port 8080
```

The coordinator will print your local IP. You need to either:
- Port forward 8080 on your router, OR
- Use a tool like ngrok: `ngrok tcp 8080`

## Step 2: Connect VPS Node

SSH into your VPS and run:

```bash
# Install Node.js if needed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Create directory and download files
mkdir -p anvil && cd anvil

# Copy the distributed-node.js content (or scp from your machine)
# Then run:
npm install ws
node distributed-node.js --coordinator ws://YOUR_LAPTOP_IP:8080 --name vps1
```

## Step 3: Connect base44.com Node

If base44.com supports custom scripts, run the same node script:

```bash
node distributed-node.js --coordinator ws://YOUR_LAPTOP_IP:8080 --name base44
```

## What Gets Measured

1. **Round-trip time (RTT)** - Full challenge → response time
2. **Challenge success rate** - How many complete within timeout
3. **Timeout rate** - How many fail due to network latency
4. **Per-node performance** - Each node's individual stats

## Expected Results

| Metric | Local | Cross-Internet |
|--------|-------|----------------|
| RTT P50 | <50ms | 50-150ms |
| RTT P95 | <100ms | 100-300ms |
| Success rate | >98% | >90% |

If P95 RTT exceeds the timeout (500ms), the protocol needs looser timing constraints.

## Troubleshooting

### "Connection refused"
- Ensure port 8080 is open/forwarded
- Check firewall settings
- Try ngrok if behind NAT

### High timeout rate
- Increase `challengeTimeoutMs` in coordinator
- Check VPS network quality
- Consider geographic distance

### Node keeps reconnecting
- Check WebSocket URL is correct
- Verify the coordinator is running
- Check for firewall issues
