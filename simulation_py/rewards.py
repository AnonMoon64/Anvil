"""
Reward Distribution Module
Handles participation-normalized reward calculations
"""

from config import CONFIG
from emission import calculate_emission


class SmoothedEffectiveness:
    """
    Smoothed total effectiveness tracker
    Uses exponential moving average to reduce volatility
    """
    
    def __init__(self):
        self.value = 0
        self.alpha = CONFIG["smoothing"]["alpha"]
        self.initialized = False
    
    def update(self, total_effectiveness: float) -> float:
        """Update with new total effectiveness"""
        if not self.initialized:
            self.value = total_effectiveness
            self.initialized = True
        else:
            self.value = self.alpha * total_effectiveness + (1 - self.alpha) * self.value
        return self.value
    
    def get_value(self) -> float:
        """Get current smoothed value"""
        return self.value
    
    def reset(self):
        """Reset the smoother"""
        self.value = 0
        self.initialized = False


def calculate_node_reward(node_effectiveness: float, smoothed_total: float, 
                          epoch_emission: float) -> float:
    """
    Calculate reward for a single node
    Reward_i = Em_epoch * (Eff_i / S_t)
    
    Args:
        node_effectiveness: Node's effectiveness weight
        smoothed_total: Smoothed total of all effectiveness
        epoch_emission: Total tokens emitted this epoch
        
    Returns:
        Tokens rewarded to this node
    """
    if smoothed_total == 0:
        return 0
    return epoch_emission * (node_effectiveness / smoothed_total)


def calculate_network_rewards(nodes: list, days_since_genesis: int, 
                              smoother: SmoothedEffectiveness) -> dict:
    """
    Calculate rewards for all nodes in a network
    
    Args:
        nodes: List of node dicts with id and effectiveness
        days_since_genesis: Current day
        smoother: Smoothed effectiveness tracker
        
    Returns:
        Reward distribution data
    """
    total_effectiveness = sum(node["effectiveness"] for node in nodes)
    smoothed_total = smoother.update(total_effectiveness)
    epoch_emission = calculate_emission(days_since_genesis)
    
    rewards = []
    for node in nodes:
        reward = calculate_node_reward(node["effectiveness"], smoothed_total, epoch_emission)
        share = node["effectiveness"] / total_effectiveness if total_effectiveness > 0 else 0
        rewards.append({
            "id": node["id"],
            "effectiveness": node["effectiveness"],
            "reward": reward,
            "share": share,
        })
    
    return {
        "day": days_since_genesis,
        "epoch_emission": epoch_emission,
        "total_effectiveness": total_effectiveness,
        "smoothed_total_effectiveness": smoothed_total,
        "node_count": len(nodes),
        "rewards": rewards,
        "gini_coefficient": calculate_gini([r["reward"] for r in rewards]),
    }


def calculate_gini(values: list) -> float:
    """
    Calculate Gini coefficient for inequality measurement
    
    Args:
        values: List of values (e.g., rewards)
        
    Returns:
        Gini coefficient (0 = perfect equality, 1 = perfect inequality)
    """
    if not values:
        return 0
    
    n = len(values)
    sorted_values = sorted(values)
    total = sum(sorted_values)
    
    if total == 0:
        return 0
    
    weighted_sum = sum((i + 1) * v for i, v in enumerate(sorted_values))
    
    return (2 * weighted_sum) / (n * total) - (n + 1) / n


def analyze_reward_dilution(existing_nodes: int, new_nodes: int, 
                            new_node_effectiveness: float, epoch_emission: float) -> dict:
    """
    Simulate reward dilution when new nodes join
    
    Args:
        existing_nodes: Number of existing full-effectiveness nodes
        new_nodes: Number of new nodes joining
        new_node_effectiveness: Effectiveness of new nodes (0-1)
        epoch_emission: Tokens emitted per epoch
        
    Returns:
        Dilution analysis
    """
    # Before new nodes
    before_total_eff = existing_nodes * 1.0  # Assume full effectiveness
    before_reward_per_node = epoch_emission / existing_nodes
    
    # After new nodes
    after_total_eff = before_total_eff + (new_nodes * new_node_effectiveness)
    after_reward_existing = epoch_emission * (1.0 / after_total_eff)
    after_reward_new = epoch_emission * (new_node_effectiveness / after_total_eff)
    
    dilution = ((before_reward_per_node - after_reward_existing) / before_reward_per_node) * 100
    
    return {
        "before": {
            "total_effectiveness": before_total_eff,
            "reward_per_node": before_reward_per_node,
        },
        "after": {
            "total_effectiveness": after_total_eff,
            "reward_per_existing_node": after_reward_existing,
            "reward_per_new_node": after_reward_new,
        },
        "dilution_percent": dilution,
    }
