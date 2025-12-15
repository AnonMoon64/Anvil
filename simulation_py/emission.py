"""
Emission Schedule Module
Handles token emission calculations with smooth decay
"""

import math
from config import CONFIG


def calculate_emission(days_since_genesis: float) -> float:
    """
    Calculate emission rate at a given time
    Em(t) = Em0 * exp(-t / τ)
    
    Args:
        days_since_genesis: Days since network genesis
        
    Returns:
        Tokens emitted per epoch
    """
    initial_rate = CONFIG["emission"]["initial_rate"]
    decay_constant = CONFIG["emission"]["decay_time_constant"]
    return initial_rate * math.exp(-days_since_genesis / decay_constant)


def calculate_total_emitted(days_since_genesis: float) -> float:
    """
    Calculate total tokens emitted from genesis to a given day
    Integral of Em(t) from 0 to t = Em0 * τ * (1 - exp(-t / τ))
    
    Args:
        days_since_genesis: Days since network genesis
        
    Returns:
        Total tokens emitted
    """
    initial_rate = CONFIG["emission"]["initial_rate"]
    decay_constant = CONFIG["emission"]["decay_time_constant"]
    return initial_rate * decay_constant * (1 - math.exp(-days_since_genesis / decay_constant))


def calculate_remaining_supply(days_since_genesis: float) -> float:
    """
    Calculate remaining tokens to ever be emitted
    
    Args:
        days_since_genesis: Days since network genesis
        
    Returns:
        Remaining tokens to be emitted
    """
    return calculate_max_supply() - calculate_total_emitted(days_since_genesis)


def calculate_max_supply() -> float:
    """
    Calculate the asymptotic total supply
    As t → ∞, total emitted → Em0 * τ
    
    Returns:
        Maximum total supply
    """
    initial_rate = CONFIG["emission"]["initial_rate"]
    decay_constant = CONFIG["emission"]["decay_time_constant"]
    return initial_rate * decay_constant


def get_emission_trajectory(max_days: int) -> list:
    """
    Get emission trajectory for visualization
    
    Args:
        max_days: Maximum days to calculate
        
    Returns:
        List of emission data points
    """
    trajectory = []
    max_supply = calculate_max_supply()
    
    for day in range(max_days + 1):
        emission = calculate_emission(day)
        total_emitted = calculate_total_emitted(day)
        percent_emitted = (total_emitted / max_supply) * 100
        
        trajectory.append({
            "day": day,
            "emission": emission,
            "total_emitted": total_emitted,
            "percent_emitted": percent_emitted
        })
    
    return trajectory


def days_to_emit_percent(target_percent: float) -> float:
    """
    Calculate days until a certain percentage of supply is emitted
    
    Args:
        target_percent: Target percentage (0-100)
        
    Returns:
        Days to reach target
    """
    decay_constant = CONFIG["emission"]["decay_time_constant"]
    return -decay_constant * math.log(1 - target_percent / 100)


def compare_with_halving(max_days: int) -> dict:
    """
    Compare with Bitcoin-style halving for reference
    
    Args:
        max_days: Days to compare
        
    Returns:
        Comparison data
    """
    halving_interval = 365 * 4  # ~4 years like Bitcoin
    initial_rate = CONFIG["emission"]["initial_rate"]
    
    smooth = []
    halving = []
    
    for day in range(max_days + 1):
        halving_count = day // halving_interval
        halving_emission = initial_rate / (2 ** halving_count)
        
        smooth.append({"day": day, "emission": calculate_emission(day)})
        halving.append({"day": day, "emission": halving_emission})
    
    return {"smooth": smooth, "halving": halving}
