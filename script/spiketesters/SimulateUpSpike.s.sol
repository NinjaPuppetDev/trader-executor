// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PriceTrigger} from "../../src/PriceTrigger.sol";
import {MockAggregatorV3} from "../../test/mocks/MockAggregatorV3.sol";

contract SimulateUpSpike is Script {
    // Update with your contract addresses
    address constant PRICE_TRIGGER_ADDR = 0x610178dA211FEF7D417bC0e6FeD39F05609AD788;
    address constant VOLATILE_FEED_ADDR = 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9; // Add your feed address

    function run() external {
        vm.startBroadcast();

        // Get contracts
        PriceTrigger priceTrigger = PriceTrigger(PRICE_TRIGGER_ADDR);
        MockAggregatorV3 volatileFeed = MockAggregatorV3(VOLATILE_FEED_ADDR);

        // Get current price
        (, int256 currentPrice,,,) = volatileFeed.latestRoundData();
        console.log("Current price: ", currentPrice);

        // Calculate +6% price increase
        int256 newPrice = currentPrice * 10600 / 10000;
        console.log("New price (+6%%): ", newPrice);

        // Update price feed
        volatileFeed.updateAnswer(newPrice);
        console.log("Price feed updated");

        // Check upkeep status
        (bool upkeepNeeded,) = priceTrigger.checkUpkeep("");
        console.log("Upkeep needed: ", upkeepNeeded);

        if (upkeepNeeded) {
            console.log("Triggering upkeep...");
            priceTrigger.performUpkeep("");
        }

        vm.stopBroadcast();
    }
}
