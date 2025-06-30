// test/mocks/MockAggregatorV3.sol
pragma solidity 0.8.30;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract MockAggregatorV3 is AggregatorV3Interface {
    uint8 public constant override decimals = 8;
    string public constant override description = "Mock Feed";
    uint256 public constant override version = 4;

    int256 public currentPrice;
    uint256 public lastUpdate;
    uint80 public currentRoundId;

    constructor(int256 _initialPrice) {
        currentPrice = _initialPrice;
        lastUpdate = block.timestamp;
        currentRoundId = 1;
    }

    function updateAnswer(int256 _newPrice) external {
        currentPrice = _newPrice;
        lastUpdate = block.timestamp;
        currentRoundId++;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (currentRoundId, currentPrice, lastUpdate - 60, lastUpdate, currentRoundId);
    }

    function getRoundData(uint80 _roundId)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        // For simplicity, return same as latest for all rounds
        return (_roundId, currentPrice, lastUpdate - 60, lastUpdate, _roundId);
    }
}
