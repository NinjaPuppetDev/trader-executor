// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {MagicTraderSender} from "../src/MagicTraderSender.sol";
import {MagicTraderReceiver} from "../src/MagicTraderReceiver.sol";

contract DeployCCIP is Script {
    struct Deployment {
        address sender;
        address receiver;
    }

    function run() external returns (Deployment memory) {
        // Load environment variables
        address router = vm.envAddress("CCIP_ROUTER");
        address assetToken = vm.envAddress("ASSET_TOKEN");
        address linkToken = vm.envAddress("LINK_TOKEN");
        uint64 destChain = uint64(vm.envUint("DEST_CHAIN_SELECTOR"));
        bool isReceiver = vm.envBool("IS_RECEIVER");
        address receiverAddress = vm.envAddress("RECEIVER_ADDRESS");

        vm.startBroadcast();

        Deployment memory deployment;

        if (isReceiver) {
            // Deploy receiver only on destination chain (Base Sepolia)
            MagicTraderReceiver receiver = new MagicTraderReceiver(router, assetToken);
            deployment.receiver = address(receiver);
        } else {
            // Deploy sender on source chain (Sepolia ETH)
            require(receiverAddress != address(0), "Receiver address required");
            MagicTraderSender sender = new MagicTraderSender(router, assetToken, linkToken, destChain, receiverAddress);
            deployment.sender = address(sender);
        }

        vm.stopBroadcast();
        return deployment;
    }
}
