// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VeniceUpkeep} from "../src/VeniceUpkeep.sol";

contract DeployVeniceUpkeep is Script {
    // Deployment parameters
    uint256 public constant UPDATE_INTERVAL = 1; // 24 hours in seconds
    string public constant PROMPT =
        "{\"token_mapping\": {\"ETH\": \"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\", \"USDC\": \"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\"}}";

    // Chainlink registry addresses
    address public constant SEPOLIA_REGISTRY = 0xE16Df59B887e3Caa439E0b29B42bA2e7976FD8b2;
    address public constant MAINNET_REGISTRY = 0x02777053d6764996e594c3E88AF1D58D5363a2e6;

    function run() public returns (VeniceUpkeep) {
        // Get network-specific registry address
        address registry = getRegistryAddress();

        // Log configuration
        console.log("Network ID: ", block.chainid);
        console.log("Using registry: ", registry);

        // Start broadcasting
        vm.startBroadcast();

        // Deploy contract with registry
        VeniceUpkeep venice = new VeniceUpkeep(UPDATE_INTERVAL, PROMPT);

        vm.stopBroadcast();

        // Log deployment info
        console.log("VeniceUpkeep deployed at: ", address(venice));
        console.log("Update interval: ", UPDATE_INTERVAL);
        console.log("Initial prompt: ", PROMPT);
        console.log("Registry: ", registry);

        return venice;
    }

    function getRegistryAddress() internal view returns (address) {
        // Sepolia
        if (block.chainid == 11155111) return SEPOLIA_REGISTRY;
        // Mainnet
        if (block.chainid == 1) return MAINNET_REGISTRY;
        // Local (Anvil) - return zero address to allow manual calls
        if (block.chainid == 31337) return address(0);

        revert("Unsupported network");
    }
}
