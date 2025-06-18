// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";

contract DeployTradeExecutor is Script {
    string private constant LOCAL_RPC_URL = "http://127.0.0.1:8545";
    address private constant ANVIL_DEPLOYER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    function run() external {
        // Set RPC URL and deployer
        string memory rpcUrl = getRpcUrl();
        address deployer = ANVIL_DEPLOYER;

        console.log("Using RPC URL: ", rpcUrl);
        console.log("Deployer address: ", deployer);

        // Start broadcasting transactions
        vm.startBroadcast(deployer);

        // Deploy mock tokens with 18 decimals
        MockERC20 tokenA = new MockERC20("TokenA", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("TokenB", "TKNB", 18);

        console.log("TokenA deployed at: ", address(tokenA));
        console.log("TokenB deployed at: ", address(tokenB));

        // Deploy mock router
        MockUniswapV3Router router = new MockUniswapV3Router();
        console.log("MockRouter deployed at: ", address(router));

        // Set exchange rates with proper decimals
        uint256 rateAB = 100 * 10 ** tokenB.decimals(); // 1 TKNA = 100 TKNB
        uint256 rateBA = (10 ** tokenA.decimals()) / 100; // 1 TKNB = 0.01 TKNA

        router.setRate(address(tokenA), address(tokenB), rateAB);
        router.setRate(address(tokenB), address(tokenA), rateBA);

        console.log("Set exchange rate: 1 TKNA = 100 TKNB");
        console.log("Set exchange rate: 1 TKNB = 0.01 TKNA");

        // Deploy TradeExecutor
        TradeExecutor executor = new TradeExecutor(address(router));
        console.log("TradeExecutor deployed at: ", address(executor));

        // Fund tokens
        uint256 initialBalance = 1000 * 10 ** tokenA.decimals();

        tokenA.mint(address(executor), initialBalance);
        tokenB.mint(address(executor), initialBalance * 100);

        console.log("Minted %s TKNA to executor", initialBalance / 10 ** tokenA.decimals());
        console.log("Minted %s TKNB to executor", (initialBalance * 100) / 10 ** tokenB.decimals());

        // Fund router
        uint256 routerFunding = 500000 * 10 ** tokenB.decimals();
        tokenA.mint(address(router), routerFunding);
        tokenB.mint(address(router), routerFunding);

        console.log("Funded router with %s TKNA", routerFunding / 10 ** tokenA.decimals());
        console.log("Funded router with %s TKNB", routerFunding / 10 ** tokenB.decimals());

        // Stop broadcasting
        vm.stopBroadcast();

        // Final summary
        console.log("\n======== DEPLOYMENT COMPLETE ========");
        console.log("Token A:     %s (%s)", address(tokenA), tokenA.symbol());
        console.log("Token B:     %s (%s)", address(tokenB), tokenB.symbol());
        console.log("Router:      %s", address(router));
        console.log("Executor:    %s", address(executor));
        console.log("Executor Owner: %s", executor.owner());
        console.log("TKNA Balance:  %s", tokenA.balanceOf(address(executor)) / 10 ** tokenA.decimals());
        console.log("TKNB Balance:  %s", tokenB.balanceOf(address(executor)) / 10 ** tokenB.decimals());
        console.log("=====================================");
    }

    function getRpcUrl() internal pure returns (string memory) {
        return LOCAL_RPC_URL;
    }
}
