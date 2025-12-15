"""
Effectiveness Calculation Module
Handles ramp-up and decay functions for node effectiveness
"""

import math
from config import CONFIG


def calculate_ramp(participation_days: float) -> float:
    """
    Calculate effectiveness ramp-up
    Eff(t) = 1 - exp(-t / R)
    
    Args:
        participation_days: Cumulative successful participation time in days
        
    Returns:
        Effectiveness value between 0 and 1
    """
    R = CONFIG["effectiveness"]["ramp_time_constant"]
    return 1 - math.exp(-participation_days / R)


def calculate_decay(starting_effectiveness: float, offline_days: float) -> float:
    """
    Calculate effectiveness decay during offline period
    Decay is asymmetric and punitive (faster than ramp)
    
    Args:
        starting_effectiveness: Effectiveness when node went offline
        offline_days: Days since going offline
        
    Returns:
        Current effectiveness value
    """
    eff_config = CONFIG["effectiveness"]
    grace_period = eff_config["decay_grace_period_days"]
    step_penalty = eff_config["decay_step_penalty"]
    half_life = eff_config["decay_half_life_days"]
    reset_threshold = eff_config["decay_reset_threshold"]
    
    # Within grace period - no decay
    if offline_days <= grace_period:
        return starting_effectiveness
    
    # Apply step penalty after grace period
    after_step_penalty = starting_effectiveness * (1 - step_penalty)
    
    # Calculate exponential decay after step penalty
    decay_days = offline_days - grace_period
    decay_rate = math.log(2) / half_life
    decayed_effectiveness = after_step_penalty * math.exp(-decay_rate * decay_days)
    
    # Return 0 if below reset threshold
    return 0 if decayed_effectiveness < reset_threshold else decayed_effectiveness


def get_effectiveness_trajectory(max_days: int, mode: str = 'ramp', 
                                  starting_effectiveness: float = 1.0) -> list:
    """
    Get effectiveness trajectory for visualization
    
    Args:
        max_days: Maximum days to calculate
        mode: 'ramp' or 'decay'
        starting_effectiveness: Starting effectiveness for decay mode
        
    Returns:
        List of dicts with day and effectiveness
    """
    trajectory = []
    
    for day in range(max_days + 1):
        if mode == 'ramp':
            effectiveness = calculate_ramp(day)
        else:
            effectiveness = calculate_decay(starting_effectiveness, day)
        
        trajectory.append({"day": day, "effectiveness": effectiveness})
    
    return trajectory


def days_to_reach_effectiveness(target_effectiveness: float) -> float:
    """
    Calculate days to reach target effectiveness during ramp-up
    
    Args:
        target_effectiveness: Target effectiveness (0-1)
        
    Returns:
        Days to reach target
    """
    R = CONFIG["effectiveness"]["ramp_time_constant"]
    # Eff(t) = 1 - exp(-t/R)
    # t = -R * ln(1 - targetEff)
    return -R * math.log(1 - target_effectiveness)


def days_until_decay_threshold(starting_effectiveness: float, threshold: float) -> float:
    """
    Calculate days until effectiveness drops below threshold during decay
    
    Args:
        starting_effectiveness: Starting effectiveness
        threshold: Target threshold
        
    Returns:
        Days until below threshold
    """
    eff_config = CONFIG["effectiveness"]
    grace_period = eff_config["decay_grace_period_days"]
    step_penalty = eff_config["decay_step_penalty"]
    half_life = eff_config["decay_half_life_days"]
    
    after_step_penalty = starting_effectiveness * (1 - step_penalty)
    
    if after_step_penalty <= threshold:
        return grace_period
    
    decay_rate = math.log(2) / half_life
    decay_days = -math.log(threshold / after_step_penalty) / decay_rate
    
    return grace_period + decay_days
