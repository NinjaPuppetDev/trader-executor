// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";

contract ExchangeTest is Test {
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;
    Exchange public exchange;

    address deployer = address(1);
    address trader = address(2);
    address riskManager = address(3);
    uint256 public pairId = 1; // First pair ID

    // Constants
    uint256 constant INITIAL_STABLE = 100_000 * 10 ** 6;
    uint256 constant INITIAL_VOLATILE = 1_000 * 10 ** 18;
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens and feeds
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();
        stableFeed = new MockAggregatorV3(1e8); // $1.00
        volatileFeed = new MockAggregatorV3(3000e8); // $3000

        // Deploy Exchange
        exchange = new Exchange();

        // Add token pair
        exchange.addTokenPair(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Add initial liquidity
        stableToken.mint(deployer, INITIAL_STABLE);
        volatileToken.mint(deployer, INITIAL_VOLATILE);
        stableToken.approve(address(exchange), INITIAL_STABLE);
        volatileToken.approve(address(exchange), INITIAL_VOLATILE);
        exchange.addLiquidity(pairId, INITIAL_STABLE, INITIAL_VOLATILE);

        // Setup permissions
        exchange.authorizeTrader(trader);
        exchange.authorizeRiskManager(riskManager);

        vm.stopPrank();
    }

    function testInitialSetup() public view {
        // Get token pair fields
        (
            IERC20 sToken,
            IERC20 vToken,
            AggregatorV3Interface sFeed,
            AggregatorV3Interface vFeed,
            uint256 sReserve,
            uint256 vReserve,
            ,
            ,
            ,
            bool active
        ) = exchange.tokenPairs(pairId);

        // Verify pair creation
        assertEq(address(sToken), address(stableToken));
        assertEq(address(vToken), address(volatileToken));
        assertEq(address(sFeed), address(stableFeed));
        assertEq(address(vFeed), address(volatileFeed));
        assertEq(sReserve, INITIAL_STABLE);
        assertEq(vReserve, INITIAL_VOLATILE);
        assertTrue(active);

        // Verify token pair mappings
        assertEq(exchange.tokenToPairId(address(stableToken)), pairId);
        assertEq(exchange.tokenToPairId(address(volatileToken)), pairId);

        // Check permissions
        assertTrue(exchange.authorizedTraders(trader));
        assertTrue(exchange.authorizedRiskManagers(riskManager));
    }

    function testAddLiquidity() public {
        uint256 additionalStable = 10_000 * 10 ** 6;
        uint256 additionalVolatile = 100 * 10 ** 18;

        vm.startPrank(deployer);
        stableToken.mint(deployer, additionalStable);
        volatileToken.mint(deployer, additionalVolatile);
        stableToken.approve(address(exchange), additionalStable);
        volatileToken.approve(address(exchange), additionalVolatile);

        (uint256 sReserveBefore, uint256 vReserveBefore) = exchange.getReserves(pairId);

        exchange.addLiquidity(pairId, additionalStable, additionalVolatile);
        vm.stopPrank();

        (uint256 sReserveAfter, uint256 vReserveAfter) = exchange.getReserves(pairId);
        assertEq(sReserveAfter, sReserveBefore + additionalStable);
        assertEq(vReserveAfter, vReserveBefore + additionalVolatile);
    }

    function testSwap() public {
        uint256 amountIn = 100 * 10 ** 6;
        vm.prank(deployer);
        stableToken.mint(trader, amountIn);

        vm.startPrank(trader);
        stableToken.approve(address(exchange), amountIn);

        (uint256 stableReserveBefore, uint256 volatileReserveBefore) = exchange.getReserves(pairId);
        uint256 volatileBalanceBefore = volatileToken.balanceOf(trader);

        uint256 amountOut = exchange.swap(pairId, true, amountIn);

        (uint256 stableReserveAfter, uint256 volatileReserveAfter) = exchange.getReserves(pairId);
        uint256 volatileBalanceAfter = volatileToken.balanceOf(trader);

        assertEq(stableReserveAfter, stableReserveBefore + amountIn);
        assertEq(volatileReserveAfter, volatileReserveBefore - amountOut);
        assertEq(volatileBalanceAfter, volatileBalanceBefore + amountOut);
        vm.stopPrank();
    }

    function testSwapFor() public {
        uint256 amountIn = 100 * 10 ** 6;
        vm.prank(deployer);
        stableToken.mint(trader, amountIn);

        vm.prank(trader);
        stableToken.approve(address(exchange), amountIn);

        (uint256 sReserveBefore, uint256 vReserveBefore) = exchange.getReserves(pairId);
        uint256 traderVolatileBefore = volatileToken.balanceOf(trader);

        vm.prank(riskManager);
        uint256 amountOut = exchange.swapFor(pairId, trader, true, amountIn);

        (uint256 sReserveAfter, uint256 vReserveAfter) = exchange.getReserves(pairId);
        uint256 traderVolatileAfter = volatileToken.balanceOf(trader);

        assertEq(sReserveAfter, sReserveBefore + amountIn);
        assertEq(vReserveAfter, vReserveBefore - amountOut);
        assertEq(traderVolatileAfter, traderVolatileBefore + amountOut);
    }

    function testUnauthorizedSwap() public {
        uint256 amountIn = 100 * 10 ** 6;
        address unauthorized = address(4);

        vm.startPrank(unauthorized);
        vm.expectRevert(Exchange.Exchange__UnauthorizedTrader.selector);
        exchange.swap(pairId, true, amountIn);
        vm.stopPrank();
    }

    function testUnauthorizedSwapFor() public {
        uint256 amountIn = 100 * 10 ** 6;
        address unauthorized = address(4);

        vm.startPrank(unauthorized);
        vm.expectRevert(Exchange.Exchange__UnauthorizedRiskManager.selector);
        exchange.swapFor(pairId, trader, true, amountIn);
        vm.stopPrank();
    }

    function testPortfolioValue() public {
        // Force price update
        vm.prank(deployer);
        exchange.updatePrice(pairId);

        uint256 portfolioValue = exchange.getPortfolioValue(pairId);

        // Calculate expected value:
        // Stable: 100_000e6 * $1 = 100_000 USD
        // Volatile: 1_000e18 * $3000 = 3_000_000 USD
        // Total: 3_100_000 USD with 18 decimals
        uint256 expected = 3_100_000 * 10 ** 18;
        assertApproxEqRel(portfolioValue, expected, 0.01e18);
    }

    function testPortfolioValueAfterPriceChange() public {
        // First update to set initial prices
        vm.prank(deployer);
        exchange.updatePrice(pairId);
        uint256 initialValue = exchange.getPortfolioValue(pairId);

        // Change the volatile price to 3500e8
        volatileFeed.updateAnswer(3500e8);
        vm.prank(deployer);
        exchange.updatePrice(pairId);

        uint256 newValue = exchange.getPortfolioValue(pairId);
        assertGt(newValue, initialValue);

        // Calculate expected value:
        // Stable: 100_000e6 * $1 = 100_000 USD
        // Volatile: 1_000e18 * $3500 = 3_500_000 USD
        // Total: 3_600_000 USD with 18 decimals
        uint256 expected = 3_600_000 * 10 ** 18;
        assertApproxEqRel(newValue, expected, 0.01e18);
    }

    function testDeactivatePair() public {
        vm.prank(deployer);
        exchange.deactivatePair(pairId);

        // Verify pair is inactive
        (,,,,,,,,, bool active) = exchange.tokenPairs(pairId);
        assertFalse(active);

        // Should revert on using inactive pair
        vm.startPrank(trader);
        vm.expectRevert(Exchange.Exchange__PairInactive.selector);
        exchange.swap(pairId, true, TRADE_AMOUNT);
        vm.stopPrank();
    }

    function testRecoverTokens() public {
        // Deploy dummy token
        MockStablecoin dummyToken = new MockStablecoin();
        dummyToken.mint(address(exchange), 1000e6);

        vm.prank(deployer);
        exchange.recoverTokens(pairId, address(dummyToken), 1000e6);

        assertEq(dummyToken.balanceOf(deployer), 1000e6);
    }

    function testCannotRecoverPairTokens() public {
        vm.prank(deployer);
        vm.expectRevert(Exchange.Exchange__CannotRecoverPairTokens.selector);
        exchange.recoverTokens(pairId, address(stableToken), 100e6);
    }

    function testAddSecondPair() public {
        // Create new assets
        MockStablecoin stable2 = new MockStablecoin();
        MockVolatileToken volatile2 = new MockVolatileToken();
        MockAggregatorV3 feed2 = new MockAggregatorV3(1e8);

        vm.startPrank(deployer);
        exchange.addTokenPair(address(stable2), address(volatile2), address(stableFeed), address(feed2));

        uint256 newPairId = 2;
        assertEq(exchange.pairCount(), 2);
        assertEq(exchange.tokenToPairId(address(stable2)), newPairId);
        assertEq(exchange.tokenToPairId(address(volatile2)), newPairId);
        vm.stopPrank();
    }

    function testPriceUpdate() public {
        // Update feed price
        volatileFeed.updateAnswer(3500e8);

        vm.prank(deployer);
        exchange.updatePrice(pairId);

        (,,,,,,, int256 volatilePrice,,) = exchange.tokenPairs(pairId);
        assertEq(volatilePrice, 3500e8);
    }

    function testReserveBasedPrice() public view {
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves(pairId);
        uint256 price = exchange.getReserveBasedPrice(pairId);
        uint256 expected = (stableReserve * 1e18) / volatileReserve;
        assertEq(price, expected);
    }
}
