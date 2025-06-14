// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TradeExecutor} from "../src/TradeExecutor.sol";
import {MockERC20} from "../src/mocks/MockToken.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";

contract DeployTradeExecutor is Script {
    // For Anvil deployment
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
        
        // Deploy mock tokens
        MockERC20 tokenA = new MockERC20("TokenA", "TKNA");
        MockERC20 tokenB = new MockERC20("TokenB", "TKNB");
        
        console.log("TokenA deployed at: ", address(tokenA));
        console.log("TokenB deployed at: ", address(tokenB));
        
        // Deploy mock router
        MockUniswapV3Router router = new MockUniswapV3Router();
        console.log("MockRouter deployed at: ", address(router));
        
        // Set exchange rate: 1 TKNA = 100 TKNB
        router.setRate(address(tokenA), address(tokenB), 100 * 10**18);
        console.log("Set exchange rate: 1 TKNA = 100 TKNB");
        
        // Fund router with TokenB for swaps
        uint256 routerFunding = 500000 * 10 ** tokenB.decimals();
        tokenB.transfer(address(router), routerFunding);
        console.log("Funded router with %s TKNB", routerFunding / 10**tokenB.decimals());
        
        // Deploy TradeExecutor
        TradeExecutor executor = new TradeExecutor(address(router));
        console.log("TradeExecutor deployed at: ", address(executor));
        
        // Stop broadcasting
        vm.stopBroadcast();
        
        // Final summary
        console.log("\n======== DEPLOYMENT COMPLETE ========");
        console.log("Token A:     %s (%s)", address(tokenA), tokenA.symbol());
        console.log("Token B:     %s (%s)", address(tokenB), tokenB.symbol());
        console.log("Router:      %s", address(router));
        console.log("Executor:    %s", address(executor));
        console.log("Deployer:    %s", deployer);
        console.log("=====================================");
    }
    
    function getRpcUrl() internal pure returns (string memory) {
        return LOCAL_RPC_URL;
    }
}