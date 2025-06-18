// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

contract SimulatePriceSpike is Script {
    // CORRECTED ADDRESSES
    address public priceTriggerAddr = 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0; // PriceTrigger
    address public mockFeedAddr = 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512; // MockFeed

    function run() external {
        vm.startBroadcast();

        // Get contracts
        PriceTrigger priceTrigger = PriceTrigger(priceTriggerAddr);
        MockAggregatorV3 mockFeed = MockAggregatorV3(mockFeedAddr);

        // Set new price (5% increase)
        int256 newPrice = 52500 * 10 ** 8; // 52,500 USD
        mockFeed.setPrice(newPrice);
        console.log("Price updated to: $", uint256(newPrice) / 10 ** 8);

        // Trigger price check
        priceTrigger.checkPriceSpike();
        console.log("Price spike check triggered");

        vm.stopBroadcast();
    }
}

interface PriceTrigger {
    function checkPriceSpike() external;
}

interface MockAggregatorV3 {
    function setPrice(int256 _newPrice) external;
}
