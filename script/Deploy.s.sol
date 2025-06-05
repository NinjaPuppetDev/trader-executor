// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {VeniceAutomation} from "../src/VeniceAutomation.sol"; // Ensure this path is correct

contract DeployVeniceAutomation is Script {
    // Deployment parameters (15 minutes interval)
    uint256 public constant INITIAL_INTERVAL = 900; // 15 minutes

    // For detecting Anvil / Hardhat deployment and using appropriate RPC
    string private constant LOCAL_RPC_URL = "http://127.0.0.1:8545";

    function run() external {
        // Check if Anvil is running or fallback to local RPC URL
        string memory rpcUrl = getRpcUrl();

        // Configure the provider for Anvil (could be useful for testing with Anvil)
        console.log("Using RPC URL:", rpcUrl);

        // Wallet setup - will use the --account dev-wallet from command line
        vm.startBroadcast();

        // Deploy the VeniceAutomation contract to Anvil or local provider
        VeniceAutomation automation = new VeniceAutomation(INITIAL_INTERVAL);

        // End broadcasting transaction
        vm.stopBroadcast();

        // Log deployment information
        console.log("VeniceAutomation deployed at:", address(automation));
        console.log("Initial interval:", INITIAL_INTERVAL, "seconds (15 mins)");
        console.log("Deployer:", msg.sender);
    }

    // This function returns the RPC URL, fallback to local RPC if Anvil is not running
    function getRpcUrl() internal view returns (string memory) {
        // You can modify this logic to check for different environments (e.g., testnet, mainnet, etc.)
        string memory currentRpcUrl = LOCAL_RPC_URL;

        // Add logic here to detect environments like Hardhat, Anvil, or a custom RPC
        // Example: if (block.chainid == 1) { currentRpcUrl = "https://mainnet.infura.io/v3/YOUR_INFURA_KEY"; }

        return currentRpcUrl;
    }
}
