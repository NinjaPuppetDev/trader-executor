// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {VRFCoordinatorV2Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

contract ExchangeTest is Test {
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
    uint256 constant INITIAL_STABLE = 100_000 * 10 ** 6;
    uint256 constant INITIAL_VOLATILE = 1_000 * 10 ** 18;
    uint256 constant TRADE_AMOUNT = 1_000 * 10 ** 6;
    bytes32 constant KEY_HASH = 0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15; // Mock keyhash

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

        // Fund TradeExecutor with 10,000 USDC
        stableToken.mint(address(tradeExecutor), 10_000 * 10 ** 6);

        // Add initial liquidity to exchange
        stableToken.mint(deployer, INITIAL_STABLE);
        volatileToken.mint(deployer, INITIAL_VOLATILE);
        stableToken.approve(address(exchange), INITIAL_STABLE);
        volatileToken.approve(address(exchange), INITIAL_VOLATILE);
        exchange.addLiquidity(INITIAL_STABLE, INITIAL_VOLATILE);

        vm.stopPrank();
    }

    function testInitialSetup() public view {
        // Check initial balances
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 10_000 * 10 ** 6);
        assertEq(stableToken.balanceOf(address(exchange)), INITIAL_STABLE);
        assertEq(volatileToken.balanceOf(address(exchange)), INITIAL_VOLATILE);

        // Check reserves
        (uint256 stableReserve, uint256 volatileReserve) = (exchange.stableReserve(), exchange.volatileReserve());
        assertEq(stableReserve, INITIAL_STABLE);
        assertEq(volatileReserve, INITIAL_VOLATILE);
    }

    function testVRFTradeExecution() public {
        vm.startPrank(deployer);
        uint256 requestId = tradeExecutor.executeTrade(true, TRADE_AMOUNT, 5); // Max 5 block delay

        // Simulate VRF response
        uint256[] memory randomWords = new uint256[](1);
        randomWords[0] = 3; // Will cause 3 block delay
        vrfCoordinator.fulfillRandomWords(requestId, address(tradeExecutor));

        vm.stopPrank();

        // Check balances after trade
        uint256 receivedVolatile = volatileToken.balanceOf(address(tradeExecutor));
        assertGt(receivedVolatile, 0);
    }

    function testWithdrawFromExecutor() public {
        vm.startPrank(deployer);
        uint256 initialBalance = stableToken.balanceOf(deployer);

        tradeExecutor.withdrawTokens(address(stableToken), 5_000 * 10 ** 6);
        vm.stopPrank();

        assertEq(stableToken.balanceOf(deployer), initialBalance + 5_000 * 10 ** 6);
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 5_000 * 10 ** 6);
    }

    function testAddLiquidity() public {
        uint256 additionalStable = 10_000 * 10 ** 6;
        uint256 additionalVolatile = 100 * 10 ** 18;

        vm.startPrank(deployer);
        stableToken.mint(deployer, additionalStable);
        volatileToken.mint(deployer, additionalVolatile);

        stableToken.approve(address(exchange), additionalStable);
        volatileToken.approve(address(exchange), additionalVolatile);

        uint256 initialStableReserve = exchange.stableReserve();
        uint256 initialVolatileReserve = exchange.volatileReserve();

        exchange.addLiquidity(additionalStable, additionalVolatile);
        vm.stopPrank();

        assertEq(exchange.stableReserve(), initialStableReserve + additionalStable);
        assertEq(exchange.volatileReserve(), initialVolatileReserve + additionalVolatile);

        // Check portfolio value increased
        assertGt(exchange.getPortfolioValue(), initialStableReserve + (initialVolatileReserve * 3000e18) / 1e18);
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
        uint256 initialStableReserve = exchange.stableReserve();
        uint256 initialVolatileReserve = exchange.volatileReserve();

        vm.prank(trader);
        uint256 amountOut = exchange.swap(true, amountIn);

        // Check balances
        assertGt(volatileToken.balanceOf(trader), initialVolatileBalance);
        assertEq(volatileToken.balanceOf(trader), initialVolatileBalance + amountOut);

        // Check reserves updated
        assertEq(exchange.stableReserve(), initialStableReserve + amountIn);
        assertEq(exchange.volatileReserve(), initialVolatileReserve - amountOut);
    }

    function testPortfolioValueAfterPriceChange() public {
        vm.startPrank(deployer);
        uint256 initialValue = exchange.getPortfolioValue();

        // Simulate price increase to $3500
        volatileFeed.updateAnswer(3500e8);

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
        uint256 expected = (INITIAL_STABLE * 1e18) / INITIAL_VOLATILE;
        assertEq(price, expected);
    }
}
