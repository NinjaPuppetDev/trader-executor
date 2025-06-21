// backend/config.ts
import { ethers } from 'ethers';

export const CONFIG = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    defaultAmount: '0.03',
    slippagePercent: 1,
    poolFee: 3000,
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei').toString()
};