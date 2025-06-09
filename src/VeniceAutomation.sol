// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {KeeperCompatibleInterface} from "@chainlink/interfaces/automation/KeeperCompatibleInterface.sol";

contract VeniceAutomation is KeeperCompatibleInterface {
    // State variables
    uint256 public lastTimeStamp;
    uint256 public interval;
    string public currentPrompt;
    address public owner;

    mapping(uint256 => string) public prompts;
    uint256 public promptCount;

    // Events
    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event DecisionReceived(string result);
    event PromptAdded(uint256 indexed id, string prompt);

    // Errors
    error OnlyOwner();
    error InvalidInterval();
    error EmptyPrompt();

    // Constructor
    // Constructor
    constructor(uint256 _interval) {
        if (_interval == 0) revert InvalidInterval();

        interval = _interval;
        lastTimeStamp = block.timestamp;
        owner = msg.sender;

        // Updated prompt
        _addPrompt(
            "Act as a crypto strategist. Analyze current market risk factors. "
            "Output ONLY in this JSON format: {\"decision\":\"buy|sell|hold|wait\"}. "
            "Do not include any other text, explanations, or formatting."
        );
    }

    // Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // Keeper-compatible
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory) {
        upkeepNeeded = (block.timestamp - lastTimeStamp) > interval;
    }

    function performUpkeep(bytes calldata) external override {
        // Always update timestamp first to prevent reentrancy
        uint256 currentTime = block.timestamp;
        lastTimeStamp = currentTime;

        // Select prompt safely
        uint256 promptId = promptCount > 0 ? (currentTime / interval) % promptCount : 0;

        currentPrompt = prompts[promptId];

        emit RequestAnalysis(currentTime, currentPrompt);
    }

    // External functions
    function addPrompt(string calldata newPrompt) external onlyOwner {
        _addPrompt(newPrompt);
    }

    function receiveDecision(string calldata decision) external {
        emit DecisionReceived(decision);
    }

    function updateInterval(uint256 newInterval) external onlyOwner {
        if (newInterval == 0) revert InvalidInterval();
        interval = newInterval;
    }

    // View helper
    function getPromptByIndex(uint256 index) external view returns (string memory) {
        return prompts[index];
    }

    // Internal helpers
    function _addPrompt(string memory newPrompt) internal {
        if (bytes(newPrompt).length == 0) revert EmptyPrompt();

        prompts[promptCount] = newPrompt;
        emit PromptAdded(promptCount, newPrompt);
        promptCount++;
    }
}
