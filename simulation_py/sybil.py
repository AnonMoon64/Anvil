"""
Sybil Attack Cost Analysis Module
Models the economics of running multiple nodes at scale
"""

import math
from config import CONFIG
from effectiveness import calculate_ramp, days_to_reach_effectiveness


def calculate_monthly_cost(node_count: int) -> dict:
    """
    Calculate monthly operating cost for an operator
    
    Args:
        node_count: Number of nodes operated
        
    Returns:
        Cost breakdown dict
    """
    sybil_config = CONFIG["sybil"]
    
    hardware = sybil_config["hardware_cost_per_node"] * node_count
    electricity = sybil_config["electricity_cost_per_month"] * node_count
    bandwidth = sybil_config["bandwidth_cost_per_month"] * node_count
    operations = (sybil_config["operational_overhead_base"] + 
                  sybil_config["operational_overhead_per_node"] * node_count)
    
    # Total operational overhead grows superlinearly
    scale_penalty = (node_count / 10) ** 1.2
    operations_with_scale = operations * (1 + scale_penalty)
    
    total = hardware + electricity + bandwidth + operations_with_scale
    
    return {
        "hardware": hardware,
        "electricity": electricity,
        "bandwidth": bandwidth,
        "operations": operations_with_scale,
        "total": total,
        "per_node": total / node_count,
    }


def calculate_daily_failures(node_count: int) -> float:
    """
    Calculate expected daily failure rate at scale
    
    Args:
        node_count: Number of nodes
        
    Returns:
        Expected failures per day
    """
    sybil_config = CONFIG["sybil"]
    base_rate = sybil_config["base_failure_rate"]
    scale_mult = sybil_config["scale_failure_multiplier"]
    
    failure_rate_per_node = base_rate + (scale_mult * node_count)
    return node_count * failure_rate_per_node


def calculate_effective_avg_effectiveness(node_count: int, target_effectiveness: float,
                                          simulation_days: int) -> dict:
    """
    Calculate effective average effectiveness considering failures
    
    Args:
        node_count: Number of nodes
        target_effectiveness: Target effectiveness per node
        simulation_days: Days to simulate
        
    Returns:
        Effectiveness analysis
    """
    daily_failures = calculate_daily_failures(node_count)
    days_to_recover = days_to_reach_effectiveness(target_effectiveness)
    
    # Average nodes in degraded state due to failures
    avg_recovering_nodes = min(daily_failures * days_to_recover, node_count)
    healthy_nodes = node_count - avg_recovering_nodes
    
    # Recovering nodes average half the target effectiveness
    avg_recovering_eff = target_effectiveness * 0.5
    
    total_eff = (healthy_nodes * target_effectiveness) + (avg_recovering_nodes * avg_recovering_eff)
    
    ideal_total = node_count * target_effectiveness
    eff_loss = (1 - (total_eff / ideal_total)) * 100 if ideal_total > 0 else 0
    
    return {
        "node_count": node_count,
        "healthy_nodes": healthy_nodes,
        "recovering_nodes": avg_recovering_nodes,
        "average_effectiveness_per_node": total_eff / node_count,
        "total_effectiveness": total_eff,
        "effectiveness_loss_percent": eff_loss,
    }


def analyze_sybil_roi(node_count: int, network_total_nodes: int, token_price_usd: float,
                      daily_emission: float, attacker_effectiveness: float = 0.9,
                      network_avg_effectiveness: float = 0.8) -> dict:
    """
    Analyze Sybil attack return on investment
    
    Args:
        node_count: Number of attacker nodes
        network_total_nodes: Total nodes in network
        token_price_usd: Price per token in USD
        daily_emission: Tokens emitted per day
        attacker_effectiveness: Attacker's average effectiveness per node
        network_avg_effectiveness: Network's average effectiveness per node
        
    Returns:
        ROI analysis
    """
    # Calculate attacker's share
    attacker_total_eff = node_count * attacker_effectiveness
    network_other_eff = (network_total_nodes - node_count) * network_avg_effectiveness
    total_network_eff = attacker_total_eff + network_other_eff
    
    attacker_share = attacker_total_eff / total_network_eff
    daily_tokens = daily_emission * attacker_share
    daily_revenue = daily_tokens * token_price_usd
    monthly_revenue = daily_revenue * 30
    
    # Calculate costs
    monthly_cost = calculate_monthly_cost(node_count)
    
    # ROI
    monthly_profit = monthly_revenue - monthly_cost["total"]
    profit_margin = (monthly_profit / monthly_revenue) * 100 if monthly_revenue > 0 else 0
    
    # Break-even analysis
    break_even_price = monthly_cost["total"] / (daily_tokens * 30) if daily_tokens > 0 else float('inf')
    
    return {
        "node_count": node_count,
        "attacker_share": attacker_share * 100,
        "daily_tokens_earned": daily_tokens,
        "daily_revenue_usd": daily_revenue,
        "monthly_revenue_usd": monthly_revenue,
        "monthly_cost": monthly_cost["total"],
        "monthly_profit": monthly_profit,
        "profit_margin": profit_margin,
        "break_even_token_price": break_even_price,
        "cost_per_node": monthly_cost["per_node"],
        "is_profitable": monthly_profit > 0,
    }


def find_optimal_attacker_scale(network_base_nodes: int, token_price_usd: float,
                                 daily_emission: float, max_search: int = 1000) -> dict:
    """
    Find optimal scale for attacker (maximum total profit)
    
    Args:
        network_base_nodes: Base network size
        token_price_usd: Token price
        daily_emission: Daily emission
        max_search: Maximum nodes to search
        
    Returns:
        Optimal scale analysis
    """
    optimal_nodes = 0
    max_profit = float('-inf')
    optimal_data = None
    
    for nodes in range(1, max_search + 1):
        roi = analyze_sybil_roi(nodes, network_base_nodes + nodes, token_price_usd, daily_emission)
        
        if roi["monthly_profit"] > max_profit:
            max_profit = roi["monthly_profit"]
            optimal_nodes = nodes
            optimal_data = roi
    
    return {
        "optimal_node_count": optimal_nodes,
        "max_monthly_profit": max_profit,
        "details": optimal_data,
    }
