// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {MockAggregatorV3} from "./mocks/MockAggregatorV3.sol";

contract PriceTriggerTest is Test {
    PriceTrigger public trigger;
    MockAggregatorV3 public mockFeed;

    int256 public constant INITIAL_PRICE = 50000 * 10 ** 8; // $50,000
    uint256 public constant SPIKE_THRESHOLD = 500; // 5% in basis points
    uint256 public constant COOLDOWN_PERIOD = 1; // 1 hour

    event PriceSpikeDetected(int256 currentPrice, int256 previousPrice, uint256 changePercent);

    function setUp() public {
        mockFeed = new MockAggregatorV3(INITIAL_PRICE);
        trigger = new PriceTrigger(address(mockFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD);
    }

    function test_InitialState() public view {
        assertEq(address(trigger.priceFeed()), address(mockFeed));
        assertEq(trigger.i_spikeThreshold(), SPIKE_THRESHOLD);
        assertEq(trigger.i_cooldownPeriod(), COOLDOWN_PERIOD);
    }

    function test_PriceSpikeDetection() public {
        // 6% price increase
        int256 newPrice = 53000 * 10 ** 8;
        mockFeed.setPrice(newPrice);

        vm.expectEmit(true, true, true, true, address(trigger));
        emit PriceSpikeDetected(newPrice, INITIAL_PRICE, 600); // 600 basis points = 6%

        trigger.checkPriceSpike();
    }

    function test_PriceDropDetection() public {
        // 7% price drop
        int256 newPrice = 46500 * 10 ** 8;
        mockFeed.setPrice(newPrice);

        vm.expectEmit(true, true, true, true, address(trigger));
        emit PriceSpikeDetected(newPrice, INITIAL_PRICE, 700); // 700 basis points = 7%

        trigger.checkPriceSpike();
    }

    function test_BelowThresholdNoTrigger() public {
        // 4.9% price increase (below 5% threshold)
        int256 newPrice = 52450 * 10 ** 8;
        mockFeed.setPrice(newPrice);

        // Record logs before the call
        vm.recordLogs();

        trigger.checkPriceSpike();

        // Get recorded logs
        Vm.Log[] memory entries = vm.getRecordedLogs();

        // Verify no events were emitted
        assertEq(entries.length, 0, "Event emitted when none expected");
    }

    function test_CooldownEnforcement() public {
        // First trigger (6% increase)
        int256 newPrice1 = 53000 * 10 ** 8;
        mockFeed.setPrice(newPrice1);
        trigger.checkPriceSpike();
        uint256 firstTriggerTime = block.timestamp;

        // Try to trigger again immediately (should fail)
        int256 newPrice2 = 54000 * 10 ** 8;
        mockFeed.setPrice(newPrice2);
        vm.expectRevert("Cooldown active");
        trigger.checkPriceSpike();

        // Fast-forward half the cooldown period
        vm.warp(firstTriggerTime + COOLDOWN_PERIOD / 2);
        vm.expectRevert("Cooldown active");
        trigger.checkPriceSpike();

        // Fast-forward past cooldown
        vm.warp(firstTriggerTime + COOLDOWN_PERIOD + 1);
        mockFeed.setPrice(newPrice2);
        trigger.checkPriceSpike(); // Should work now
    }

    function test_EdgeCaseExactlyAtThreshold() public {
        // Exactly 5% increase
        int256 thresholdPrice = 52500 * 10 ** 8;
        mockFeed.setPrice(thresholdPrice);

        vm.expectEmit(true, true, true, true, address(trigger));
        emit PriceSpikeDetected(thresholdPrice, INITIAL_PRICE, SPIKE_THRESHOLD);

        trigger.checkPriceSpike();
    }

    function test_ZeroPreviousPrice() public {
        // Create new mock with 0 initial price
        MockAggregatorV3 zeroFeed = new MockAggregatorV3(0);
        PriceTrigger zeroTrigger = new PriceTrigger(address(zeroFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD);

        // Set new price
        int256 newPrice = 10000 * 10 ** 8;
        zeroFeed.setPrice(newPrice);

        vm.expectEmit(false, false, false, false);
        emit PriceSpikeDetected(0, 0, 0);

        zeroTrigger.checkPriceSpike();
    }

    function test_CalculateChange() public view {
        // Test calculation directly
        uint256 change;

        // 10% increase
        change = trigger.calculateChange(110e8, 100e8);
        assertEq(change, 1000); // 1000 basis points

        // 5% decrease
        change = trigger.calculateChange(95e8, 100e8);
        assertEq(change, 500); // 500 basis points

        // 100% increase
        change = trigger.calculateChange(200e8, 100e8);
        assertEq(change, 10000); // 10000 basis points

        // 50% decrease
        change = trigger.calculateChange(50e8, 100e8);
        assertEq(change, 5000); // 5000 basis points
    }

    function test_CalculateChangeEdgeCases() public view {
        // Negative to positive
        uint256 change = trigger.calculateChange(100e8, -100e8);
        assertEq(change, 20000); // 200% change

        // Both negative
        change = trigger.calculateChange(-50e8, -100e8);
        assertEq(change, 5000); // 50% change

        // Small numbers
        change = trigger.calculateChange(100, 50);
        assertEq(change, 10000); // 100% increase
    }

    function test_GasUsage() public {
        int256 newPrice = 53000 * 10 ** 8;
        mockFeed.setPrice(newPrice);

        uint256 gasBefore = gasleft();
        trigger.checkPriceSpike();
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Gas used for price spike detection:", gasUsed);
        assertLt(gasUsed, 60000); // Should be under 60k gas
    }

    function test_ConsecutiveTriggers() public {
        // First trigger
        mockFeed.setPrice(53000 * 10 ** 8);
        trigger.checkPriceSpike();
        uint256 time1 = block.timestamp;

        // Second trigger after cooldown
        vm.warp(time1 + COOLDOWN_PERIOD + 1);
        mockFeed.setPrice(54000 * 10 ** 8);
        trigger.checkPriceSpike();
        uint256 time2 = block.timestamp;

        // Third trigger
        vm.warp(time2 + COOLDOWN_PERIOD + 1);
        mockFeed.setPrice(55000 * 10 ** 8);
        trigger.checkPriceSpike();

        // Verify last trigger time
        
        assertEq(trigger.lastTriggerTime(address(this)), block.timestamp);
    }

    function test_RevertOnSameCallerCooldown() public {
        // First trigger
        mockFeed.setPrice(53000 * 10 ** 8);
        trigger.checkPriceSpike();

        // Same caller immediately
        mockFeed.setPrice(54000 * 10 ** 8);
        vm.expectRevert("Cooldown active");
        trigger.checkPriceSpike();

        // Different caller should work
        vm.prank(address(0x123));
        trigger.checkPriceSpike();
    }
}
