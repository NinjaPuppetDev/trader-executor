// backend/config.ts
import { ethers } from 'ethers';

export const CONFIG = {
    rpcUrl: 'http://127.0.0.1:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    volatileFeedAddress: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    priceTriggerAddress: process.env.PRICE_TRIGGER_ADDRESS || '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    stableFeedAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    exchangeAddress: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    privateKeyKeeper: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    priceUpdateInterval: 15 * 60 * 1000,
    defaultAmount: '0.03',
    slippagePercent: 1,
    poolFee: 3000,
    chainId: 31337,
    networkName: 'anvil',
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei').toString(),
    pairId: parseInt(process.env.PAIR_ID || '1'),

};

