// script/SimulatePriceMovement.s.sol
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

contract SimulatePriceMovement is Script {
    address public priceTriggerAddr = 0xa513E6E4b8f2a923D98304ec87F64353C4D5C853;
    address public mockFeedAddr = 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9;
    uint256 public constant COOLDOWN_PERIOD = 1; // Hardcoded to 1 minute

    // Add direction parameter to the run function
    function run(bool isUpwardSpike) external {
        vm.startBroadcast();

        PriceTrigger priceTrigger = PriceTrigger(priceTriggerAddr);
        MockAggregatorV3 mockFeed = MockAggregatorV3(mockFeedAddr);

        // Get current price
        (, int256 currentPrice,,,) = mockFeed.latestRoundData();
        console.log("Current price: $", uint256(currentPrice) / 10 ** 8);

        // Calculate price change - 5% in specified direction
        int256 newPrice;
        if (isUpwardSpike) {
            newPrice = currentPrice + (currentPrice * 5) / 100;
            console.log("Simulating 5% price increase");
        } else {
            newPrice = currentPrice - (currentPrice * 5) / 100;
            console.log("Simulating 5% price decrease");
        }
        console.log("New price: $", uint256(newPrice) / 10 ** 8);

        // Advance time past cooldown (1 minute + 1 second)
        vm.warp(block.timestamp + 61);
        console.log("Advanced time by 61 seconds");

        // Set new price
        mockFeed.setPrice(newPrice);

        // Trigger price check
        priceTrigger.checkPriceSpike();
        console.log("Price spike check triggered");

        vm.stopBroadcast();
    }
}

interface PriceTrigger {
    function checkPriceSpike() external;
    function cooldownPeriod() external view returns (uint256);
}

interface MockAggregatorV3 {
    function setPrice(int256 _newPrice) external;
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
