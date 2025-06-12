// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
    LinkToken linkToken;

    address owner;
    uint256 constant TRADING_AMOUNT = 100 ether;
    uint64 destChain;

    function setUp() public {
        owner = address(1);
        vm.deal(owner, 10 ether);
        vm.startPrank(owner);

        // Use Chainlink Local Simulator
        CCIPLocalSimulator simulator = new CCIPLocalSimulator();
        (destChain, router,,, linkToken,,) = simulator.configuration();

        // Deploy token
        assetToken = new MockERC20("Test Asset", "ASSET");

        // Deploy contracts
        receiver = new MagicTraderReceiver(address(router), address(assetToken));
        sender = new MagicTraderSender(address(router), address(linkToken), destChain, address(receiver));

        // Fund accounts
        // 1. Fund receiver with tokens
        assetToken.mint(address(receiver), 1000 ether);

        // 2. Fund sender with LINK
        simulator.requestLinkFromFaucet(address(sender), 10 ether);

        vm.stopPrank();
    }

    function testExecuteTrade() public {
        // Set initial balances
        uint256 initialReceiverBalance = assetToken.balanceOf(address(receiver));
        uint256 initialOwnerBalance = assetToken.balanceOf(owner);

        // Execute trade as owner
        vm.prank(owner);
        MagicTraderSender.Action action = MagicTraderSender.Action.Buy;
        sender.executeTrade(action);

        // Validate token transfer
        assertEq(assetToken.balanceOf(owner), initialOwnerBalance + TRADING_AMOUNT, "Owner should receive tokens");

        assertEq(
            assetToken.balanceOf(address(receiver)),
            initialReceiverBalance - TRADING_AMOUNT,
            "Receiver should send tokens"
        );
    }

    function testInvalidActionReverts() public {
        vm.prank(owner);
        vm.expectRevert("Invalid action");
        sender.executeTrade(MagicTraderSender.Action.Hold);
    }

    function testInsufficientLinkReverts() public {
        // Create a mock fee scenario for this specific test
        uint256 mockFee = 1 ether;

        // Mock the router's getFee function to return a non-zero fee
        vm.mockCall(address(router), abi.encodeWithSelector(IRouterClient.getFee.selector), abi.encode(mockFee));

        // Withdraw all LINK from sender
        vm.prank(owner);
        sender.withdrawLink(10 ether);

        // Verify sender has 0 LINK
        assertEq(linkToken.balanceOf(address(sender)), 0, "Sender should have 0 LINK");

        // Execute trade should revert
        vm.prank(owner);
        vm.expectRevert("Insufficient LINK");
        sender.executeTrade(MagicTraderSender.Action.Buy);
    }

    function testOnlyOwnerCanExecute() public {
        vm.prank(address(0x123)); // Non-owner
        vm.expectRevert();
        sender.executeTrade(MagicTraderSender.Action.Buy);
    }
}
