// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../src/mocks/MockStablecoin.sol";
import "../src/mocks/MockVolatileToken.sol";
import "../test/mocks/MockAggregatorV3.sol";
import "../src/Exchange.sol";
import "../src/TradeExecutor.sol";

contract TradeExecutorTest is Test {
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;
    Exchange public exchange;
    TradeExecutor public tradeExecutor;

    address deployer = address(1);
    address trader = address(2);

    // Constants
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6;
    uint256 constant EXCESS_AMOUNT = 20_000 * 10 ** 6;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        stableFeed = new MockAggregatorV3(1e8); // $1.00
        volatileFeed = new MockAggregatorV3(3000e8); // $3000

        // Deploy Exchange
        exchange =
            new Exchange(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Deploy TradeExecutor
        tradeExecutor = new TradeExecutor(address(stableToken), address(volatileToken), address(exchange));

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

    // Helper to calculate minAmountOut
    function calculateMinAmountOut(bool buyVolatile, uint256 amountIn) public view returns (uint256) {
        uint256 amountOut = exchange.calculateTradeOutput(buyVolatile, amountIn);
        return amountOut * 99 / 100; // 1% slippage
    }

    function testExecuteTradeBuy() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();

        // Check balances
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10 ** 6);
        assertGt(volatileToken.balanceOf(address(tradeExecutor)), 0);
    }

    function testExecuteTradeSell() public {
        vm.startPrank(deployer);
        // First buy some tokens to sell
        uint256 minBuyOut = calculateMinAmountOut(true, TRADE_AMOUNT);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minBuyOut);
        uint256 volatileBalance = volatileToken.balanceOf(address(tradeExecutor));

        // Now sell
        uint256 sellAmount = volatileBalance / 2;
        uint256 minSellOut = calculateMinAmountOut(false, sellAmount);
        tradeExecutor.executeTrade(false, sellAmount, minSellOut);
        vm.stopPrank();

        // Should have more stable tokens
        assertGt(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10 ** 6);
    }

    function testSlippageProtection() public {
        vm.startPrank(deployer);
        uint256 amount = TRADE_AMOUNT;
        uint256 expectedOut = exchange.calculateTradeOutput(true, amount);

        // Set minAmountOut too high
        uint256 minAmountOut = expectedOut * 101 / 100;

        vm.expectRevert("Slippage too high");
        tradeExecutor.executeTrade(true, amount, minAmountOut);
        vm.stopPrank();
    }

    function testInsufficientBalance() public {
        vm.startPrank(deployer);
        // Try to trade more than available
        vm.expectRevert("Insufficient stable balance");
        tradeExecutor.executeTrade(true, EXCESS_AMOUNT, 0);
        vm.stopPrank();
    }

    function testNonOwnerExecution() public {
        vm.prank(trader);
        vm.expectRevert("Unauthorized");
        tradeExecutor.executeTrade(true, 100 * 10 ** 6, 0);
    }

    function testOwnershipTransfer() public {
        vm.startPrank(deployer);
        tradeExecutor.transferOwnership(trader);
        vm.stopPrank();

        assertEq(tradeExecutor.owner(), trader);

        // Old owner can't execute
        uint256 minAmountOut = calculateMinAmountOut(true, 100 * 10 ** 6);
        vm.prank(deployer);
        vm.expectRevert("Unauthorized");
        tradeExecutor.executeTrade(true, 100 * 10 ** 6, minAmountOut);

        // New owner can execute
        vm.prank(trader);
        tradeExecutor.executeTrade(true, 100 * 10 ** 6, minAmountOut);
    }

    function testRevokeApprovals() public {
        vm.startPrank(deployer);
        tradeExecutor.revokeApprovals();

        // Should fail after approvals revoked
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT);
        vm.expectRevert();
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);

        // Restore approvals
        tradeExecutor.restoreApprovals();

        // Should work again
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    function testWithdrawTokens() public {
        vm.startPrank(deployer);
        uint256 initialBalance = stableToken.balanceOf(deployer);
        uint256 withdrawAmount = 5_000 * 10 ** 6;

        tradeExecutor.withdrawTokens(address(stableToken), withdrawAmount);
        vm.stopPrank();

        assertEq(stableToken.balanceOf(deployer), initialBalance + withdrawAmount);
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 5_000 * 10 ** 6);
    }
}
