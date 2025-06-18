// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract PriceTrigger {
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable i_spikeThreshold; // Basis points (500 = 5%)
    uint256 public immutable i_cooldownPeriod; // Prevent rapid triggers

    // Track last trigger time
    mapping(address => uint256) public lastTriggerTime;

    event PriceSpikeDetected(int256 currentPrice, int256 previousPrice, uint256 changePercent);

    constructor(address _priceFeed, uint256 _spikeThreshold, uint256 _cooldownPeriod) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        i_spikeThreshold = _spikeThreshold;
        i_cooldownPeriod = _cooldownPeriod;
    }

    function checkPriceSpike() external {
        // Prevent rapid triggering
        require(block.timestamp > lastTriggerTime[msg.sender] + i_cooldownPeriod, "Cooldown active");
        lastTriggerTime[msg.sender] = block.timestamp;

        // Get current and previous prices
        (uint80 roundId, int256 currentPrice,,,) = priceFeed.latestRoundData();
        (, int256 previousPrice,,,) = priceFeed.getRoundData(roundId - 1);

        // Calculate percentage change in basis points
        uint256 changePercent = calculateChange(currentPrice, previousPrice);

        if (changePercent >= i_spikeThreshold) {
            emit PriceSpikeDetected(currentPrice, previousPrice, changePercent);
        }
    }

    function calculateChange(int256 current, int256 previous) public pure returns (uint256) {
        // Handle zero previous price (infinite change)
        if (previous == 0) {
            return current == 0 ? 0 : type(uint256).max;
        }

        uint256 absChange;
        if (current > previous) {
            absChange = uint256(current - previous);
        } else {
            absChange = uint256(previous - current);
        }

        // Use absolute value for base calculation
        uint256 absPrevious = previous < 0 
            ? uint256(-previous) 
            : uint256(previous);

        return (absChange * 10000) / absPrevious; // Basis points
    }
}