"""
Node Simulation Module
Represents individual participants in the network
"""

import random
from effectiveness import calculate_ramp, calculate_decay


class Node:
    """Represents a single node in the network"""
    
    def __init__(self, node_id: str, join_day: int = 0, node_type: str = 'honest'):
        self.id = node_id
        self.join_day = join_day
        self.type = node_type
        
        # State tracking
        self.is_online = True
        self.participation_days = 0
        self.offline_days = 0
        self.effectiveness_when_offline = 0
        self.total_rewards = 0
        
        # History for analysis
        self.history = []
        
        # For intermittent nodes
        self.uptime_percent = 100
    
    def tick(self, current_day: int) -> float:
        """Update node state for a new day"""
        if current_day < self.join_day:
            return 0
        
        if self.is_online:
            self.participation_days += 1
            self.offline_days = 0
            effectiveness = calculate_ramp(self.participation_days)
        else:
            self.offline_days += 1
            effectiveness = calculate_decay(self.effectiveness_when_offline, self.offline_days)
            
            # If effectively reset, clear participation
            if effectiveness == 0:
                self.participation_days = 0
        
        self.history.append({
            "day": current_day,
            "effectiveness": effectiveness,
            "is_online": self.is_online,
            "participation_days": self.participation_days,
        })
        
        return effectiveness
    
    def go_offline(self):
        """Take node offline"""
        if self.is_online:
            self.effectiveness_when_offline = calculate_ramp(self.participation_days)
            self.is_online = False
    
    def go_online(self):
        """Bring node back online"""
        if not self.is_online:
            import math
            current_eff = calculate_decay(self.effectiveness_when_offline, self.offline_days)
            
            # Convert current effectiveness back to equivalent participation days
            if current_eff > 0:
                R = 40  # From config
                self.participation_days = -R * math.log(1 - current_eff)
            else:
                self.participation_days = 0
            
            self.is_online = True
            self.offline_days = 0
    
    def add_reward(self, amount: float):
        """Add rewards to node"""
        self.total_rewards += amount
    
    def get_effectiveness(self) -> float:
        """Get current effectiveness"""
        if not self.history:
            return 0
        return self.history[-1]["effectiveness"]
    
    def get_summary(self) -> dict:
        """Get node summary"""
        return {
            "id": self.id,
            "type": self.type,
            "join_day": self.join_day,
            "participation_days": self.participation_days,
            "is_online": self.is_online,
            "current_effectiveness": self.get_effectiveness(),
            "total_rewards": self.total_rewards,
        }


class NodeFactory:
    """Factory for creating different node types"""
    
    _counter = 0
    
    @classmethod
    def create_honest(cls, join_day: int = 0) -> Node:
        """Create an honest node that stays online"""
        cls._counter += 1
        return Node(f"honest-{cls._counter}", join_day, 'honest')
    
    @classmethod
    def create_intermittent(cls, join_day: int = 0, uptime_percent: int = 80) -> Node:
        """Create an intermittent node with random availability"""
        cls._counter += 1
        node = Node(f"intermittent-{cls._counter}", join_day, 'intermittent')
        node.uptime_percent = uptime_percent
        return node
    
    @classmethod
    def create_attacker(cls, join_day: int = 0) -> Node:
        """Create an attacker node"""
        cls._counter += 1
        return Node(f"attacker-{cls._counter}", join_day, 'attacker')
    
    @classmethod
    def reset(cls):
        """Reset counter"""
        cls._counter = 0
