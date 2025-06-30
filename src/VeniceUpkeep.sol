// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AutomationCompatible} from "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

contract VeniceUpkeep is AutomationCompatible {
    error VeniceUpkeep__UpkeepNotNeeded();
    // State variables

    uint256 public lastTimestamp;
    uint256 public immutable interval;
    string public prompt; // Store prompt configuration

    // Events
    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event DecisionReceived(string decision);

    constructor(uint256 updateInterval, string memory _prompt) {
        interval = updateInterval;
        lastTimestamp = block.timestamp;
        prompt = _prompt;
    }

    function checkUpkeep(bytes calldata /* checkData */ )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        upkeepNeeded = (block.timestamp - lastTimestamp) >= interval;
        performData = "";
    }

    function performUpkeep(bytes calldata /* performData */ ) external override {
        if ((block.timestamp - lastTimestamp) < interval) {
            revert VeniceUpkeep__UpkeepNotNeeded();
        } else {
            lastTimestamp = block.timestamp;
        }
        // Emit event with current prompt configuration
        emit RequestAnalysis(lastTimestamp, prompt);
    }

    // New function for listener to submit decisions
    function receiveDecision(string calldata decision) external {
        emit DecisionReceived(decision);
    }
}
