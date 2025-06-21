// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract PriceTrigger {
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable i_spikeThreshold; // Basis points (500 = 5%)
    uint256 public immutable i_cooldownPeriod; // Prevent rapid triggers

    // Track last trigger time per caller
    mapping(address => uint256) public lastTriggerTime;
    int256 public lastPrice;

    event PriceSpikeDetected(int256 currentPrice, int256 previousPrice, uint256 changePercent);
    event TradingDecisionGenerated(string decision);

    constructor(address _priceFeed, uint256 _spikeThreshold, uint256 _cooldownPeriod) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        i_spikeThreshold = _spikeThreshold;
        i_cooldownPeriod = _cooldownPeriod;

        // Initialize last price
        (, int256 initialPrice,,,) = priceFeed.latestRoundData();
        lastPrice = initialPrice;
    }

    function checkPriceSpike() external {
        // Use per-caller cooldown
        require(block.timestamp >= lastTriggerTime[msg.sender] + i_cooldownPeriod, "Cooldown active");
        lastTriggerTime[msg.sender] = block.timestamp;

        // Get current price
        (, int256 currentPrice,,,) = priceFeed.latestRoundData();

        // Store previous price BEFORE update
        int256 previousPrice = lastPrice;
        lastPrice = currentPrice;

        // Calculate percentage change
        uint256 changePercent = calculateChange(currentPrice, previousPrice);

        if (changePercent >= i_spikeThreshold) {
            emit PriceSpikeDetected(currentPrice, previousPrice, changePercent);

            string memory decision = currentPrice > previousPrice ? "sell" : "buy";
            emit TradingDecisionGenerated(decision);
        }
    }

    function calculateChange(int256 current, int256 previous) public pure returns (uint256) {
        if (previous == 0) {
            return current == 0 ? 0 : type(uint256).max;
        }

        int256 change = current - previous;
        uint256 absChange = change < 0 ? uint256(-change) : uint256(change);
        uint256 absPrevious = previous < 0 ? uint256(-previous) : uint256(previous);

        return (absChange * 10000) / absPrevious; // Basis points
    }
}
