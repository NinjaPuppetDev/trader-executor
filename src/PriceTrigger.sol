// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {AutomationCompatibleInterface} from
    "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";

contract PriceTrigger is AutomationCompatibleInterface {
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable i_spikeThreshold;
    uint256 public immutable i_cooldownPeriod;
    uint256 public immutable i_maxDataAge;
    uint256 public immutable i_pairId;

    uint256 public lastTriggerTime;
    int256 public lastPrice;

    event PriceSpikeDetected(int256 currentPrice, int256 previousPrice, uint256 changePercent);

    constructor(
        address _priceFeed,
        uint256 _spikeThreshold,
        uint256 _cooldownPeriod,
        uint256 _maxDataAge,
        uint256 _pairId
    ) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        i_spikeThreshold = _spikeThreshold;
        i_cooldownPeriod = _cooldownPeriod;
        i_maxDataAge = _maxDataAge;
        i_pairId = _pairId;

        // Initialize with freshness checks
        (uint80 roundId, int256 initialPrice,, uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();

        require(answeredInRound >= roundId, "Stale price data");
        require(block.timestamp - updatedAt <= i_maxDataAge, "Data too old");

        lastPrice = initialPrice;
    }

    function checkUpkeep(bytes calldata /*checkData*/ )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory /*performData*/ )
    {
        // 1. Check cooldown period
        bool cooldownPassed = (block.timestamp - lastTriggerTime) >= i_cooldownPeriod;

        // Short-circuit if cooldown not met
        if (!cooldownPassed) {
            return (false, "");
        }

        // 2. Get current price with freshness checks
        (uint80 roundId, int256 currentPrice,, uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();

        // 3. Verify price data freshness
        if (answeredInRound < roundId || block.timestamp - updatedAt > i_maxDataAge) {
            return (false, "");
        }

        // 4. Calculate price change
        uint256 changePercent = calculateChange(currentPrice, lastPrice);

        // 5. Determine if upkeep needed
        upkeepNeeded = (changePercent >= i_spikeThreshold);
        return (upkeepNeeded, "");
    }

    function performUpkeep(bytes calldata /*performData*/ ) external override {
        // 1. Verify cooldown period
        require((block.timestamp - lastTriggerTime) >= i_cooldownPeriod, "Cooldown active");

        // 2. Get and verify current price
        (uint80 roundId, int256 currentPrice,, uint256 updatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();

        require(answeredInRound >= roundId, "Stale price data");
        require(block.timestamp - updatedAt <= i_maxDataAge, "Data too old");

        // 3. Update trigger time
        lastTriggerTime = block.timestamp;

        // 4. Calculate change and trigger event
        int256 previousPrice = lastPrice;
        uint256 changePercent = calculateChange(currentPrice, previousPrice);

        if (changePercent >= i_spikeThreshold) {
            lastPrice = currentPrice;
            emit PriceSpikeDetected(currentPrice, previousPrice, changePercent);
        }
    }

    function calculateChange(int256 current, int256 previous) public pure returns (uint256) {
        if (previous == 0) return type(uint256).max;

        int256 change = current - previous;
        uint256 absChange = change < 0 ? uint256(-change) : uint256(change);
        uint256 absPrevious = previous < 0 ? uint256(-previous) : uint256(previous);

        return (absChange * 10000) / absPrevious; // Basis points
    }

    function getPairId() public view returns (uint256) {
        return i_pairId;
    }
}
