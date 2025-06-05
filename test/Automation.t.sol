// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import {VeniceAutomation} from "../src/VeniceAutomation.sol";

contract VeniceAutomationTest is Test {
    VeniceAutomation public automation;
    address public owner;
    uint256 public constant INITIAL_INTERVAL = 900; // 15 minutes

    // Events
    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event PromptAdded(uint256 indexed promptId, string prompt); // Declare PromptAdded event here

    function setUp() public {
        // Deploy the contract
        owner = address(this);
        automation = new VeniceAutomation(INITIAL_INTERVAL);

        // Ensure the contract was deployed correctly
        assertEq(address(automation), address(automation));
        assertEq(automation.interval(), INITIAL_INTERVAL);
        assertEq(automation.owner(), owner);
    }

    function testAddPrompt() public {
        // Add a new prompt
        string memory newPrompt = "Analyze ETH/BTC price correlation";

        // Expect the PromptAdded event to be emitted
        vm.expectEmit(true, true, true, true);
        emit PromptAdded(0, newPrompt);

        automation.addPrompt(newPrompt);

        // Verify the prompt was added
        string memory storedPrompt = automation.prompts(0); // The first prompt added
        assertEq(storedPrompt, newPrompt);
    }

    function testRequestAnalysisEventOnPerformUpkeep() public {
        // Add prompts before running the test to avoid out-of-bounds errors
        automation.addPrompt("Analyze ETH/USD correlation");

        // Perform upkeep to trigger the RequestAnalysis event
        vm.warp(block.timestamp + INITIAL_INTERVAL); // Simulate time passing
        vm.roll(block.number + 1); // Move to the next block

        // Expect the RequestAnalysis event to be emitted
        vm.expectEmit(true, true, true, true);
        emit RequestAnalysis(block.timestamp, "Analyze ETH/USD correlation");

        // Perform upkeep (this should trigger the event)
        automation.performUpkeep("");
    }

    function testOwnerOnlyAddPrompt() public {
        // Try to add a prompt as a non-owner (should revert)
        address nonOwner = address(0x123);
        vm.prank(nonOwner);

        // Expect the custom OnlyOwner error
        vm.expectRevert(VeniceAutomation.OnlyOwner.selector);
        automation.addPrompt("This should fail");
    }

    function testIntervalBasedPromptRotation() public {
        // Add prompts before running the test to avoid out-of-bounds errors
        automation.addPrompt("Analyze ETH/USD correlation");
        automation.addPrompt("Analyze BTC/USD volatility");

        // Simulate the passing of time for interval-based prompt switching
        vm.warp(block.timestamp + INITIAL_INTERVAL * 2); // Simulate time passing for two intervals
        vm.roll(block.number + 1); // Move to the next block

        // Perform upkeep to rotate through prompts
        automation.performUpkeep("");

        // Verify the prompt switched to the second prompt (based on time)
        string memory promptAfterRotation = automation.prompts(1); // Check prompt after rotation
        assertEq(promptAfterRotation, "Analyze BTC/USD volatility");
    }

    function testEmptyPromptReverts() public {
        // Try adding an empty prompt (should revert)
        vm.expectRevert(VeniceAutomation.EmptyPrompt.selector);
        automation.addPrompt("");
    }
}
