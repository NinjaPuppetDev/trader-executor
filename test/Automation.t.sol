// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import {VeniceAutomation} from "../src/VeniceAutomation.sol";

contract VeniceAutomationTest is Test {
    VeniceAutomation public automation;
    address public owner = address(0x123);
    address public nonOwner = address(0x456);
    uint256 public constant INITIAL_INTERVAL = 900; // 15 minutes

    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event DecisionReceived(string result);
    event PromptAdded(uint256 indexed id, string prompt);

    function setUp() public {
        vm.startPrank(owner);
        automation = new VeniceAutomation(INITIAL_INTERVAL);
        vm.stopPrank();
    }

    // Test initialization
    // Updated test cases
    function test_PerformUpkeep() public {
        uint256 initialTime = block.timestamp;

        // Advance time past interval
        vm.warp(initialTime + INITIAL_INTERVAL + 1);

        // Calculate expected prompt ID
        uint256 expectedId = ((initialTime + INITIAL_INTERVAL + 1) / INITIAL_INTERVAL) % automation.promptCount();
        string memory expectedPrompt = automation.prompts(expectedId);

        // Validate event emission with proper parameters
        vm.expectEmit(true, true, true, true);
        emit RequestAnalysis(block.timestamp, expectedPrompt);

        automation.performUpkeep("");

        assertEq(automation.lastTimeStamp(), block.timestamp, "Timestamp should update");
        assertEq(automation.currentPrompt(), expectedPrompt, "Current prompt should match");
    }

    function test_PromptRotation() public {
        // Add more prompts for better rotation test
        vm.prank(owner);
        automation.addPrompt("Fourth prompt");
        vm.prank(owner);
        automation.addPrompt("Fifth prompt");

        uint256 count = automation.promptCount();
        string memory lastPrompt = automation.currentPrompt();
        uint256 sameCount = 0;

        // Test 10 rotations
        for (uint256 i = 0; i < 10; i++) {
            uint256 currentTime = block.timestamp;
            uint256 newTime = currentTime + INITIAL_INTERVAL + 1;
            vm.warp(newTime);

            automation.performUpkeep("");

            uint256 expectedId = (newTime / INITIAL_INTERVAL) % count;
            string memory expectedPrompt = automation.prompts(expectedId);

            assertEq(automation.currentPrompt(), expectedPrompt, "Prompt should rotate correctly");

            // Check for consecutive same prompts (should be rare with this setup)
            if (keccak256(bytes(automation.currentPrompt())) == keccak256(bytes(lastPrompt))) {
                sameCount++;
            }
            lastPrompt = automation.currentPrompt();
        }

        assertLt(sameCount, 3, "Should not get same prompt too frequently");
    }
}
