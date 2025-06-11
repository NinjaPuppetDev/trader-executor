// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script} from "forge-std/Script.sol";
import {CCIPLocalSimulator} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import {MagicTraderSender} from "../src/MagicTraderSender.sol";
import {MagicTraderReceiver} from "../src/MagicTraderReceiver.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {LinkToken} from "@chainlink/local/src/shared/LinkToken.sol";

contract DeployContracts is Script {
    struct Deployment {
        address sender;
        address receiver;
        address router;
        address assetToken;
        address linkToken;
        uint64 destChain;
    }

    function run() external returns (Deployment memory) {
        vm.startBroadcast();

        Deployment memory deployment;

        // Deploy CCIP Local Simulator
        CCIPLocalSimulator simulator = new CCIPLocalSimulator();
        (uint64 chainSelector, IRouterClient routerClient,,, LinkToken linkTokenContract,,) = simulator.configuration();

        // Convert contracts to addresses
        deployment.router = address(routerClient);
        deployment.linkToken = address(linkTokenContract);
        deployment.destChain = chainSelector;

        // Deploy asset token
        MockERC20 assetToken = new MockERC20("Test Asset", "ASSET");
        deployment.assetToken = address(assetToken);

        // Register token with simulator
        simulator.supportNewTokenViaOwner(deployment.assetToken);

        // Deploy receiver
        MagicTraderReceiver receiver = new MagicTraderReceiver(deployment.router, deployment.assetToken);
        deployment.receiver = address(receiver);

        // Deploy sender
        MagicTraderSender sender = new MagicTraderSender(
            deployment.router, deployment.assetToken, deployment.linkToken, deployment.destChain, deployment.receiver
        );
        deployment.sender = address(sender);

        vm.stopBroadcast();
        return deployment;
    }
}
