"""
Anvil Protocol Simulation Configuration
All time values are in days unless otherwise noted
"""

CONFIG = {
    # Time-Weighted Effectiveness Parameters
    "effectiveness": {
        # Ramp-up time constant (days)
        # R = 40 days means ~95% effectiveness at ~120 days
        "ramp_time_constant": 40,
        
        # Decay parameters (asymmetric - faster than ramp)
        "decay_grace_period_days": 1,      # Grace period before decay starts
        "decay_step_penalty": 0.15,        # Immediate 15% penalty after grace
        "decay_half_life_days": 3,         # Half-life during exponential decay
        "decay_reset_threshold": 0.01,     # Below this = effective reset
    },

    # Emission Schedule Parameters
    "emission": {
        # Initial emission rate (tokens per epoch)
        "initial_rate": 1000,
        
        # Decay time constant (days)
        # τ = 1460 days (~4 years) means emission halves roughly every 2.8 years
        "decay_time_constant": 1460,
        
        # Epoch duration (days)
        "epoch_duration_days": 1,
    },

    # Reward Smoothing Parameters
    "smoothing": {
        # EMA smoothing factor (0-1, lower = smoother)
        "alpha": 0.1,
    },

    # Hardware Constraints (memory in GB)
    "hardware": {
        "memory_per_node": 4,  # GB required per effective node
        "profiles": {
            "raspberry_pi": {"memory": 4, "max_nodes": 1},
            "laptop": {"memory": 8, "max_nodes": 2},
            "gaming_pc": {"memory": 32, "max_nodes": 6},
            "server": {"memory": 128, "max_nodes": 24},
        },
    },

    # Sybil Cost Parameters
    "sybil": {
        # Cost per node per month (USD)
        "hardware_cost_per_node": 100,       # One-time amortized monthly
        "electricity_cost_per_month": 2,     # Per node
        "bandwidth_cost_per_month": 1,       # Per node
        "operational_overhead_base": 10,     # Base monthly ops cost
        "operational_overhead_per_node": 0.5, # Scales with nodes
        
        # Failure rate increases with scale (% chance per day per node)
        "base_failure_rate": 0.005,          # 0.5% daily failure chance
        "scale_failure_multiplier": 0.0001,  # Additional % per extra node
    },

    # Bootstrap Phase Thresholds
    "bootstrap": {
        "min_effective_nodes": 1000,
        "max_gini_coefficient": 0.6,
        "min_median_node_age_days": 90,
    },

    # Simulation Parameters
    "simulation": {
        "default_duration_days": 365,       # 1 year simulation
        "ticks_per_day": 24,                # Hourly resolution
    },
}
