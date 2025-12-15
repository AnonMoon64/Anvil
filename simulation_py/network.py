"""
Network Simulation Module
Manages the entire network of nodes
"""

import random
from node import Node, NodeFactory
from rewards import SmoothedEffectiveness, calculate_network_rewards, calculate_gini
from emission import calculate_emission, calculate_total_emitted


class Network:
    """Represents the entire network"""
    
    def __init__(self):
        self.nodes = {}
        self.current_day = 0
        self.smoother = SmoothedEffectiveness()
        self.history = []
        
        NodeFactory.reset()
    
    def add_node(self, node: Node):
        """Add a node to the network"""
        self.nodes[node.id] = node
    
    def remove_node(self, node_id: str):
        """Remove a node from the network"""
        if node_id in self.nodes:
            del self.nodes[node_id]
    
    def get_node(self, node_id: str) -> Node:
        """Get a node by ID"""
        return self.nodes.get(node_id)
    
    def tick(self) -> dict:
        """Simulate one day"""
        self.current_day += 1
        
        # Update all nodes and collect effectiveness
        node_data = []
        for node in self.nodes.values():
            # Handle intermittent nodes
            if node.type == 'intermittent' and node.uptime_percent < 100:
                should_be_online = random.random() * 100 < node.uptime_percent
                if should_be_online and not node.is_online:
                    node.go_online()
                elif not should_be_online and node.is_online:
                    node.go_offline()
            
            effectiveness = node.tick(self.current_day)
            if self.current_day >= node.join_day:
                node_data.append({
                    "id": node.id,
                    "effectiveness": effectiveness,
                    "type": node.type,
                })
        
        # Calculate rewards
        reward_data = calculate_network_rewards(node_data, self.current_day, self.smoother)
        
        # Distribute rewards to nodes
        for reward in reward_data["rewards"]:
            node = self.nodes.get(reward["id"])
            if node:
                node.add_reward(reward["reward"])
        
        # Record history
        day_summary = {
            "day": self.current_day,
            "node_count": len(node_data),
            "total_effectiveness": reward_data["total_effectiveness"],
            "smoothed_effectiveness": reward_data["smoothed_total_effectiveness"],
            "epoch_emission": reward_data["epoch_emission"],
            "total_emitted": calculate_total_emitted(self.current_day),
            "gini_coefficient": reward_data["gini_coefficient"],
            "avg_effectiveness": reward_data["total_effectiveness"] / len(node_data) if node_data else 0,
            "nodes_by_type": self._count_by_type(node_data),
        }
        
        self.history.append(day_summary)
        
        return day_summary
    
    def simulate(self, days: int, on_tick=None) -> list:
        """Run simulation for multiple days"""
        results = []
        
        for i in range(days):
            summary = self.tick()
            results.append(summary)
            
            if on_tick:
                on_tick(summary)
        
        return results
    
    def _count_by_type(self, node_data: list) -> dict:
        """Count nodes by type"""
        counts = {"honest": 0, "attacker": 0, "intermittent": 0}
        for node in node_data:
            node_type = node.get("type", "honest")
            counts[node_type] = counts.get(node_type, 0) + 1
        return counts
    
    def get_stats(self) -> dict:
        """Get network statistics"""
        nodes = list(self.nodes.values())
        rewards = [n.total_rewards for n in nodes]
        
        return {
            "total_nodes": len(nodes),
            "current_day": self.current_day,
            "total_rewards_distributed": sum(rewards),
            "avg_reward_per_node": sum(rewards) / len(rewards) if rewards else 0,
            "max_reward": max(rewards) if rewards else 0,
            "min_reward": min(rewards) if rewards else 0,
            "reward_gini": calculate_gini(rewards),
            "nodes_by_type": self._count_by_type([{"type": n.type} for n in nodes]),
        }
    
    def get_leaderboard(self, limit: int = 10) -> list:
        """Get node leaderboard"""
        nodes = sorted(self.nodes.values(), key=lambda n: n.total_rewards, reverse=True)
        return [n.get_summary() for n in nodes[:limit]]
    
    def get_effectiveness_distribution(self) -> dict:
        """Get effectiveness distribution"""
        effectivenesses = [n.get_effectiveness() for n in self.nodes.values()]
        
        buckets = {
            "0-10%": 0,
            "10-25%": 0,
            "25-50%": 0,
            "50-75%": 0,
            "75-90%": 0,
            "90-100%": 0,
        }
        
        for eff in effectivenesses:
            percent = eff * 100
            if percent < 10:
                buckets["0-10%"] += 1
            elif percent < 25:
                buckets["10-25%"] += 1
            elif percent < 50:
                buckets["25-50%"] += 1
            elif percent < 75:
                buckets["50-75%"] += 1
            elif percent < 90:
                buckets["75-90%"] += 1
            else:
                buckets["90-100%"] += 1
        
        return buckets
    
    def reset(self):
        """Reset network state"""
        self.nodes.clear()
        self.current_day = 0
        self.smoother.reset()
        self.history = []
        NodeFactory.reset()
