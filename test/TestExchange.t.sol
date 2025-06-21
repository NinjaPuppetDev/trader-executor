// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../src/mocks/MockStablecoin.sol";
import "../src/mocks/MockVolatileToken.sol";
import "../test/mocks/MockAggregatorV3.sol";
import "../src/Exchange.sol";
import "../src/TradeExecutor.sol";


contract ExchangeTest is Test {
    MockStablecoin public stableToken;
    MockVolatileToken public volatileToken;
    MockAggregatorV3 public stableFeed;
    MockAggregatorV3 public volatileFeed;
    Exchange public exchange;
    TradeExecutor public tradeExecutor;

    address deployer = address(1);
    address trader = address(2);
    
    // Constants
    uint256 constant INITIAL_STABLE = 100_000 * 10**6;
    uint256 constant INITIAL_VOLATILE = 1_000 * 10**18;
    uint256 constant TRADE_AMOUNT = 1_000 * 10**6;

    function setUp() public {
        vm.startPrank(deployer);

        // Deploy tokens
        stableToken = new MockStablecoin();
        volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        stableFeed = new MockAggregatorV3(1e8); // $1.00
        volatileFeed = new MockAggregatorV3(3000e8); // $3000

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

        // Fund TradeExecutor with 10,000 USDC
        stableToken.mint(address(tradeExecutor), 10_000 * 10**6);

        // Add initial liquidity to exchange
        stableToken.mint(deployer, INITIAL_STABLE);
        volatileToken.mint(deployer, INITIAL_VOLATILE);
        stableToken.approve(address(exchange), INITIAL_STABLE);
        volatileToken.approve(address(exchange), INITIAL_VOLATILE);
        exchange.addLiquidity(INITIAL_STABLE, INITIAL_VOLATILE);

        // Set TradeExecutor as owner of its own tokens
        vm.stopPrank();
    }

    // Helper function to calculate minAmountOut with slippage
    function calculateMinAmountOut(bool buyVolatile, uint256 amountIn, uint256 slippagePercent) 
        public view returns (uint256) 
    {
        uint256 amountOut = exchange.calculateTradeOutput(buyVolatile, amountIn);
        return amountOut * (100 - slippagePercent) / 100;
    }

    function testInitialSetup() public {
        // Check initial balances
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 10_000 * 10**6);
        assertEq(stableToken.balanceOf(address(exchange)), INITIAL_STABLE);
        assertEq(volatileToken.balanceOf(address(exchange)), INITIAL_VOLATILE);
        
        // Check reserves
        (uint256 stableReserve, uint256 volatileReserve) = (exchange.stableReserve(), exchange.volatileReserve());
        assertEq(stableReserve, INITIAL_STABLE);
        assertEq(volatileReserve, INITIAL_VOLATILE);
    }

    function testBuyVolatile() public {
        vm.startPrank(deployer);
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 1);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();

        // Check balances after trade
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 9_000 * 10**6);
        assertGt(volatileToken.balanceOf(address(tradeExecutor)), 0);
        
        // Check reserves updated
        assertEq(exchange.stableReserve(), INITIAL_STABLE + TRADE_AMOUNT);
        assertLt(exchange.volatileReserve(), INITIAL_VOLATILE);
    }

    function testSellVolatile() public {
        // First buy some volatile token
        vm.startPrank(deployer);
        uint256 minBuyOut = calculateMinAmountOut(true, TRADE_AMOUNT, 1);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minBuyOut);
        uint256 volatileBalance = volatileToken.balanceOf(address(tradeExecutor));

        // Now sell half
        uint256 sellAmount = volatileBalance / 2;
        uint256 minSellOut = calculateMinAmountOut(false, sellAmount, 1);
        tradeExecutor.executeTrade(false, sellAmount, minSellOut);
        vm.stopPrank();

        // Check balances
        uint256 stableBalance = stableToken.balanceOf(address(tradeExecutor));
        assertGt(stableBalance, 9_000 * 10**6);
        assertLt(stableBalance, 9_500 * 10**6);
        
        // Check volatile token balance with 1 wei tolerance
        uint256 newVolatileBalance = volatileToken.balanceOf(address(tradeExecutor));
        assertApproxEqAbs(newVolatileBalance, volatileBalance - sellAmount, 1);
    }

    function testSlippageProtection() public {
        vm.startPrank(deployer);
        uint256 expectedOut = exchange.calculateTradeOutput(true, TRADE_AMOUNT);
        
        // Set minAmountOut too high (101% of expected)
        uint256 minAmountOut = expectedOut * 101 / 100;
        
        vm.expectRevert("Slippage too high");
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
    }

    function testPriceChange() public {
        vm.startPrank(deployer);
        // Get initial price
        uint256 initialPrice = exchange.getNormalizedPrice();
        
        // Change price feed to $3500
        volatileFeed.setPrice(3500e8);
        
        // Check price updated
        uint256 newPrice = exchange.getNormalizedPrice();
        assertGt(newPrice, initialPrice);
        
        // Execute trade with new price
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 1);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        uint256 volatileBought = volatileToken.balanceOf(address(tradeExecutor));
        vm.stopPrank();
        
        // Should get less tokens because price increased
        assertLt(volatileBought, 1e18); // Less than 1 ETH equivalent
    }

    function testPortfolioValue() public {
        vm.startPrank(deployer);
        uint256 initialValue = exchange.getPortfolioValue();
        assertGt(initialValue, 0);
        
        // Execute trade
        uint256 minAmountOut = calculateMinAmountOut(true, TRADE_AMOUNT, 1);
        tradeExecutor.executeTrade(true, TRADE_AMOUNT, minAmountOut);
        vm.stopPrank();
        
        uint256 afterTradeValue = exchange.getPortfolioValue();
        // Portfolio value should increase because of swap fees
        assertGt(afterTradeValue, initialValue);
    }

    function testWithdrawFromExecutor() public {
        vm.startPrank(deployer);
        uint256 initialBalance = stableToken.balanceOf(deployer);
        
        tradeExecutor.withdrawTokens(address(stableToken), 5_000 * 10**6);
        vm.stopPrank();
        
        assertEq(stableToken.balanceOf(deployer), initialBalance + 5_000 * 10**6);
        assertEq(stableToken.balanceOf(address(tradeExecutor)), 5_000 * 10**6);
    }

    function testOwnershipTransfer() public {
        vm.startPrank(deployer);
        tradeExecutor.transferOwnership(trader);
        vm.stopPrank();
        
        assertEq(tradeExecutor.owner(), trader);
        
        // Try to execute trade as old owner (should fail)
        uint256 minAmountOut = calculateMinAmountOut(true, 100 * 10**6, 1);
        vm.prank(deployer);
        vm.expectRevert("Unauthorized");
        tradeExecutor.executeTrade(true, 100 * 10**6, minAmountOut);
        
        // New owner can execute
        vm.prank(trader);
        tradeExecutor.executeTrade(true, 100 * 10**6, minAmountOut);
    }
    
    function testAddLiquidity() public {
        uint256 additionalStable = 10_000 * 10**6;
        uint256 additionalVolatile = 100 * 10**18;
        
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
    }
    
    function testSwapDirectly() public {
        // Test swapping directly on exchange
        uint256 amountIn = 100 * 10**6;
        uint256 minAmountOut = calculateMinAmountOut(true, amountIn, 1);
        
        vm.startPrank(deployer);
        // Fund trader
        stableToken.mint(trader, amountIn);
        vm.stopPrank();
        
        vm.prank(trader);
        stableToken.approve(address(exchange), amountIn);
        
        uint256 initialVolatileBalance = volatileToken.balanceOf(trader);
        
        vm.prank(trader);
        exchange.swap(true, amountIn, minAmountOut);
        
        assertGt(volatileToken.balanceOf(trader), initialVolatileBalance);
    }
}