// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockStablecoin} from "../src/mocks/MockStablecoin.sol";
import {MockVolatileToken} from "../src/mocks/MockVolatileToken.sol";
import {MockAggregatorV3} from "../test/mocks/MockAggregatorV3.sol";
import {Exchange} from "../src/Exchange.sol";
import {PriceTrigger} from "../src/PriceTrigger.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";

contract DeployOrchestratorExecutor is Script {
    // Share these constants with PriceTrigger deployment
    int256 public constant VOLATILE_INITIAL_PRICE = 3000e8; // $3,000
    uint256 public constant SPIKE_THRESHOLD = 500; // 5%
    uint256 public constant COOLDOWN_PERIOD = 1; // 1 minute

    function run() external {
        vm.startBroadcast();

        // Deploy tokens
        MockStablecoin stableToken = new MockStablecoin();
        MockVolatileToken volatileToken = new MockVolatileToken();

        // Deploy mock price feeds - USE SHARED INSTANCES
        MockAggregatorV3 stableFeed = new MockAggregatorV3(1e8);
        MockAggregatorV3 volatileFeed = new MockAggregatorV3(VOLATILE_INITIAL_PRICE);

        // Deploy Exchange with shared feeds
        Exchange exchange =
            new Exchange(address(stableToken), address(volatileToken), address(stableFeed), address(volatileFeed));

        // Deploy TradeExecutor
        TradeExecutor tradeExecutor = new TradeExecutor(address(stableToken), address(volatileToken), address(exchange));

        // Deploy PriceTrigger with SAME volatileFeed
        PriceTrigger priceTrigger = new PriceTrigger(address(volatileFeed), SPIKE_THRESHOLD, COOLDOWN_PERIOD);

        // Fund TradeExecutor with 10,000 USDC
        stableToken.mint(address(tradeExecutor), 10_000 * 10 ** 6);

        // Mint tokens to msg.sender (deployer EOA)
        stableToken.mint(msg.sender, 100_000 * 10 ** 6);
        volatileToken.mint(msg.sender, 1_000 * 10 ** 18);

        // Approve exchange to spend tokens from deployer
        // Need to switch to EOA context for approvals
        vm.stopBroadcast();

        // Switch to EOA context for approvals and liquidity addition
        vm.startBroadcast();
        stableToken.approve(address(exchange), 100_000 * 10 ** 6);
        volatileToken.approve(address(exchange), 1_000 * 10 ** 18);
        exchange.addLiquidity(100_000 * 10 ** 6, 1_000 * 10 ** 18);

        vm.stopBroadcast();

        // Log addresses for easy reference
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
