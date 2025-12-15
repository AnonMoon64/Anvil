# Anvil: Participation-Weighted Payment Network

**Sustained Mining Without Industrial Dominance**

**Document Version:** 12.0  
**Last Updated:** 2025-12-15  
**Status:** ✅ Full Stack — BFT Consensus, React Wallet with Mining, Auto-Connectivity

---

## Abstract

Anvil is a participation-weighted payment network that redefines mining as **sustained, verifiable contribution** rather than competitive extraction. The system preserves meaningful, bounded profitability for small, persistent operators while discouraging industrial dominance through:

- ⏱️ **Time-weighted participation** — Rewards grow with sustained activity
- 🔒 **Bounded per-node work** — Memory-hard computation that saturates on consumer hardware  
- ⚖️ **Participation-normalized rewards** — Proportional distribution, not winner-takes-all
- 📉 **Smooth emission decay** — No abrupt halving cliffs
- 🛡️ **Anti-gaming scoring** — Continuous evaluation defeats threshold manipulation
- 🔄 **Load-responsive security** — Parameters tighten when network value rises

> **Philosophy:** This network survives only if people want it to exist. That is not a flaw. That is the filter.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Simulation Results Summary](#simulation-results-summary)
3. [Motivation](#motivation)
4. [Economic Philosophy](#economic-philosophy)
5. [Core Mechanics](#core-mechanics)
6. [Anti-Gaming Measures](#anti-gaming-measures)
7. [Time-Weighted Effectiveness](#time-weighted-effectiveness)
8. [Sybil Resistance](#sybil-resistance)
9. [Economic Model](#economic-model)
10. [Adversarial Testing](#adversarial-testing)
11. [Open Questions](#open-questions)

---

## Quick Start

```bash
# Core tests
npm run test          # 36 unit tests
npm run stress        # Reality stress tests  
npm run cheat-ev      # Fraud EV analysis

# Adversarial tests
npm run adaptive      # Adaptive fraud strategies
npm run load-responsive  # Dynamic security scaling
npm run griefing      # Penalty weaponization test
npm run edge-cases    # Final edge cases

# Run all adversarial tests
npm run adversarial
```

---

## Simulation Results Summary

### Test Coverage

| Test Suite | Tests | Status |
|------------|-------|--------|
| Unit Tests | 36 mechanics tests | ✅ All pass |
| Stress Tests | 6 reality checks | ✅ All pass |
| Cheat EV | Fraud analysis | ✅ All negative EV |
| Adaptive Fraud | 6 strategies | ✅ All negative EV |
| Load-Responsive | Dynamic security | ✅ 138% better defense |
| Griefing | Penalty weaponization | ✅ 0.00x efficiency |
| Edge Cases | Final adversarial | ✅ All pass |

### Key Metrics

| Metric | Value |
|--------|-------|
| **Hobbyist break-even** | $0.13 token price |
| **Selective griefing efficiency** | 0.08-0.16x (inefficient) |
| **Near-zero fraud EV** | -$55 to -$426/year |
| **Parameter sensitivity floor** | Holds at 50% degradation |
| **Detection probability floor** | Works at 57% (40% worse) |

### Distributed Prototype Results (Phase 2)

Real network test across internet with 3 nodes:

| Node | Type | Status |
|------|------|--------|
| VPS | Dedicated server | ✅ Stable |
| Laptop | Local coordinator | ✅ Stable |

| Metric | Result |
|--------|--------|
| **Challenges completed** | 2,500+ |
| **Success rate** | 100% |
| **Average RTT** | ~450ms (through ngrok) |
| **Node reconnection** | Handled gracefully |

### Conclusion

**Protocol tested across real internet. 100% challenge success rate with heterogeneous nodes.**

### Consensus Implementation (Phase 3)

Local 3-node consensus test:

| Feature | Status |
|---------|--------|
| Leader-based BFT | ✅ Working |
| Block production | ✅ Working |
| 2/3 quorum voting | ✅ Working |
| Chain sync | ✅ Working |
| Reward distribution | ✅ Working |
| **Transactions** | ✅ **Working** |

| Metric | Result |
|--------|--------|
| **Blocks committed** | 50+ |
| **Leaders rotated** | All 3 nodes |
| **Challenges verified** | 80+ per node |
| **Chain convergence** | Within 2 blocks |

### Transaction Test Results

| Step | Node1 Balance | Node2 Balance |
|------|---------------|---------------|
| Faucet (1000 coins) | 1000 | 0 |
| Send 100 to Node2 | 900 | 100+ |
| Send 200 to Node2 | 700 | 300+ |

✅ **Transactions working:** Signed, broadcast, included in blocks, balances updated.

### Transaction Security Tests

| Test | Status | Description |
|------|--------|-------------|
| **Replay Attack** | ✅ PASS | Same signed tx rejected on replay |
| **Double-Spend** | ✅ PASS | Two txs same nonce → only one lands |
| **Out-of-Order Nonce** | ✅ PASS | Wrong nonce rejected |
| **Cold Sync** | ✅ PASS | New node rebuilds exact same state |

**All 4 critical security tests pass.** Transaction ordering is deterministic and replay-safe.

#### BFT Hardening (Implemented)

| Property | Status | Notes |
|----------|--------|-------|
| View change | ✅ | Leader timeout triggers new leader election |
| Equivocation detection | ✅ | Conflicting blocks detected and slashed |
| Independent verification | ✅ | Receipts verified independently |
| Slashing | ✅ | Byzantine nodes lose tokens |

#### Anvil Wallet

Desktop wallet with local key storage:

| Feature | Status |
|---------|--------|
| Create/restore wallet | ✅ |
| Private key backup | ✅ Download JSON |
| Send/receive ANVIL | ✅ |
| Balance tracking | ✅ |
| Multi-node support | ✅ |
| 160-bit addresses | ✅ Ethereum-style |
| **⛏️ In-Wallet Mining** | ✅ **NEW** |

**Mining Features:**
- Start/stop mining with one button
- Answers challenges every 3 seconds
- Earns 0.01 ANVIL per successful challenge
- Effectiveness builds over ~120 days
- Real-time stats (effectiveness %, total mined, challenges answered)

```bash
# Run wallet (development)
cd wallet && npm run dev

# Build wallet executable (Windows)
cd wallet && npm run build:exe

# Download pre-built exe from GitHub Releases
```

**How Mining Works:**
1. Create or restore a wallet
2. Click the **⛏️ Mine** tab
3. Click **▶️ Start Mining**
4. Keep the wallet open to earn ANVIL


#### Auto-Connectivity Detection

Nodes automatically detect their network reachability:

| Detection | Priority | Description |
|-----------|----------|-------------|
| IPv6 public | 1st | Uses global unicast IPv6 |
| UPnP | 2nd | Discovers gateway via SSDP |
| NAT-PMP | 3rd | Gets external IP from router |
| Outbound-only | Fallback | Relay routing for NAT'd nodes |

Nodes announce their reachability in peer discovery:
```json
{
  "reachable": true,
  "mode": "nat-pmp",
  "endpoints": [{"url": "http://71.72.139.175:4001"}]
}
```

#### SPV Light Wallet Support

Blocks include Merkle roots for light verification:

| Root | Purpose |
|------|---------|
| `txRoot` | Transaction Merkle root |
| `receiptRoot` | Receipt Merkle root |
| `stateRoot` | Account state root |

API endpoints: `/headers` (headers only), `/proof/{txHash}` (Merkle proof)

---

## Motivation

Early cryptocurrency mining was accessible, predictable, and participatory. Over time, dominant systems evolved toward:

| Problem | Impact |
|---------|--------|
| Industrial mining farms | Capital concentration |
| Hardware arms races | Barrier to entry |
| Lottery-style rewards | Unpredictable income |
| Abrupt halving cliffs | Economic disruption |

**Anvil restores participation as a long-term, human-scale activity.**

---

## Economic Philosophy

> **This system is designed for participants who value the continued existence of a decentralized payment network more than maximal extractive profit.**

| Characteristic | Traditional Mining | Anvil Mining |
|----------------|-------------------|--------------|
| Returns | Speculative, unbounded | Bounded, predictable |
| Activity | Extractive competition | Infrastructure operation |
| Sustainability | Race to the bottom | Long-term viable |
| Barrier | High (hardware, power) | Low (Raspberry Pi @ $3/mo) |

---

## Core Mechanics

Mining is redefined as **sustained participation** rather than winner-takes-all computation.

```
┌─────────────────────────────────────────────────────────────┐
│                  EFFECTIVE WEIGHT FACTORS                   │
├─────────────────────────────────────────────────────────────┤
│  🧱 Bounded Work      │ Memory-hard, sequential computation │
│  📡 Participation     │ Data availability + liveness        │
│  ⏱️ Sustained Time    │ Time-weighted effectiveness         │
│  📊 Continuous Score  │ Anti-gaming quality metrics         │
│  🔄 Dynamic Security  │ Load-responsive parameters          │
└─────────────────────────────────────────────────────────────┘
```

### Challenge Types

| Type | Payload | Deadline | Purpose |
|------|---------|----------|---------|
| Liveness | 1 KB | 500ms | Prove node is responsive |
| Recent Data | 500 KB | 2s | Prove recent chain storage |
| Historical Data | 5 MB | 10s | Prove long-term storage |
| Work Proof | 100 KB | 30s | Prove bounded computation |

---

## Anti-Gaming Measures

### Problem: Edge Compliance

At high token prices, "barely meeting minimums" becomes the dominant attack strategy.

### Solution: Continuous Scoring

```javascript
score = (workQuality × 0.35) + 
        (responsiveness × 0.30) + 
        (availability × 0.25) + 
        (consistency × 0.10)
```

### Edge Grazing Detection

| Behavior | Penalty |
|----------|---------|
| Consistently within 10% of minimum | 15% reward reduction |
| Pattern detected | +20% audit probability |
| Burst audit failure | 25% effectiveness loss + 2x decay |

### Two-Stage EMA Smoothing

| Stage | Alpha | Purpose |
|-------|-------|---------|
| Fast | 0.3 | Detect entry/exit events |
| Slow | 0.1 | Long-term stability |

Reduces "jump-in jump-out" exploitation from 4.3% to ~1%.

### Graduated Penalties

Protects honest nodes from single failures while punishing patterns:

| Detection Level | Effectiveness Loss | Clawback | Ban |
|-----------------|-------------------|----------|-----|
| Single failure | 2% | 0 epochs | 0 days |
| Repeated (3 in 7d) | 10% | 1 epoch | 0 days |
| Pattern (5 in 14d) | 30% | 7 epochs | 7 days |
| Confirmed fraud | 100% | 14 epochs | 30 days |

---

## Time-Weighted Effectiveness

### Ramp-Up Function

```
Eff(t) = 1 - exp(-t / R)    where R = 40 days
```

~95% effectiveness after ~120 days of sustained participation.

### Asymmetric Decay

| Days Offline | Effectiveness |
|--------------|---------------|
| 0 (in grace) | 100% |
| 2 | 85% (step penalty) |
| 7 | 30% |
| 14 | 5% |
| 21 | <1% (reset) |

**Key Asymmetry:** ~21 days to lose effectiveness, ~120 days to regain it.

---

## Sybil Resistance

### Cost Scaling (Superlinear)

| Nodes | Cost/Node/Month | Challenge Pass Rate |
|-------|-----------------|---------------------|
| 10 | $3 | 95% |
| 100 | $3.50 | 88% |
| 1000 | $5+ | 75% |

### Attack ROI (1000-node network)

| Token Price | 10 Nodes | 100 Nodes | Viable? |
|-------------|----------|-----------|---------|
| $0.01 | -$975 | -$10,678 | ❌ |
| $0.10 | -$656 | -$7,782 | ❌ |
| $0.25 | -$125 | -$2,955 | ❌ |
| $0.50 | +$760 | +$5,100 | ⚠️ Marginal |

### Load-Responsive Security

Security scales with network observables (no price oracles):

| Activity Level | Sample Rate | Audit Rate | Clawback | Ban Duration |
|----------------|-------------|------------|----------|--------------|
| Low | 8% | 2.5% | 10d | 15d |
| Normal | 10% | 5% | 14d | 30d |
| High | 13% | 7.5% | 18d | 45d |
| Critical | 18% | 12.5% | 21d | 60d |

---

## Economic Model

### Participant Costs

| Class | Hardware | Power | Monthly Cost | Break-Even |
|-------|----------|-------|--------------|------------|
| **Hobbyist** | Raspberry Pi | 5W | **$3** | **$0.13** |
| Enthusiast | Gaming PC | 50W | $8 | $0.36 |
| Professional | Mini-server | 100W | $25 | $0.97 |
| Datacenter | Cloud | N/A | $80 | $3.06 |

### Emission Schedule

```
Em(t) = Em₀ × exp(-t / τ)
```

- Initial rate: 1000 tokens/day
- τ = 1460 days (~4 years)
- Max supply: 1,460,000 tokens
- 50% emitted by ~2.8 years

---

## Adversarial Testing

### Adaptive Fraud Strategies (All Negative EV)

| Strategy | Detection Rate | EV Difference |
|----------|---------------|---------------|
| Low-Rate (1/week) | 99% | -$516 |
| Stochastic (10%) | 100% | -$2,585 |
| Gray Fraud (60% detection) | 100% | -$5,037 |
| Burst Fraud | 100% | -$3,161 |
| Sampling-Aware | 100% | -$5,197 |
| Rotating Identity | 100% | -$2,537 |

### Selective Griefing (All Inefficient)

| Strategy | Damage Efficiency |
|----------|------------------|
| Random targeting | 0.08x |
| Lowest-bandwidth | 0.10x |
| Near-edge nodes | 0.16x |
| Mid-ramp nodes | 0.10x |
| Most-vulnerable | 0.10x |

Attacker loses ~$10 for every $1 of damage caused.

### Near-Zero Fraud (3-Year Horizon)

| Fraud Frequency | Detection Rate | EV Difference |
|-----------------|---------------|---------------|
| 1 per 30 days | 88% | -$426 |
| 1 per 60 days | 68% | -$331 |
| 1 per 90 days | 52% | -$248 |
| 1 per 180 days | 31% | -$145 |
| 1 per 365 days | 11% | -$55 |

Even 1 fraud per year is negative EV.

### Parameter Sensitivity

Defense holds across all variations:

| Parameter | 50% Reduction | Result |
|-----------|---------------|--------|
| Sample Rate | 5% | ✅ OK |
| Audit Rate | 2.5% | ✅ OK |
| Churn | 2.5% | ✅ OK |
| Detection Prob | 57% | ✅ OK |

---

## Open Questions

- [ ] Concrete consensus mechanism selection
- [ ] Geographic latency requirements
- [ ] Hardware attestation (optional tier)
- [ ] Multi-machine prototype implementation

---

## Project Structure

```
Anvil/
├── readme.md                     # This document
├── STRESS_TEST_FINDINGS.md       # Detailed analysis
├── package.json                  # npm scripts
└── simulation/
    ├── index.js                  # Main simulation
    ├── test-runner.js            # 36 unit tests
    ├── stress-test.js            # Reality stress tests
    ├── cheat-ev-analysis.js      # Fraud EV analysis
    ├── adaptive-fraud-test.js    # Adaptive strategies
    ├── load-responsive-test.js   # Dynamic security
    ├── griefing-test.js          # Penalty weaponization
    ├── edge-cases-test.js        # Final adversarial
    └── core/
        ├── effectiveness.js      # Ramp/decay
        ├── emission.js           # Token emission
        ├── rewards.js            # Distribution
        ├── reliability.js        # Failure distributions
        ├── verification.js       # Fraud detection
        ├── attackers.js          # Attack strategies
        └── anti-gaming.js        # Edge compliance defense
```

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| Consumer hardware viable | ✅ Hobbyist @ $0.13 |
| Predictable returns | ✅ Proportional to effectiveness |
| Industrial actors limited | ✅ Superlinear costs |
| Fraud unprofitable | ✅ All strategies negative EV |
| Edge gaming penalized | ✅ Anti-gaming scoring |
| Griefing inefficient | ✅ 0.08-0.16x efficiency |
| Graceful degradation | ✅ Holds at 50% parameters |

---

**Final Statement:**

> **This network survives only if people want it to exist.**  
> **That is not a flaw. That is the filter.**

---

*Protocol passes all adversarial tests. Ready for multi-machine prototype.*
