// backend/config.ts
import { ethers } from 'ethers';

export const CONFIG = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    tokenA: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    tokenB: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    defaultAmount: '0.03',
    slippagePercent: 1,
    poolFee: 3000,
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei').toString()
};