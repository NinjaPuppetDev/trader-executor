// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {VeniceUpkeep} from "../src/VeniceUpkeep.sol";

contract VeniceUpkeepTest is Test {
    VeniceUpkeep public upkeep;
    uint256 public constant INTERVAL = 86400; // 1 day in seconds
    string public constant PROMPT = "Analyze market conditions";

    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event DecisionReceived(string decision);

    function setUp() public {
        upkeep = new VeniceUpkeep(INTERVAL, PROMPT);
    }

    // Test initial state after deployment
    function test_InitialState() public view {
        assertEq(upkeep.interval(), INTERVAL);
        assertEq(upkeep.lastTimestamp(), block.timestamp);
        assertEq(upkeep.prompt(), PROMPT);
    }

    // Test checkUpkeep when upkeep is not needed
    function test_CheckUpkeepNotNeeded() public view {
        (bool needed,) = upkeep.checkUpkeep("");
        assertFalse(needed);
    }

    // Test checkUpkeep when upkeep is needed
    function test_CheckUpkeepNeeded() public {
        vm.warp(block.timestamp + INTERVAL + 1); // Fast-forward past interval
        (bool needed,) = upkeep.checkUpkeep("");
        assertTrue(needed);
    }

    function test_PerformUpkeepTooEarly() public {
        uint256 initialTimestamp = upkeep.lastTimestamp();

        // Should revert with specific error
        vm.expectRevert(VeniceUpkeep.VeniceUpkeep__UpkeepNotNeeded.selector);
        upkeep.performUpkeep("");

        assertEq(upkeep.lastTimestamp(), initialTimestamp);
    }
    // Test successful performUpkeep execution

    function test_PerformUpkeep() public {
        vm.warp(block.timestamp + INTERVAL + 1);
        uint256 newTimestamp = block.timestamp;

        // Expect event emission
        vm.expectEmit(true, false, false, true);
        emit RequestAnalysis(newTimestamp, PROMPT);

        upkeep.performUpkeep("");

        assertEq(upkeep.lastTimestamp(), newTimestamp);
    }

    // Test receiveDecision functionality
    function test_ReceiveDecision() public {
        string memory decision = "Buy ETH";

        vm.expectEmit(false, false, false, true);
        emit DecisionReceived(decision);

        upkeep.receiveDecision(decision);
    }

    // Test multiple upkeep cycles
    function test_MultipleUpkeeps() public {
        // First upkeep
        uint256 time1 = block.timestamp + INTERVAL + 1;
        vm.warp(time1);
        upkeep.performUpkeep("");
        assertEq(upkeep.lastTimestamp(), time1);

        // Second upkeep
        uint256 time2 = time1 + INTERVAL + 1;
        vm.warp(time2);
        upkeep.performUpkeep("");
        assertEq(upkeep.lastTimestamp(), time2);
    }
}
