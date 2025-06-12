// script/DeploySepolia.s.sol
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {MagicTraderSender} from "../src/MagicTraderSender.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";

contract DeploySepolia is Script {
    function run() external {
        vm.startBroadcast();

        address baseReceiver = 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0;

        // Ethereum Sepolia addresses
        address router = 0xD0daae2231E9CB96b94C8512223533293C3693Bf;
        address linkToken = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
        uint64 destChain = 10344971235874465080; // Base Sepolia selector

        // Deploy sender
        MagicTraderSender sender = new MagicTraderSender(router, linkToken, destChain, baseReceiver);

        // Fund sender with LINK
        uint256 linkAmount = 100 * 10 ** 18;
        LinkTokenInterface(linkToken).transfer(address(sender), linkAmount);

        vm.stopBroadcast();

        console.log("Sender: %s", address(sender));
    }
}
