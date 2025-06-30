// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";

contract DeployOrchestratorExecutor is Script {
    // Share these constants with PriceTrigger deployment
    int256 public constant VOLATILE_INITIAL_PRICE = 2200e8; // $2,200
    uint256 public constant SPIKE_THRESHOLD = 100; // 1%
    uint256 public constant COOLDOWN_PERIOD = 300; // 5 minutes
    uint256 public constant MAX_DATA_AGE = 3600; // 1 hour

    function run() external {
        vm.startBroadcast();

        // Deploy tokens
        MockStablecoin stableToken = new MockStablecoin();
        MockVolatileToken volatileToken = new MockVolatileToken();

        // Deploy mock price feeds
        MockAggregatorV3 stableFeed = new MockAggregatorV3(1e8); // $1.00
        MockAggregatorV3 volatileFeed = new MockAggregatorV3(VOLATILE_INITIAL_PRICE); // $2,200

        // Deploy Exchange with shared feeds
        Exchange exchange =
            new Exchange(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Initialize Exchange prices
        exchange.updateStablePrice(1e8);
        exchange.updateVolatilePrice(VOLATILE_INITIAL_PRICE);

        // Deploy TradeExecutor (VRF removed)
        TradeExecutor tradeExecutor = new TradeExecutor(address(stableToken), address(volatileToken), address(exchange));

        // Deploy PriceTrigger
        PriceTrigger priceTrigger =
            new PriceTrigger(address(volatileFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD, MAX_DATA_AGE);

        // Fund TradeExecutor with 10,000 USDC
        stableToken.mint(address(tradeExecutor), 10_000 * 10 ** 6);

        // Mint sufficient tokens to deployer
        stableToken.mint(msg.sender, 220_000 * 10 ** 6);
        volatileToken.mint(msg.sender, 1_000 * 10 ** 18);

        vm.stopBroadcast();

        // Perform approvals and liquidity addition in separate tx
        vm.startBroadcast();
        stableToken.approve(address(exchange), 220_000 * 10 ** 6);
        volatileToken.approve(address(exchange), 1_000 * 10 ** 18);
        exchange.addLiquidity(220_000e6, 100e18); // 220,000 USDC and 100 volatile tokens
        vm.stopBroadcast();

        // Log addresses
        console.log("Deployer Address: ", msg.sender);
        console.log("MockStablecoin: ", address(stableToken));
        console.log("MockVolatileToken: ", address(volatileToken));
        console.log("StableFeed: ", address(stableFeed));
        console.log("VolatileFeed: ", address(volatileFeed));
        console.log("Exchange: ", address(exchange));
        console.log("TradeExecutor: ", address(tradeExecutor));
        console.log("PriceTrigger: ", address(priceTrigger));
    }
}
