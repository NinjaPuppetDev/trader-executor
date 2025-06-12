// script/DeployBaseSepolia.s.sol
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {MagicTraderReceiver} from "../src/MagicTraderReceiver.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract DeployBaseSepolia is Script {
    function run() external {
        vm.startBroadcast();

        // Base Sepolia addresses
        address router = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;

        // Deploy token
        MockERC20 baseToken = new MockERC20("Base Asset", "BASE");
        uint256 initialSupply = 1000000 * 10 ** 18;
        baseToken.mint(msg.sender, initialSupply); // Mint to deployer

        // Deploy receiver
        MagicTraderReceiver receiver = new MagicTraderReceiver(router, address(baseToken));

        vm.stopBroadcast();

        console.log("Base Token: %s", address(baseToken));
        console.log("Receiver: %s", address(receiver));
    }
}
