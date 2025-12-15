#!/usr/bin/env python3
"""Anvil Protocol Test Runner"""

import sys
import math
import random

sys.path.insert(0, '.')

from config import CONFIG
import effectiveness
import emission
import rewards
import sybil
from node import Node, NodeFactory
from network import Network

# Test framework
class TestResults:
    passed = 0
    failed = 0

results = TestResults()

GREEN = '\033[92m'
RED = '\033[91m'
CYAN = '\033[96m'
BOLD = '\033[1m'
RESET = '\033[0m'

def suite(name):
    print(f"\n{CYAN}▶ {name}{RESET}")

def test(name, fn):
    try:
        fn()
        results.passed += 1
        print(f"  {GREEN}✓{RESET} {name}")
    except Exception as e:
        results.failed += 1
        print(f"  {RED}✗{RESET} {name}: {e}")

def assert_approx(actual, expected, tol=0.01, msg=""):
    if abs(actual - expected) > tol:
        raise AssertionError(f"{msg}: got {actual}, expected {expected}")

def assert_range(val, lo, hi, msg=""):
    if val < lo or val > hi:
        raise AssertionError(f"{msg}: {val} not in [{lo}, {hi}]")

def assert_true(cond, msg=""):
    if not cond:
        raise AssertionError(msg)

# EFFECTIVENESS TESTS
suite('Effectiveness Ramp-Up')
test('starts at 0', lambda: assert_approx(effectiveness.calculate_ramp(0), 0, 0.001))
test('approaches 1', lambda: assert_range(effectiveness.calculate_ramp(1000), 0.99, 1))
test('~63% at R days', lambda: assert_approx(effectiveness.calculate_ramp(40), 0.632, 0.01))
test('~95% at 3R days', lambda: assert_approx(effectiveness.calculate_ramp(120), 0.95, 0.01))

suite('Effectiveness Decay')
test('no decay in grace', lambda: assert_approx(effectiveness.calculate_decay(0.9, 1), 0.9, 0.001))
test('step penalty', lambda: assert_approx(effectiveness.calculate_decay(1.0, 1.1), 0.85, 0.05))
test('resets to 0', lambda: assert_approx(effectiveness.calculate_decay(1.0, 30), 0, 0.01))
test('asymmetric', lambda: assert_true(effectiveness.days_to_reach_effectiveness(0.95) > 
    effectiveness.days_until_decay_threshold(1.0, 0.05) * 3))

# EMISSION TESTS
suite('Emission Schedule')
test('initial rate', lambda: assert_approx(emission.calculate_emission(0), 1000, 0.001))
test('decays over time', lambda: assert_true(emission.calculate_emission(100) > emission.calculate_emission(1000)))
test('max supply', lambda: assert_approx(emission.calculate_max_supply(), 1000 * 1460, 0.001))

# REWARD TESTS
suite('Reward Distribution')
test('gini equal', lambda: assert_approx(rewards.calculate_gini([100]*5), 0, 0.001))
test('gini unequal', lambda: assert_range(rewards.calculate_gini([0,0,0,0,100]), 0.7, 1))

def test_smoother():
    s = rewards.SmoothedEffectiveness()
    s.update(100)
    v = s.update(200)
    assert_range(v, 100, 200)
    assert_true(v < 150)

test('smoothing', test_smoother)

# SYBIL TESTS
suite('Sybil Attack Economics')
test('superlinear cost', lambda: assert_true(
    sybil.calculate_monthly_cost(100)["per_node"] > sybil.calculate_monthly_cost(10)["per_node"]))
test('failure scales', lambda: assert_true(
    sybil.calculate_daily_failures(100)/100 > sybil.calculate_daily_failures(10)/10))

# NODE TESTS
suite('Node Behavior')
test('node starts at 0', lambda: assert_approx(Node('t', 0).get_effectiveness(), 0, 0.001))

def test_node_builds():
    n = Node('t', 0)
    for d in range(1, 101):
        n.tick(d)
    assert_true(n.get_effectiveness() > 0.5)

test('builds eff', test_node_builds)

def test_node_decay():
    n = Node('t', 0)
    for d in range(1, 101):
        n.tick(d)
    before = n.get_effectiveness()
    n.go_offline()
    for d in range(101, 111):
        n.tick(d)
    assert_true(n.get_effectiveness() < before)

test('decays offline', test_node_decay)

# NETWORK TESTS
suite('Network Simulation')

def test_network():
    net = Network()
    for i in range(5):
        net.add_node(NodeFactory.create_honest(0))
    net.simulate(30)
    stats = net.get_stats()
    assert_true(stats["total_rewards_distributed"] > 0)
    net.reset()

test('distributes rewards', test_network)

def test_late_joiners():
    net = Network()
    early = NodeFactory.create_honest(0)
    late = NodeFactory.create_honest(50)
    net.add_node(early)
    net.add_node(late)
    net.simulate(100)
    assert_true(early.total_rewards > late.total_rewards)
    net.reset()

test('late joiners less rewards', test_late_joiners)

# INTEGRATION TESTS
suite('Integration Tests')

def test_full_sim():
    net = Network()
    for i in range(20):
        net.add_node(NodeFactory.create_honest(int(random.random() * 30)))
    for i in range(5):
        net.add_node(NodeFactory.create_intermittent(0, 70))
    for i in range(5):
        net.add_node(NodeFactory.create_attacker(30))
    r = net.simulate(365)
    assert_true(len(r) == 365)
    assert_true(net.get_stats()["total_nodes"] == 30)
    net.reset()

test('full year simulation', test_full_sim)

# RESULTS
print('\n' + '=' * 50)
print(f'{BOLD}TEST RESULTS{RESET}')
print('=' * 50)
print(f'  {GREEN}Passed: {results.passed}{RESET}')
print(f'  {RED}Failed: {results.failed}{RESET}')
print(f'  Total: {results.passed + results.failed}')
print('=' * 50)

if results.failed > 0:
    print(f'\n{RED}Some tests failed!{RESET}\n')
    sys.exit(1)
else:
    print(f'\n{GREEN}All tests passed!{RESET}\n')
    sys.exit(0)
