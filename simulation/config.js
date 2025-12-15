/**
 * Anvil Protocol Simulation Configuration
 * All time values are in days unless otherwise noted
 */

export const CONFIG = {
  // Time-Weighted Effectiveness Parameters
  effectiveness: {
    // Ramp-up time constant (days)
    // R = 40 days means ~95% effectiveness at ~120 days
    rampTimeConstant: 40,
    
    // Decay parameters (asymmetric - faster than ramp)
    decayGracePeriodDays: 1,      // Grace period before decay starts
    decayStepPenalty: 0.15,       // Immediate 15% penalty after grace
    decayHalfLifeDays: 3,         // Half-life during exponential decay
    decayResetThreshold: 0.01,    // Below this = effective reset
  },

  // Emission Schedule Parameters
  emission: {
    // Initial emission rate (tokens per epoch)
    initialRate: 1000,
    
    // Decay time constant (days)
    // τ = 1460 days (~4 years) means emission halves roughly every 2.8 years
    decayTimeConstant: 1460,
    
    // Epoch duration (days)
    epochDurationDays: 1,
  },

  // Reward Smoothing Parameters
  smoothing: {
    // EMA smoothing factor (0-1, lower = smoother)
    alpha: 0.1,
  },

  // Hardware Constraints (memory in GB)
  hardware: {
    memoryPerNode: 4,  // GB required per effective node
    profiles: {
      raspberryPi: { memory: 4, maxNodes: 1 },
      laptop: { memory: 8, maxNodes: 2 },
      gamingPC: { memory: 32, maxNodes: 6 },
      server: { memory: 128, maxNodes: 24 },
    },
  },

  // Sybil Cost Parameters
  sybil: {
    // Cost per node per month (USD)
    hardwareCostPerNode: 100,       // One-time amortized monthly
    electricityCostPerMonth: 2,     // Per node
    bandwidthCostPerMonth: 1,       // Per node
    operationalOverheadBase: 10,    // Base monthly ops cost
    operationalOverheadPerNode: 0.5, // Scales with nodes
    
    // Failure rate increases with scale (% chance per day per node)
    baseFailureRate: 0.005,         // 0.5% daily failure chance
    scaleFailureMultiplier: 0.0001, // Additional % per extra node
  },

  // Bootstrap Phase Thresholds
  bootstrap: {
    minEffectiveNodes: 1000,
    maxGiniCoefficient: 0.6,
    minMedianNodeAgeDays: 90,
  },

  // Simulation Parameters
  simulation: {
    defaultDurationDays: 365,       // 1 year simulation
    ticksPerDay: 24,                // Hourly resolution
  },
};

export default CONFIG;
