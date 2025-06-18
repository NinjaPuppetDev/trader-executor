// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";

contract DeployPriceTrigger is Script {
    // Configuration parameters
    int256 public constant INITIAL_PRICE = 50000 * 10 ** 8; // $50,000 with 8 decimals
    uint256 public constant SPIKE_THRESHOLD = 500; // 5% in basis points
    uint256 public constant COOLDOWN_PERIOD = 60; // 1 minute

    function run() external {
        vm.startBroadcast();

        // 1. Deploy mock price feed
        MockAggregatorV3 mockFeed = new MockAggregatorV3(INITIAL_PRICE);
        console.log("MockAggregatorV3 deployed at:", address(mockFeed));

        // 2. Deploy PriceTrigger
        PriceTrigger priceTrigger = new PriceTrigger(address(mockFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD);
        console.log("PriceTrigger deployed at:", address(priceTrigger));

        vm.stopBroadcast();
    }
}
