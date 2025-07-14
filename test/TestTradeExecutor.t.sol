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

    uint256 public pairId = 1; // First pair will have ID 1

    address deployer = address(1);
    address trader = address(2);

    // Constants
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6; // 1,000 USDC (6 decimals)
    uint256 constant VOLATILE_TRADE_AMOUNT = 1 * 10 ** 18; // 1 token (18 decimals)

    function setUp() public {
        // Set msg.sender to deployer for all deployments
        vm.startPrank(deployer);

        // Deploy tokens
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        stableFeed = new MockAggregatorV3(1e8); // $1
        volatileFeed = new MockAggregatorV3(3000e8); // $3000

        // Deploy Exchange
        exchange = new Exchange();

        // Add token pair to Exchange
        exchange.addTokenPair(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Deploy TradeExecutor with exchange address and pairId
        tradeExecutor = new TradeExecutor(address(exchange), pairId);

        // AUTHORIZE TradeExecutor as trader in Exchange
        exchange.authorizeTrader(address(tradeExecutor));

        // Fund TradeExecutor
        stableToken.mint(address(tradeExecutor), 10_000 * 10 ** 6);
        volatileToken.mint(address(tradeExecutor), 10 * 10 ** 18);

        // Add initial liquidity to exchange
        stableToken.mint(deployer, 100_000 * 10 ** 6);
        volatileToken.mint(deployer, 1_000 * 10 ** 18);
        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);
        exchange.addLiquidity(pairId, 100_000 * 10 ** 6, 1_000 * 10 ** 18);

        vm.stopPrank();
    }

    // Helper to calculate expected output
    function calculateExpectedOutput(bool buyVolatile, uint256 amountIn) public view returns (uint256) {
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves(pairId);
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
        // Execute as deployer (owner)
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
        // Execute as deployer (owner)
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

    // Test trade with insufficient balance
    function testExecuteTradeInsufficientBalance() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);
        uint256 excessiveAmount = stableToken.balanceOf(address(tradeExecutor)) + 1;

        // Change to expect custom error
        vm.expectRevert(TradeExecutor.TradeExecutor__InsufficientBalance.selector);
        tradeExecutor.executeTrade(true, excessiveAmount, minAmountOut);
        vm.stopPrank();
    }

    // Test trade with insufficient output
    function testExecuteTradeInsufficientOutput() public {
        vm.startPrank(deployer);
        uint256 expectedOut = calculateExpectedOutput(true, TRADE_AMOUNT);
        uint256 minAmountOut = expectedOut + 1;

        // Change to expect custom error
        vm.expectRevert(TradeExecutor.TradeExecutor__InsufficientBalance.selector);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    // Test non-owner cannot execute trade
    function testNonOwnerCannotExecuteTrade() public {
        vm.startPrank(trader);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);

        // Change to expect custom error
        vm.expectRevert(TradeExecutor.TradeExecutor__UnauthorizedOwner.selector);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    // Test position opening with entry price
    function testPositionOpening() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 100);

        // Record logs to capture the actual position ID
        vm.recordLogs();
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        // Find the PositionOpened event
        bytes32 positionId;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == keccak256("PositionOpened(bytes32,address,bool,uint256,uint256)")) {
                positionId = entries[i].topics[1];
                break;
            }
        }

        require(positionId != bytes32(0), "Position ID not found");

        // Verify entry price is non-zero
        uint256 actualEntryPrice = tradeExecutor.getEntryPrice(positionId);
        assertGt(actualEntryPrice, 0, "Entry price should be non-zero");
        vm.stopPrank();
    }
}
