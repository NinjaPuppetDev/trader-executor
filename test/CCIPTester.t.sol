// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {MagicTraderSender} from "../src/MagicTraderSender.sol";
import {MagicTraderReceiver} from "../src/MagicTraderReceiver.sol";
import {CCIPLocalSimulator} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {LinkToken} from "@chainlink/local/src/shared/LinkToken.sol";

contract MagicTraderTest is Test {
    MagicTraderSender sender;
    MagicTraderReceiver receiver;
    IRouterClient router;
    MockERC20 assetToken;
    LinkToken linkToken; // Changed type to LinkToken

    address owner;
    uint256 tradingAmount;
    uint64 destChain; // Will get from simulator

    function setUp() public {
        owner = address(1);

        // Use Chainlink Local Simulator
        CCIPLocalSimulator simulator = new CCIPLocalSimulator();
        (uint64 chainSelector, IRouterClient routerAddress,,, LinkToken linkTokenAddress,,) = simulator.configuration();

        router = routerAddress;
        linkToken = linkTokenAddress;
        destChain = chainSelector;

        // Deploy token
        assetToken = new MockERC20("Test Asset", "ASSET");

        // Transfer token ownership to our test owner
        assetToken.transferOwnership(owner);

        // Register token with simulator
        vm.prank(owner);
        simulator.supportNewTokenViaOwner(address(assetToken));

        // Deploy contracts
        vm.startPrank(owner);
        receiver = new MagicTraderReceiver(address(router), address(assetToken));
        sender = new MagicTraderSender(
            address(router), address(assetToken), address(linkToken), destChain, address(receiver)
        );
        vm.stopPrank();

        // Get trading amount
        tradingAmount = sender.TRADING_AMOUNT();

        // Fund accounts
        vm.startPrank(owner);
        assetToken.mint(owner, 1000 ether);

        // Use simulator's faucet for LINK tokens
        simulator.requestLinkFromFaucet(address(sender), 10 ether);
        vm.stopPrank();
    }

    function testExecuteTrade() public {
        vm.startPrank(owner);
        assetToken.approve(address(sender), tradingAmount);
        uint256 initialOwnerBalance = assetToken.balanceOf(owner);
        vm.stopPrank();

        // Execute trade as owner
        vm.prank(owner);
        MagicTraderSender.Action action = MagicTraderSender.Action.Buy;
        sender.executeTrade(action); // This already triggers the CCIP transfer

        // The router has already delivered the message during ccipSend
        // So we DON'T need to simulate it again

        // Check final balance
        assertEq(assetToken.balanceOf(owner), initialOwnerBalance, "Owner should have tokens returned");
    }
}
