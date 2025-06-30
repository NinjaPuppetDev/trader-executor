// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
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

    // Constants
    uint256 constant INITIAL_STABLE = 100_000 * 10 ** 6;
    uint256 constant INITIAL_VOLATILE = 1_000 * 10 ** 18;
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6;

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

        // Add initial liquidity to exchange
        stableToken.mint(deployer, INITIAL_STABLE);
        volatileToken.mint(deployer, INITIAL_VOLATILE);
        stableToken.approve(address(exchange), INITIAL_STABLE);
        volatileToken.approve(address(exchange), INITIAL_VOLATILE);
        exchange.addLiquidity(INITIAL_STABLE, INITIAL_VOLATILE);

        vm.stopPrank();
    }

    function testInitialSetup() public view {
        // Check reserves
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves();
        assertEq(stableReserve, INITIAL_STABLE);
        assertEq(volatileReserve, INITIAL_VOLATILE);
    }

    function testAddLiquidity() public {
        uint256 additionalStable = 10_000 * 10 ** 6;
        uint256 additionalVolatile = 100 * 10 ** 18;

        vm.startPrank(deployer);
        stableToken.mint(deployer, additionalStable);
        volatileToken.mint(deployer, additionalVolatile);

        stableToken.approve(address(exchange), additionalStable);
        volatileToken.approve(address(exchange), additionalVolatile);

        (uint256 initialStableReserve, uint256 initialVolatileReserve) = exchange.getReserves();

        exchange.addLiquidity(additionalStable, additionalVolatile);
        vm.stopPrank();

        (uint256 newStableReserve, uint256 newVolatileReserve) = exchange.getReserves();
        assertEq(newStableReserve, initialStableReserve + additionalStable);
        assertEq(newVolatileReserve, initialVolatileReserve + additionalVolatile);
    }

    function testSwapDirectly() public {
        // Test swapping directly on exchange
        uint256 amountIn = 100 * 10 ** 6;

        vm.startPrank(deployer);
        // Fund trader
        stableToken.mint(trader, amountIn);
        vm.stopPrank();

        vm.prank(trader);
        stableToken.approve(address(exchange), amountIn);

        uint256 initialVolatileBalance = volatileToken.balanceOf(trader);
        (uint256 initialStableReserve, uint256 initialVolatileReserve) = exchange.getReserves();

        vm.prank(trader);
        uint256 amountOut = exchange.swap(true, amountIn);

        // Check balances
        assertGt(volatileToken.balanceOf(trader), initialVolatileBalance);
        assertEq(volatileToken.balanceOf(trader), initialVolatileBalance + amountOut);

        // Check reserves updated
        (uint256 newStableReserve, uint256 newVolatileReserve) = exchange.getReserves();
        assertEq(newStableReserve, initialStableReserve + amountIn);
        assertEq(newVolatileReserve, initialVolatileReserve - amountOut);
    }

    function testPortfolioValueAfterPriceChange() public {
        vm.startPrank(deployer);
        uint256 initialValue = exchange.getPortfolioValue();

        // Simulate price increase to $3500
        volatileFeed.updateAnswer(3500e8);
        (, int256 newVolatilePrice,,,) = volatileFeed.latestRoundData();
        exchange.updateVolatilePrice(newVolatilePrice);

        uint256 newValue = exchange.getPortfolioValue();
        assertGt(newValue, initialValue);

        // Calculate expected increase (volatile portion should increase by 16.67%)
        uint256 volatileValuePortion = (INITIAL_VOLATILE * 3000e18) / 1e18;
        uint256 expectedIncrease = (volatileValuePortion * 500) / 3000;
        assertApproxEqRel(newValue, initialValue + expectedIncrease, 0.01e18); // 1% tolerance
    }

    function testReserveBasedPrice() public view {
        uint256 price = exchange.getReserveBasedPrice();
        // Expected price = stableReserve / volatileReserve in 18 decimals
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves();
        uint256 expected = (stableReserve * 1e18) / volatileReserve;
        assertEq(price, expected);
    }
}
