// backend/checkBalances.ts
import { ethers } from 'ethers';
import { CONFIG } from './config';

async function checkBalances() {
    try {
        // Setup provider
        const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);

        // Token contracts
        const tokenA = new ethers.Contract(
            CONFIG.tokenA,
            ['function balanceOf(address) view returns (uint256)'],
            provider
        );

        const tokenB = new ethers.Contract(
            CONFIG.tokenB,
            ['function balanceOf(address) view returns (uint256)'],
            provider
        );

        // Executor contract
        const executorAbi = require('../app/abis/TraderExecutor.json');
        const executor = new ethers.Contract(
            CONFIG.executorAddress,
            executorAbi,
            provider
        );

        // Wallet
        const wallet = new ethers.Wallet(CONFIG.privateKey, provider);

        // Check balances
        const executorABalance = await tokenA.balanceOf(CONFIG.executorAddress);
        const executorBBalance = await tokenB.balanceOf(CONFIG.executorAddress);
        const walletABalance = await tokenA.balanceOf(wallet.address);
        const walletBBalance = await tokenB.balanceOf(wallet.address);

        console.log('💰 Token Balances:');
        console.log(`  Executor TKNA: ${ethers.utils.formatUnits(executorABalance, 18)}`);
        console.log(`  Executor TKNB: ${ethers.utils.formatUnits(executorBBalance, 18)}`);
        console.log(`  Wallet TKNA:   ${ethers.utils.formatUnits(walletABalance, 18)}`);
        console.log(`  Wallet TKNB:   ${ethers.utils.formatUnits(walletBBalance, 18)}`);

        // Check owner
        const owner = await executor.owner();
        console.log(`🔒 Executor contract owner: ${owner}`);
        console.log(`🔐 Wallet address:          ${wallet.address}`);

        // Check if wallet is owner
        console.log(`🔐 Is wallet owner? ${owner === wallet.address ? 'YES' : 'NO'}`);

    } catch (error) {
        console.error('❌ Balance check failed:', error);
    }
}

// Run the check
checkBalances();