import { ethers } from 'ethers';
import { getOnBalanceVolume } from './utils/obvService';
import { CONFIG } from './config';
import dotenv from 'dotenv';
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import ExchangeAbi from "../app/abis/Exchange.json"; // Import the updated ABI



dotenv.config();

// ABI for mock price feeds
const MOCK_AGGREGATOR_ABI = [
    {
        "inputs": [
            {
                "internalType": "int256",
                "name": "_newPrice",
                "type": "int256"
            }
        ],
        "name": "updateAnswer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

async function triggerPriceUpkeep(signer: ethers.Wallet) {
    if (!CONFIG.priceTriggerAddress) {
        console.log("⏭️ Price Trigger address not set - skipping upkeep");
        return;
    }

    const priceTrigger = new ethers.Contract(
        CONFIG.priceTriggerAddress,
        PriceTriggerAbi,
        signer
    );

    try {
        console.log("🔍 Checking price upkeep...");
        const [upkeepNeeded] = await priceTrigger.checkUpkeep("0x");

        if (upkeepNeeded) {
            console.log("⏱️ Upkeep needed - performing...");
            const tx = await priceTrigger.performUpkeep("0x");
            console.log("⏳ Waiting for upkeep confirmation...");
            await tx.wait();
            console.log("✅ Upkeep performed");
        } else {
            console.log("⏭️ Upkeep not needed");
        }
    } catch (err) {
        console.error("❌ Upkeep check failed:", err);
    }
}

async function updateContractPrice(
    contract: ethers.Contract,
    price: number,
    label: string
) {
    try {
        const priceWithDecimals = ethers.utils.parseUnits(price.toFixed(8), 8);

        // Estimate gas with manual fallback
        let gasLimit;
        try {
            gasLimit = await contract.estimateGas.updateAnswer(priceWithDecimals);
            gasLimit = gasLimit.mul(120).div(100); // 20% buffer
        } catch {
            gasLimit = 500000;
        }

        // Update price
        console.log(`⏫ Updating ${label} price to $${price.toFixed(2)}...`);
        const tx = await contract.updateAnswer(priceWithDecimals, { gasLimit });
        await tx.wait();
        console.log(`✅ ${label} price updated`);
    } catch (error) {
        console.error(`❌ Failed to update ${label} price:`, error);
    }
}

async function updateExchangePrices(
    exchange: ethers.Contract,
    volatilePrice: number,
    stablePrice: number
) {
    try {
        const volatilePrice8 = ethers.utils.parseUnits(volatilePrice.toFixed(8), 8);
        const stablePrice8 = ethers.utils.parseUnits(stablePrice.toFixed(8), 8);

        console.log("🔄 Updating Exchange prices...");

        // Update volatile price
        let tx = await exchange.updateVolatilePrice(volatilePrice8);
        await tx.wait();

        // Update stable price
        tx = await exchange.updateStablePrice(stablePrice8);
        await tx.wait();

        console.log("✅ Exchange prices updated");
    } catch (error) {
        console.error("❌ Failed to update Exchange prices:", error);
    }
}

async function updatePriceFeed() {
    try {
        console.log('🔄 Fetching current market data...');
        const marketData = await getOnBalanceVolume('ETH');
        const currentPrice = marketData.currentPrice;

        console.log(`📊 Current market price: $${currentPrice.toFixed(2)}`);
        console.log(`📈 24h change: ${marketData.priceChangePercent.toFixed(2)}%`);

        // Setup provider and signer
        const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        const signer = new ethers.Wallet(CONFIG.privateKeyKeeper, provider);

        // Check signer balance
        const balance = await signer.getBalance();
        console.log(`💰 Signer balance: ${ethers.utils.formatEther(balance)} ETH`);
        if (balance.lt(ethers.utils.parseEther("0.01"))) {
            throw new Error("Insufficient ETH for gas (balance < 0.01 ETH)");
        }

        // Create Exchange contract instance using the imported ABI
        const exchange = new ethers.Contract(
            CONFIG.exchangeAddress,
            ExchangeAbi, // Use the imported ABI directly
            signer
        );

        // Update volatile price feed
        if (CONFIG.volatileFeedAddress) {
            const volatileFeed = new ethers.Contract(
                CONFIG.volatileFeedAddress,
                MOCK_AGGREGATOR_ABI,
                signer
            );
            await updateContractPrice(volatileFeed, currentPrice, "Volatile Feed");
        } else {
            console.log("⏭️ Volatile feed address not set - skipping");
        }

        // Update stable price feed
        if (CONFIG.stableFeedAddress) {
            const stableFeed = new ethers.Contract(
                CONFIG.stableFeedAddress,
                MOCK_AGGREGATOR_ABI,
                signer
            );
            await updateContractPrice(stableFeed, 1.00, "Stable Feed");
        } else {
            console.log("⏭️ Stable feed address not set - skipping");
        }

        // Update Exchange contract prices
        await updateExchangePrices(exchange, currentPrice, 1.00);

        // Trigger upkeep check after price update
        await triggerPriceUpkeep(signer);

        return true;
    } catch (error) {
        console.error('❌ Price update failed:', error);
        return false;
    }
}

async function main() {
    console.log('🚀 Starting Price Synchronization Service');
    console.log(`⏱️ Will update every ${CONFIG.priceUpdateInterval / 60000} minutes`);

    // Verify configuration
    const requiredConfig = [
        'privateKeyKeeper', // PrivateKey#1 for testing purposes in production we dont need this script
        'rpcUrl',
        'volatileFeedAddress',
        'stableFeedAddress',
        'exchangeAddress'
    ];

    let validConfig = true;
    requiredConfig.forEach(key => {
        if (!CONFIG[key as keyof typeof CONFIG]) {
            console.error(`❌ Missing ${key} in config`);
            validConfig = false;
        }
    });

    if (!validConfig) {
        process.exit(1);
    }

    console.log(`🔗 Using RPC: ${CONFIG.rpcUrl}`);
    console.log(`📡 Volatile Feed: ${CONFIG.volatileFeedAddress}`);
    console.log(`📡 Stable Feed: ${CONFIG.stableFeedAddress}`);
    console.log(`🔄 Exchange Address: ${CONFIG.exchangeAddress}`);

    if (CONFIG.priceTriggerAddress) {
        console.log(`⚙️ Price Trigger Address: ${CONFIG.priceTriggerAddress}`);
    }

    // Initial update
    await updatePriceFeed();

    // Periodic updates
    setInterval(updatePriceFeed, CONFIG.priceUpdateInterval);

    // Keep process alive
    setInterval(() => {
        console.log('💤 Service is running...');
    }, 15 * 60 * 1000); // 15 min heartbeat
}

main().catch(console.error);