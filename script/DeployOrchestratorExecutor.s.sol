// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {RiskManager} from "../src/RiskManager.sol";

contract DeployFullSystem is Script {
    // Constants (unchanged)
    int256 public constant VOLATILE_INITIAL_PRICE = 3700e8;
    int256 public constant STABLE_INITIAL_PRICE = 1e8;
    uint256 public constant SPIKE_THRESHOLD = 10;
    uint256 public constant COOLDOWN_PERIOD = 300;
    uint256 public constant MAX_DATA_AGE = 900;
    uint256 public constant INITIAL_STABLE_LIQUIDITY = 220_000 * 10 ** 6;
    uint256 public constant INITIAL_VOLATILE_LIQUIDITY = 100 * 10 ** 18;
    uint256 public constant PAIR_ID = 1;

    function run() external {
        vm.startBroadcast();

        // 1. Deploy tokens and price feeds
        MockStablecoin stableToken = new MockStablecoin();
        MockVolatileToken volatileToken = new MockVolatileToken();
        MockAggregatorV3 stableFeed = new MockAggregatorV3(STABLE_INITIAL_PRICE);
        MockAggregatorV3 volatileFeed = new MockAggregatorV3(VOLATILE_INITIAL_PRICE);

        // 2. Deploy Exchange
        Exchange exchange = new Exchange();

        // 3. Add token pair to Exchange
        exchange.addTokenPair(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // 4. Deploy TradeExecutor
        TradeExecutor tradeExecutor = new TradeExecutor(address(exchange), PAIR_ID);

        // 5. Deploy other components
        PriceTrigger priceTrigger =
            new PriceTrigger(address(volatileFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD, MAX_DATA_AGE, PAIR_ID);

        // In DeployFullSystem.sol
        RiskManager riskManager = new RiskManager(
            address(exchange),
            address(volatileFeed),
            msg.sender, // Owner = deployer
            address(tradeExecutor),
            PAIR_ID // Add pair ID
        );

        // 6. Authorize components
        exchange.authorizeTrader(address(tradeExecutor));
        exchange.authorizeRiskManager(address(riskManager));

        // 7. Prepare liquidity
        stableToken.mint(msg.sender, INITIAL_STABLE_LIQUIDITY * 10);
        volatileToken.mint(msg.sender, INITIAL_VOLATILE_LIQUIDITY * 10);

        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);

        // 8. Add liquidity
        exchange.addLiquidity(PAIR_ID, INITIAL_STABLE_LIQUIDITY, INITIAL_VOLATILE_LIQUIDITY);

        vm.stopBroadcast();

        // Logging - UPDATED TOKEN ADDRESS ACCESS
        console.log("========= SYSTEM DEPLOYMENT =========");
        console.log("Deployer:        ", msg.sender);
        console.log("StableToken:     ", address(stableToken));
        console.log("VolatileToken:   ", address(volatileToken));
        console.log("StableFeed:      ", address(stableFeed));
        console.log("VolatileFeed:    ", address(volatileFeed));
        console.log("Exchange:        ", address(exchange));
        console.log("TradeExecutor:   ", address(tradeExecutor));
        console.log("PriceTrigger:    ", address(priceTrigger));
        console.log("RiskManager:     ", address(riskManager));
        console.log("====================================");
        console.log(
            "Exchange Reserves for Pair %s: %s stable, %s volatile",
            PAIR_ID,
            INITIAL_STABLE_LIQUIDITY,
            INITIAL_VOLATILE_LIQUIDITY
        );

        // FIXED: Access token addresses directly
        address actualStable = address(tradeExecutor.stableToken());
        address actualVolatile = address(tradeExecutor.volatileToken());
        console.log("TradeExecutor StableToken:  ", actualStable);
        console.log("TradeExecutor VolatileToken:", actualVolatile);
    }
}
