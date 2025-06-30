// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";

contract TestTradeExecutor is Test {
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;
    Exchange public exchange;
    TradeExecutor public tradeExecutor;

    address deployer = address(1);
    address trader = address(2);

    // Constants
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6; // 1,000 USDC (6 decimals)
    uint256 constant VOLATILE_TRADE_AMOUNT = 1 * 10 ** 18; // 1 token (18 decimals)

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        stableFeed = new MockAggregatorV3(1e8);
        volatileFeed = new MockAggregatorV3(3000e8);

        // Deploy Exchange
        exchange = new Exchange(
            address(stableToken),
            address(volatileToken),
            address(stableFeed),
            address(volatileFeed)
        );

        // Deploy TradeExecutor
        tradeExecutor = new TradeExecutor(
            address(stableToken),
            address(volatileToken),
            address(exchange)
        );

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
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves();
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

    // Test successful buy trade
    function testExecuteTradeBuy() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100); // 1% slippage

        // Pre-execution balances
        uint256 initialStable = stableToken.balanceOf(address(tradeExecutor));
        uint256 initialVolatile = volatileToken.balanceOf(address(tradeExecutor));

        // Execute trade
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Post-execution balances
        uint256 finalStable = stableToken.balanceOf(address(tradeExecutor));
        uint256 finalVolatile = volatileToken.balanceOf(address(tradeExecutor));

        // Check balances: stable should decrease by TRADE_AMOUNT, volatile should increase by at least minAmountOut
        assertEq(finalStable, initialStable - TRADE_AMOUNT, "Stable balance mismatch");
        uint256 volatileOut = finalVolatile - initialVolatile;
        assertGe(volatileOut, minAmountOut, "Output less than minimum");
        vm.stopPrank();
    }

    // Test successful sell trade
    function testExecuteTradeSell() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(false, VOLATILE_TRADE_AMOUNT, 100); // 1% slippage

        // Pre-execution balances
        uint256 initialStable = stableToken.balanceOf(address(tradeExecutor));
        uint256 initialVolatile = volatileToken.balanceOf(address(tradeExecutor));

        // Execute trade
        tradeExecutor.executeTrade(false, VOLATILE_TRADE_AMOUNT, minAmountOut);

        // Post-execution balances
        uint256 finalStable = stableToken.balanceOf(address(tradeExecutor));
        uint256 finalVolatile = volatileToken.balanceOf(address(tradeExecutor));

        // Check balances: volatile should decrease by VOLATILE_TRADE_AMOUNT, stable should increase by at least minAmountOut
        assertEq(finalVolatile, initialVolatile - VOLATILE_TRADE_AMOUNT, "Volatile balance mismatch");
        uint256 stableOut = finalStable - initialStable;
        assertGe(stableOut, minAmountOut, "Output less than minimum");
        vm.stopPrank();
    }

    // Test token withdrawal functionality
    function testWithdrawTokens() public {
        vm.startPrank(deployer);
        uint256 initialBalance = stableToken.balanceOf(deployer);
        uint256 withdrawAmount = 5_000 * 10 ** 6;

        tradeExecutor.withdrawTokens(address(stableToken), withdrawAmount);
        vm.stopPrank();

        assertEq(stableToken.balanceOf(deployer), initialBalance + withdrawAmount, "Deployer balance mismatch");
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 5_000 * 10 ** 6, "TradeExecutor balance mismatch");
    }

    // Test trade with insufficient balance
    function testExecuteTradeInsufficientBalance() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);

        // Try to trade more than balance
        uint256 excessiveAmount = stableToken.balanceOf(address(tradeExecutor)) + 1;
        vm.expectRevert("Insufficient balance");
        tradeExecutor.executeTrade(true, excessiveAmount, minAmountOut);
        vm.stopPrank();
    }

    // Test trade with insufficient output
    function testExecuteTradeInsufficientOutput() public {
        vm.startPrank(deployer);
        uint256 expectedOut = calculateExpectedOutput(true, TRADE_AMOUNT);
        uint256 minAmountOut = expectedOut + 1; // Set min output higher than expected
        
        vm.expectRevert("Insufficient output amount");
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    // Test non-owner cannot execute trade
    function testNonOwnerCannotExecuteTrade() public {
        vm.startPrank(trader);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);
        vm.expectRevert("Unauthorized");
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    // Test non-owner cannot withdraw
    function testNonOwnerCannotWithdraw() public {
        vm.startPrank(trader);
        vm.expectRevert("Unauthorized");
        tradeExecutor.withdrawTokens(address(stableToken), 100);
        vm.stopPrank();
    }
}