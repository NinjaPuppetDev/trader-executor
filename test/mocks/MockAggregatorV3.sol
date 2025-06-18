// SPDX-License-Identifier: MIT

pragma solidity 0.8.28;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract MockAggregatorV3 is AggregatorV3Interface {
    struct RoundData {
        int256 answer;
        uint256 timestamp;
    }

    mapping(uint80 => RoundData) public rounds;
    uint80 public currentRoundId;
    int256 public currentPrice;
    uint8 private _decimals = 8;

    constructor(int256 _initialPrice) {
        currentPrice = _initialPrice;
        currentRoundId = 1;
        rounds[currentRoundId] = RoundData(_initialPrice, block.timestamp);
    }

    function setPrice(int256 _newPrice) external {
        currentPrice = _newPrice;
        currentRoundId++;
        rounds[currentRoundId] = RoundData(_newPrice, block.timestamp);
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        roundId = currentRoundId;
        answer = currentPrice;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = currentRoundId;
    }

    // Add this to prevent underflow in getRoundData
    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        require(_roundId > 0 && _roundId <= currentRoundId, "Invalid round"); // Changed to <=
        RoundData memory data = rounds[_roundId];
        return (_roundId, data.answer, data.timestamp, data.timestamp, _roundId);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "Mock Feed";
    }

    function version() external pure returns (uint256) {
        return 1;
    }
}
