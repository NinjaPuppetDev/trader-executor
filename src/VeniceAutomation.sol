pragma solidity ^0.8.27;

import {KeeperCompatibleInterface} from "@chainlink/interfaces/automation/KeeperCompatibleInterface.sol";

contract VeniceAutomation is KeeperCompatibleInterface {
    // State variables
    uint256 public lastTimeStamp;
    uint256 public interval;
    string public currentPrompt;
    address public owner;

    // Configuration
    mapping(uint256 => string) public prompts;
    uint256 public promptCount;

    // Events
    event RequestAnalysis(uint256 indexed timestamp, string prompt);
    event DecisionReceived(string result);
    event PromptAdded(uint256 id, string prompt);

    // Errors
    error OnlyOwner();
    error InvalidInterval();
    error EmptyPrompt();

    constructor(uint256 _interval) {
        if (_interval == 0) revert InvalidInterval();
        interval = _interval;
        lastTimeStamp = block.timestamp;
        owner = msg.sender;

        // Initialize with default prompts
        _addPrompt("Analyze current ETH/USD market conditions");
        _addPrompt("Generate trading signals for BTC/USD");
        _addPrompt("Assess risk factors for crypto market today");
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // Keeper functions
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory) {
        upkeepNeeded = (block.timestamp - lastTimeStamp) > interval;
    }

    function performUpkeep(bytes calldata) external override {
        if ((block.timestamp - lastTimeStamp) > interval) {
            lastTimeStamp = block.timestamp;

            // Rotate through prompts or use a random one
            uint256 promptId = (block.timestamp / interval) % promptCount;
            currentPrompt = prompts[promptId];

            emit RequestAnalysis(block.timestamp, currentPrompt);
        }
    }

    // Decision submission
    function receiveDecision(string calldata decision) external {
        emit DecisionReceived(decision);
    }

    // Prompt management
    function addPrompt(string calldata newPrompt) external onlyOwner {
        _addPrompt(newPrompt);
    }

    function _addPrompt(string memory newPrompt) internal {
        if (bytes(newPrompt).length == 0) revert EmptyPrompt();
        prompts[promptCount] = newPrompt;
        emit PromptAdded(promptCount, newPrompt);
        promptCount++;
    }

    // Maintenance
    function updateInterval(uint256 newInterval) external onlyOwner {
        if (newInterval == 0) revert InvalidInterval();
        interval = newInterval;
    }

    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}
