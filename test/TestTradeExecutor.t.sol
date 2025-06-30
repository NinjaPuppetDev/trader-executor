// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {VRFCoordinatorV2Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

contract TestTradeExecutor is Test {
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;
    Exchange public exchange;
    TradeExecutor public tradeExecutor;
    VRFCoordinatorV2Mock public vrfCoordinator;

    address deployer = address(1);
    address trader = address(2);

    // Constants
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6;
    uint256 constant EXCESS_AMOUNT = 20_000 * 10 ** 6;
    bytes32 constant KEY_HASH = 0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        stableFeed = new MockAggregatorV3(1e8);
        volatileFeed = new MockAggregatorV3(3000e8);

        // Deploy Exchange
        exchange =
            new Exchange(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Deploy and configure VRF Coordinator
        vrfCoordinator = new VRFCoordinatorV2Mock(0, 0);
        uint64 subscriptionId = vrfCoordinator.createSubscription();
        vrfCoordinator.fundSubscription(subscriptionId, 100 ether);

        // Deploy TradeExecutor with VRF
        tradeExecutor = new TradeExecutor(
            address(stableToken),
            address(volatileToken),
            address(exchange),
            address(vrfCoordinator),
            subscriptionId,
            KEY_HASH
        );

        // Add TradeExecutor as authorized consumer
        vrfCoordinator.addConsumer(subscriptionId, address(tradeExecutor));

        // Fund TradeExecutor
        stableToken.mint(address(tradeExecutor), 10_000 * 10 ** 6);
        volatileToken.mint(address(tradeExecutor), 10 * 10 ** 18);

        // Add initial liquidity to exchange
        stableToken.mint(deployer, 100_000 * 10 ** 6);
        volatileToken.mint(deployer, 1_000 * 10 ** 18);
        stableToken.approve(address(exchange), 100_000 * 10 ** 6);
        volatileToken.approve(address(exchange), 1_000 * 10 ** 18);
        exchange.addLiquidity(100_000 * 10 ** 6, 1_000 * 10 ** 18);

        vm.stopPrank();
    }

    // Helper to calculate expected output
    function calculateExpectedOutput(bool buyVolatile, uint256 amountIn) public view returns (uint256) {
        uint256 stableReserve = exchange.stableReserve();
        uint256 volatileReserve = exchange.volatileReserve();

        if (buyVolatile) {
            return (amountIn * volatileReserve) / (stableReserve + amountIn);
        } else {
            return (amountIn * stableReserve) / (volatileReserve + amountIn);
        }
    }

    // Helper to calculate minAmountOut with slippage
    function calculateMinAmountOut(bool buyVolatile, uint256 amountIn, uint256 slippageBps)
        public
        view
        returns (uint256)
    {
        uint256 expectedOut = calculateExpectedOutput(buyVolatile, amountIn);
        return expectedOut * (10_000 - slippageBps) / 10_000;
    }

    // Test successful buy trade using VRF flow
    function testExecuteTradeBuy() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);

        // Use main execution function
        uint256 requestId = tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Simulate VRF response
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 5;
        vrfCoordinator.fulfillRandomWords(requestId, address(tradeExecutor));

        vm.stopPrank();

        // Balance assertions remain the same
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10 ** 6);
        uint256 actualOut = volatileToken.balanceOf(address(tradeExecutor)) - 10 * 10 ** 18;
        assertGe(actualOut, minAmountOut, "Output less than minimum");
    }

    // Test VRF trade execution flow
    function testVRFTradeExecution() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);
        uint256 requestId = tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Simulate VRF response
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 5;
        vrfCoordinator.fulfillRandomWords(requestId, address(tradeExecutor));

        vm.stopPrank();

        // Check balances after trade
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10 ** 6);
        uint256 actualOut = volatileToken.balanceOf(address(tradeExecutor)) - 10 * 10 ** 18;
        assertGe(actualOut, minAmountOut, "Output less than minimum");
    }

    // Test token withdrawal functionality
    function testWithdrawTokens() public {
        vm.startPrank(deployer);
        uint256 initialBalance = stableToken.balanceOf(deployer);
        uint256 withdrawAmount = 5_000 * 10 ** 6;

        tradeExecutor.withdrawTokens(address(stableToken), withdrawAmount);
        vm.stopPrank();

        assertEq(stableToken.balanceOf(deployer), initialBalance + withdrawAmount);
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 5_000 * 10 ** 6);
    }

    // Test VRF request storage and cleanup
    function testPendingTradeCleanup() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);
        uint256 requestId = tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Verify pending trade exists
        (bool buyVolatile, uint256 amountIn, uint256 minOut,) = tradeExecutor.pendingTrades(requestId);
        assertTrue(buyVolatile);
        assertEq(amountIn, TRADE_AMOUNT);
        assertEq(minOut, minAmountOut);

        // Fulfill random words
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 3;
        vrfCoordinator.fulfillRandomWords(requestId, address(tradeExecutor));

        // Verify trade removed from pending
        (buyVolatile, amountIn, minOut,) = tradeExecutor.pendingTrades(requestId);
        assertFalse(buyVolatile);
        assertEq(amountIn, 0);
        assertEq(minOut, 0);

        vm.stopPrank();
    }

    // Test trade execution after random delay
    function testTradeExecutionAfterDelay() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);
        uint256 requestId = tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Simulate VRF response
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 8;
        vrfCoordinator.fulfillRandomWords(requestId, address(tradeExecutor));

        vm.stopPrank();

        // Verify trade executed
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10 ** 6);
        uint256 actualOut = volatileToken.balanceOf(address(tradeExecutor)) - 10 * 10 ** 18;
        assertGe(actualOut, minAmountOut, "Output less than minimum");
    }
}
