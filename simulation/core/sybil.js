/**
 * Sybil Attack Cost Analysis Module
 * Models the economics of running multiple nodes at scale
 */

import CONFIG from '../config.js';
import { calculateRamp, daysToReachEffectiveness } from './effectiveness.js';

/**
 * Calculate monthly operating cost for an operator
 * 
 * @param {number} nodeCount - Number of nodes operated
 * @returns {Object} Cost breakdown
 */
export function calculateMonthlyCost(nodeCount) {
    const {
        hardwareCostPerNode,
        electricityCostPerMonth,
        bandwidthCostPerMonth,
        operationalOverheadBase,
        operationalOverheadPerNode,
    } = CONFIG.sybil;

    const hardware = hardwareCostPerNode * nodeCount;
    const electricity = electricityCostPerMonth * nodeCount;
    const bandwidth = bandwidthCostPerMonth * nodeCount;
    const operations = operationalOverheadBase + (operationalOverheadPerNode * nodeCount);

    // Total operational overhead grows superlinearly
    const scalePenalty = Math.pow(nodeCount / 10, 1.2); // Superlinear scaling
    const operationsWithScale = operations * (1 + scalePenalty);

    return {
        hardware,
        electricity,
        bandwidth,
        operations: operationsWithScale,
        total: hardware + electricity + bandwidth + operationsWithScale,
        perNode: (hardware + electricity + bandwidth + operationsWithScale) / nodeCount,
    };
}

/**
 * Calculate expected daily failure rate at scale
 * 
 * @param {number} nodeCount - Number of nodes
 * @returns {number} Expected failures per day
 */
export function calculateDailyFailures(nodeCount) {
    const { baseFailureRate, scaleFailureMultiplier } = CONFIG.sybil;
    const failureRatePerNode = baseFailureRate + (scaleFailureMultiplier * nodeCount);
    return nodeCount * failureRatePerNode;
}

/**
 * Calculate effective average effectiveness considering failures
 * 
 * @param {number} nodeCount - Number of nodes
 * @param {number} targetEffectiveness - Target effectiveness per node
 * @param {number} simulationDays - Days to simulate
 * @returns {Object} Effectiveness analysis
 */
export function calculateEffectiveAverageEffectiveness(nodeCount, targetEffectiveness, simulationDays) {
    const dailyFailures = calculateDailyFailures(nodeCount);
    const daysToRecover = daysToReachEffectiveness(targetEffectiveness);

    // Average nodes in degraded state due to failures
    // If a node fails and takes X days to recover, on average X/simulationDays
    // proportion of nodes are recovering at any time
    const avgRecoveringNodes = Math.min(dailyFailures * daysToRecover, nodeCount);
    const healthyNodes = nodeCount - avgRecoveringNodes;

    // Healthy nodes have target effectiveness
    // Recovering nodes have on average half the target (midpoint of ramp)
    const avgRecoveringEffectiveness = targetEffectiveness * 0.5;

    const totalEffectiveness =
        (healthyNodes * targetEffectiveness) +
        (avgRecoveringNodes * avgRecoveringEffectiveness);

    return {
        nodeCount,
        healthyNodes,
        recoveringNodes: avgRecoveringNodes,
        averageEffectivenessPerNode: totalEffectiveness / nodeCount,
        totalEffectiveness,
        effectivenessLossPercent: (1 - (totalEffectiveness / (nodeCount * targetEffectiveness))) * 100,
    };
}

/**
 * Analyze Sybil attack return on investment
 * 
 * @param {number} nodeCount - Number of attacker nodes
 * @param {number} networkTotalNodes - Total nodes in network
 * @param {number} tokenPriceUSD - Price per token in USD
 * @param {number} dailyEmission - Tokens emitted per day
 * @param {number} attackerEffectiveness - Attacker's average effectiveness per node
 * @param {number} networkAvgEffectiveness - Network's average effectiveness per node
 * @returns {Object} ROI analysis
 */
export function analyzeSybilROI(
    nodeCount,
    networkTotalNodes,
    tokenPriceUSD,
    dailyEmission,
    attackerEffectiveness = 0.9,
    networkAvgEffectiveness = 0.8
) {
    // Calculate attacker's share
    const attackerTotalEff = nodeCount * attackerEffectiveness;
    const networkOtherEff = (networkTotalNodes - nodeCount) * networkAvgEffectiveness;
    const totalNetworkEff = attackerTotalEff + networkOtherEff;

    const attackerShare = attackerTotalEff / totalNetworkEff;
    const dailyTokensEarned = dailyEmission * attackerShare;
    const dailyRevenueUSD = dailyTokensEarned * tokenPriceUSD;
    const monthlyRevenueUSD = dailyRevenueUSD * 30;

    // Calculate costs
    const monthlyCost = calculateMonthlyCost(nodeCount);

    // ROI
    const monthlyProfit = monthlyRevenueUSD - monthlyCost.total;
    const profitMargin = (monthlyProfit / monthlyRevenueUSD) * 100;

    // Break-even analysis
    const breakEvenTokenPrice = monthlyCost.total / (dailyTokensEarned * 30);

    return {
        nodeCount,
        attackerShare: attackerShare * 100,
        dailyTokensEarned,
        dailyRevenueUSD,
        monthlyRevenueUSD,
        monthlyCost: monthlyCost.total,
        monthlyProfit,
        profitMargin,
        breakEvenTokenPrice,
        costPerNode: monthlyCost.perNode,
        isProftable: monthlyProfit > 0,
    };
}

/**
 * Generate Sybil cost curve for different scales
 * 
 * @param {number} maxNodes - Maximum nodes to analyze
 * @param {number} networkBaseNodes - Base network size (honest nodes)
 * @param {number} tokenPriceUSD - Token price
 * @param {number} dailyEmission - Daily emission
 * @returns {Array<Object>} Cost curve data
 */
export function generateSybilCostCurve(maxNodes, networkBaseNodes, tokenPriceUSD, dailyEmission) {
    const curve = [];

    for (let nodes = 1; nodes <= maxNodes; nodes++) {
        const roi = analyzeSybilROI(
            nodes,
            networkBaseNodes + nodes,
            tokenPriceUSD,
            dailyEmission
        );

        curve.push({
            nodes,
            costPerNode: roi.costPerNode,
            revenuePerNode: roi.monthlyRevenueUSD / nodes,
            profitPerNode: roi.monthlyProfit / nodes,
            totalProfit: roi.monthlyProfit,
            networkShare: roi.attackerShare,
        });
    }

    return curve;
}

/**
 * Find optimal scale for attacker (maximum total profit)
 * 
 * @param {number} networkBaseNodes - Base network size
 * @param {number} tokenPriceUSD - Token price
 * @param {number} dailyEmission - Daily emission
 * @param {number} maxSearch - Maximum nodes to search
 * @returns {Object} Optimal scale analysis
 */
export function findOptimalAttackerScale(networkBaseNodes, tokenPriceUSD, dailyEmission, maxSearch = 1000) {
    let optimalNodes = 0;
    let maxProfit = -Infinity;
    let optimalData = null;

    for (let nodes = 1; nodes <= maxSearch; nodes++) {
        const roi = analyzeSybilROI(nodes, networkBaseNodes + nodes, tokenPriceUSD, dailyEmission);

        if (roi.monthlyProfit > maxProfit) {
            maxProfit = roi.monthlyProfit;
            optimalNodes = nodes;
            optimalData = roi;
        }
    }

    return {
        optimalNodeCount: optimalNodes,
        maxMonthlyProfit: maxProfit,
        details: optimalData,
    };
}

export default {
    calculateMonthlyCost,
    calculateDailyFailures,
    calculateEffectiveAverageEffectiveness,
    analyzeSybilROI,
    generateSybilCostCurve,
    findOptimalAttackerScale,
};
