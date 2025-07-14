// test/PriceTriggerTest.t.sol
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";
import {MockAggregatorV3} from "./mocks/MockAggregatorV3.sol";

contract PriceTriggerTest is Test {
    PriceTrigger trigger;
    MockAggregatorV3 feed;

    uint256 constant INITIAL_PRICE = 3000e8; // $3000
    uint256 constant SPIKE_THRESHOLD = 500; // 5%
    uint256 constant COOLDOWN = 60; // 60 seconds
    uint256 constant MAX_DATA_AGE = 3600;
    uint256 constant PAIR_ID = 1;

    event PriceSpikeDetected(int256 currentPrice, int256 previousPrice, uint256 changePercent);
    event TradingDecisionGenerated(string decision);

    function setUp() public {
        // Deploy mock feed
        feed = new MockAggregatorV3(int256(INITIAL_PRICE));

        // Deploy trigger
        trigger = new PriceTrigger(address(feed), SPIKE_THRESHOLD, COOLDOWN, MAX_DATA_AGE, PAIR_ID);
    }

    function testAutomationFlow() public {
        // Store initial price from contract's state (not feed)
        int256 initialPrice = trigger.lastPrice();

        // Simulate price spike (6% increase)
        int256 newPrice = initialPrice * 10600 / 10000; // 6% in basis points
        feed.updateAnswer(newPrice);

        // Check upkeep conditions
        (bool upkeepNeeded,) = trigger.checkUpkeep("");
        assertTrue(upkeepNeeded, "Upkeep should be needed");

        // Perform upkeep - expect PriceSpikeDetected event
        vm.expectEmit(true, true, true, true, address(trigger));
        // Change calculation now uses basis points (600 = 6%)
        emit PriceSpikeDetected(newPrice, initialPrice, 600);

        trigger.performUpkeep("");

        // Verify state updates
        assertEq(trigger.lastPrice(), newPrice, "Price not updated");
        assertEq(trigger.lastTriggerTime(), block.timestamp, "Timestamp not updated");
    }
}
