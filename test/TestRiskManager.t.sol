// test/TestRiskManager.t.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {Exchange} from "../src/Exchange.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";

contract TestRiskManager is Test {
    RiskManager public riskManager;
    TradeExecutor public tradeExecutor;
    Exchange public exchange;
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;

    address owner = address(this);
    address trader = address(0x1);
    address riskOperator = address(0x2);
    uint256 public constant PAIR_ID = 1;

    // Events to test
    event PositionOpened(bytes32 indexed positionId, address trader, bool isLong, uint256 amount, uint256 entryPrice);
    event PositionClosed(bytes32 indexed positionId, string reason, uint256 amountOut);

    function setUp() public {
        // Deploy tokens and price feeds
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();
        stableFeed = new MockAggregatorV3(1e8); // $1.00
        volatileFeed = new MockAggregatorV3(2000e8); // $2000.00

        // Deploy core contracts
        exchange = new Exchange();
        // Add pair to exchange
        exchange.addTokenPair(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        tradeExecutor = new TradeExecutor(address(exchange), PAIR_ID);
        riskManager = new RiskManager(address(exchange), address(volatileFeed), owner, address(tradeExecutor), PAIR_ID);

        // Configure system
        tradeExecutor.setRiskManager(address(riskManager));
        riskManager.addExecutor(riskOperator);

        // Setup authorizations
        exchange.authorizeTrader(address(tradeExecutor));
        exchange.authorizeRiskManager(address(riskManager));

        // Fund contracts
        stableToken.mint(owner, 10_000e6);
        volatileToken.mint(owner, 10_000e18);
        stableToken.mint(address(tradeExecutor), 1_000e6);
        volatileToken.mint(address(tradeExecutor), 1_000e18);

        // Add liquidity
        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);
        exchange.addLiquidity(PAIR_ID, 1_000e6, 1_000e18);

        // Transfer executor ownership to trader
        vm.prank(owner);
        tradeExecutor.transferOwnership(trader);

        // Fund trader and approve Exchange
        volatileToken.mint(trader, 10_000e18);
        stableToken.mint(trader, 10_000e6);
        vm.startPrank(trader);
        volatileToken.approve(address(exchange), type(uint256).max);
        stableToken.approve(address(exchange), type(uint256).max);
        vm.stopPrank();
    }

    function testRiskManagerSetup() public view {
        assertEq(address(riskManager.exchange()), address(exchange), "Exchange address should be set");
        assertEq(address(riskManager.priceFeed()), address(volatileFeed), "PriceFeed address should be set");
        assertEq(riskManager.owner(), owner, "Owner should be set");
        assertEq(address(riskManager.tradeExecutor()), address(tradeExecutor), "TradeExecutor address should be set");
        assertEq(riskManager.pairId(), PAIR_ID, "Pair ID should be set");
    }

    function testOpenPosition() public {
        uint256 amount = 1e18;
        uint24 stopLoss = 500; // 5%
        uint24 takeProfit = 1000; // 10%
        uint256 entryPrice = 2000e18; // $2000 in 18 decimals

        bytes32 positionId = _generatePositionId(trader, amount);

        vm.expectEmit(true, true, true, true);
        emit PositionOpened(positionId, trader, true, amount, entryPrice);

        vm.prank(riskOperator);
        riskManager.openPositionWithParams(
            trader,
            true, // isLong
            amount,
            stopLoss,
            takeProfit,
            entryPrice,
            positionId
        );

        // Verify position details
        (address positionTrader, bool isLong, uint256 posAmount,,,, uint256 posEntryPrice) =
            riskManager.positions(positionId);

        assertEq(positionTrader, trader, "Trader mismatch");
        assertEq(isLong, true, "Position direction mismatch");
        assertEq(posAmount, amount, "Amount mismatch");
        assertEq(posEntryPrice, entryPrice, "Entry price mismatch");
    }

    function testInvalidPositionId() public {
        vm.prank(riskOperator);
        vm.expectRevert(RiskManager.RiskManager__InvalidPositionId.selector);
        riskManager.openPositionWithParams(
            trader,
            true,
            1e18,
            500,
            1000,
            2000e18,
            bytes32(0) // Invalid zero positionId
        );
    }

    function testDuplicatePosition() public {
        bytes32 positionId = _generatePositionId(trader, 1e18);

        // First call should succeed
        vm.prank(riskOperator);
        riskManager.openPositionWithParams(trader, true, 1e18, 500, 1000, 2000e18, positionId);

        // Second call should fail
        vm.prank(riskOperator);
        vm.expectRevert(RiskManager.RiskManager__PositionAlreadyExists.selector);
        riskManager.openPositionWithParams(trader, true, 1e18, 500, 1000, 2000e18, positionId);
    }

    function testStopLossTriggerLong() public {
        uint256 amount = 1e18;
        uint24 stopLoss = 500; // 5%
        uint24 takeProfit = 1000; // 10%
        uint256 entryPrice = 2000e18; // $2000
        bytes32 positionId = _generatePositionId(trader, amount);

        // Open position
        vm.prank(riskOperator);
        riskManager.openPositionWithParams(
            trader,
            true, // long position
            amount,
            stopLoss,
            takeProfit,
            entryPrice,
            positionId
        );

        // Update price to trigger 5.1% drop ($1898)
        volatileFeed.updateAnswer(1898e8);
        (, int256 newPrice,,,) = volatileFeed.latestRoundData();
        assertEq(uint256(newPrice), 1898e8, "Price should be $1898");

        // Expect position close event - don't check amountOut value
        vm.expectEmit(true, true, true, false); // Only check indexed params
        emit PositionClosed(positionId, "SL-LONG", 0);

        // Execute risk management
        vm.prank(riskOperator);
        riskManager.executeRiskManagementTrade(positionId);

        // Verify position removed
        (address positionTrader,,,,,,) = riskManager.positions(positionId);
        assertEq(positionTrader, address(0), "Position should be closed");
    }

    function testTakeProfitTriggerShort() public {
        uint256 amount = 1e6;
        uint24 stopLoss = 500; // 5%
        uint24 takeProfit = 1000; // 10%
        uint256 entryPrice = 2000e18; // $2000
        bytes32 positionId = _generatePositionId(trader, amount);

        // Open short position
        vm.prank(riskOperator);
        riskManager.openPositionWithParams(
            trader,
            false, // short position
            amount,
            stopLoss,
            takeProfit,
            entryPrice,
            positionId
        );

        // Update price to trigger 10.1% drop ($1798)
        volatileFeed.updateAnswer(1798e8);

        // Expect position close event - don't check amountOut value
        vm.expectEmit(true, true, true, false); // Only check indexed params
        emit PositionClosed(positionId, "TP-SHORT", 0);

        // Execute risk management
        vm.prank(riskOperator);
        riskManager.executeRiskManagementTrade(positionId);

        // Verify position removed
        (address positionTrader,,,,,,) = riskManager.positions(positionId);
        assertEq(positionTrader, address(0), "Position should be closed");
    }

    function testUpdateRiskParameters() public {
        bytes32 positionId = _generatePositionId(trader, 1e18);

        // Open position
        vm.prank(riskOperator);
        riskManager.openPositionWithParams(
            trader,
            true,
            1e18,
            500, // 5% SL
            1000, // 10% TP
            2000e18,
            positionId
        );

        // Update parameters
        vm.prank(riskOperator);
        riskManager.updateRiskParameters(positionId, 300, 1500); // 3% SL, 15% TP

        // Verify updates
        (,,, uint24 sl, uint24 tp,,) = riskManager.positions(positionId);
        assertEq(sl, 300, "Stop loss not updated");
        assertEq(tp, 1500, "Take profit not updated");
    }

    function testNonOperatorCannotOpenPosition() public {
        bytes32 positionId = _generatePositionId(trader, 1e18);

        vm.prank(address(0x123));
        vm.expectRevert("Unauthorized executor");
        riskManager.openPositionWithParams(trader, true, 1e18, 500, 1000, 2000e18, positionId);
    }

    function testCannotUpdateInvalidPosition() public {
        bytes32 invalidId = keccak256("invalid_position");

        vm.prank(riskOperator);
        vm.expectRevert(RiskManager.RiskManager__InvalidPosition.selector);
        riskManager.updateRiskParameters(invalidId, 300, 1500);
    }

    // Helper function to generate position IDs
    function _generatePositionId(address _trader, uint256 _amount) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(_trader, block.timestamp, _amount));
    }
}
