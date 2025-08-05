import { ethers } from 'ethers';
import WebSocket from 'ws';
import { CONFIG } from './config';
import dotenv from 'dotenv';
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import ExchangeAbi from "../app/abis/Exchange.json";

dotenv.config();

// Default configuration values
const DEFAULT_CONFIG = {
    PRICE_CHANGE_THRESHOLD: 0.005,     // 0.5%
    PRICE_UPDATE_INTERVAL: 30 * 60 * 1000  // 30 minutes
};

// ABI for mock price feeds
const MOCK_AGGREGATOR_ABI = [
    {
        "inputs": [
            {"internalType": "int256", "name": "_newPrice", "type": "int256"}
        ],
        "name": "updateAnswer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

class PriceSyncService {
    private currentPrice = 0;
    private lastUpdateTime = 0;
    private lastUpdatedPrice = 0;
    private isProcessing = false;
    private ws: WebSocket | null = null;
    private priceCheckInterval: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.logConfiguration();
    }

    private getConfigValue<T>(key: string, defaultValue: T): T {
        return (CONFIG as any)[key] !== undefined ? (CONFIG as any)[key] : defaultValue;
    }

    private logConfiguration() {
        console.log(`🔗 RPC: ${CONFIG.rpcUrl}`);
        console.log(`📡 Volatile Feed: ${CONFIG.volatileFeedAddress}`);
        console.log(`📡 Stable Feed: ${CONFIG.stableFeedAddress}`);
        console.log(`🔄 Exchange: ${CONFIG.exchangeAddress}`);
        console.log(`🆔 Pair ID: ${CONFIG.pairId}`);
        console.log(`📈 Price Change Threshold: ${this.getConfigValue('priceChangeThreshold', DEFAULT_CONFIG.PRICE_CHANGE_THRESHOLD) * 100}%`);
        console.log(`⏱️ Update Interval: ${this.getConfigValue('priceUpdateInterval', DEFAULT_CONFIG.PRICE_UPDATE_INTERVAL) / 60000} min`);
        
        if (CONFIG.priceTriggerAddress) {
            console.log(`⚙️ Price Trigger: ${CONFIG.priceTriggerAddress}`);
        }
    }

    private async triggerPriceUpkeep(signer: ethers.Wallet) {
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
                console.log("⏳ Waiting for confirmation...");
                await tx.wait();
                console.log("✅ Upkeep performed");
            } else {
                console.log("⏭️ Upkeep not needed");
            }
        } catch (err) {
            console.error("❌ Upkeep check failed:", err);
        }
    }

    private async updateContractPrice(
        contract: ethers.Contract,
        price: number,
        label: string
    ) {
        try {
            const priceWithDecimals = ethers.utils.parseUnits(price.toFixed(8), 8);
            let gasLimit = ethers.BigNumber.from(500000); // Default fallback
            
            try {
                const estimatedGas = await contract.estimateGas.updateAnswer(priceWithDecimals);
                gasLimit = estimatedGas.mul(120).div(100); // 20% buffer
            } catch (e) {
                console.warn(`⚠️ Gas estimation failed for ${label}, using fallback`);
            }

            console.log(`⏫ Updating ${label} price to $${price.toFixed(2)}...`);
            const tx = await contract.updateAnswer(priceWithDecimals, { gasLimit });
            await tx.wait();
            console.log(`✅ ${label} price updated`);
        } catch (error) {
            console.error(`❌ Failed to update ${label} price:`, error);
            throw error;
        }
    }

    private async updateExchangePrices(exchange: ethers.Contract) {
        try {
            console.log(`🔄 Updating Exchange prices for pair ${CONFIG.pairId}...`);
            let gasEstimate = ethers.BigNumber.from(300000); // Default fallback
            
            try {
                gasEstimate = await exchange.estimateGas.updatePrice(CONFIG.pairId);
            } catch (e) {
                console.warn("⚠️ Price update gas estimation failed, using fallback");
            }

            const tx = await exchange.updatePrice(CONFIG.pairId, {
                gasLimit: gasEstimate.mul(120).div(100) // 20% buffer
            });
            await tx.wait();
            console.log("✅ Exchange prices updated");
        } catch (error) {
            console.error("❌ Failed to update Exchange prices:", error);
            throw error;
        }
    }

    private async updatePriceFeed() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
            const signer = new ethers.Wallet(CONFIG.privateKeyKeeper, provider);

            // Check signer balance
            const balance = await signer.getBalance();
            console.log(`💰 Signer balance: ${ethers.utils.formatEther(balance)} ETH`);
            if (balance.lt(ethers.utils.parseEther("0.01"))) {
                throw new Error("Insufficient ETH for gas (balance < 0.01 ETH)");
            }

            // Verify exchange contract
            const code = await provider.getCode(CONFIG.exchangeAddress);
            if (code === '0x') {
                throw new Error(`Exchange contract not deployed at ${CONFIG.exchangeAddress}`);
            }

            const exchange = new ethers.Contract(
                CONFIG.exchangeAddress,
                ExchangeAbi,
                signer
            );

            // Update feeds
            if (CONFIG.volatileFeedAddress) {
                const volatileFeed = new ethers.Contract(
                    CONFIG.volatileFeedAddress,
                    MOCK_AGGREGATOR_ABI,
                    signer
                );
                await this.updateContractPrice(volatileFeed, this.currentPrice, "Volatile Feed");
            }

            if (CONFIG.stableFeedAddress) {
                const stableFeed = new ethers.Contract(
                    CONFIG.stableFeedAddress,
                    MOCK_AGGREGATOR_ABI,
                    signer
                );
                await this.updateContractPrice(stableFeed, 1.00, "Stable Feed");
            }

            // Update exchange and trigger upkeep
            await this.updateExchangePrices(exchange);
            await this.triggerPriceUpkeep(signer);

            // Update tracking state
            this.lastUpdateTime = Date.now();
            this.lastUpdatedPrice = this.currentPrice;

            return true;
        } catch (error) {
            console.error('❌ Price update failed:', error);
            return false;
        } finally {
            this.isProcessing = false;
        }
    }

    private checkPriceConditions() {
        if (this.isProcessing) return;

        const priceChangeThreshold = this.getConfigValue(
            'priceChangeThreshold', 
            DEFAULT_CONFIG.PRICE_CHANGE_THRESHOLD
        );
        
        const updateInterval = this.getConfigValue(
            'priceUpdateInterval', 
            DEFAULT_CONFIG.PRICE_UPDATE_INTERVAL
        );
        
        const priceChange = this.lastUpdatedPrice > 0 ? 
            Math.abs((this.currentPrice - this.lastUpdatedPrice) / this.lastUpdatedPrice) : 0;
        
        const timeSinceUpdate = Date.now() - this.lastUpdateTime;
        
        const shouldUpdate = timeSinceUpdate >= updateInterval || 
                            priceChange >= priceChangeThreshold;
        
        if (shouldUpdate && this.lastUpdatedPrice !== 0) {
            console.log('🔄 Significant price change detected, updating contracts...');
            this.updatePriceFeed();
        }
    }

    private connectToBinance() {
        this.ws = new WebSocket('wss://stream.binance.com:9443/ws/ethusdt@trade');

        this.ws.on('open', () => {
            console.log('🔌 Connected to Binance WebSocket');
        });

        this.ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data.toString());
                // Update current price but don't trigger checks
                this.currentPrice = parseFloat(trade.p);
            } catch (err) {
                console.error('❌ Error processing WebSocket message:', err);
            }
        });

        this.ws.on('error', (err) => {
            console.error('❌ WebSocket error:', err);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 WebSocket closed: ${code} - ${reason.toString()}`);
            console.log('⏳ Reconnecting in 5 seconds...');
            setTimeout(() => this.connectToBinance(), 5000);
        });
    }

    private async initializePrice() {
        const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        const signer = new ethers.Wallet(CONFIG.privateKeyKeeper, provider);
        const exchange = new ethers.Contract(
            CONFIG.exchangeAddress, 
            ExchangeAbi, 
            signer
        );

        try {
            const initialPrice = await exchange.getPrice(CONFIG.pairId);
            this.lastUpdatedPrice = parseFloat(ethers.utils.formatUnits(initialPrice, 8));
            this.currentPrice = this.lastUpdatedPrice;
            console.log(`📊 Initial contract price: $${this.lastUpdatedPrice.toFixed(2)}`);
        } catch {
            this.lastUpdatedPrice = 2000;
            this.currentPrice = this.lastUpdatedPrice;
            console.log('⏭️ Using default initial price');
        }
    }

    private validateConfig() {
        const requiredKeys = [
            'privateKeyKeeper',
            'rpcUrl',
            'volatileFeedAddress',
            'stableFeedAddress',
            'exchangeAddress',
            'pairId'  
        ];

        requiredKeys.forEach(key => {
            if (!CONFIG[key as keyof typeof CONFIG]) {
                throw new Error(`Missing required config: ${key}`);
            }
        });
    }

    private startPriceMonitor() {
        // Start 60-second interval for price condition checks
        this.priceCheckInterval = setInterval(() => {
            console.log(`⏱️ Current ETH price: $${this.currentPrice.toFixed(2)}`);
            this.checkPriceConditions();
        }, 60 * 1000); // Check every minute
    }

    private startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            console.log('💓 Service heartbeat:', {
                currentPrice: this.currentPrice,
                lastUpdatedPrice: this.lastUpdatedPrice,
                lastUpdate: this.lastUpdateTime ? 
                    new Date(this.lastUpdateTime).toLocaleTimeString() : 'Never'
            });
        }, 5 * 60 * 1000); // 5 minutes
    }

    public async start() {
        console.log('🚀 Starting Real-time Price Synchronization Service');
        console.log('⚡ Using Binance WebSocket for ETH/USDT');
        console.log('⏱️ Price checks will run every 60 seconds');

        try {
            this.validateConfig();
            await this.initializePrice();
            this.connectToBinance();
            this.startPriceMonitor();
            this.startHeartbeat();
        } catch (error) {
            console.error('❌ Service initialization failed:', error);
            process.exit(1);
        }
    }

    public stop() {
        if (this.ws) this.ws.close();
        if (this.priceCheckInterval) clearInterval(this.priceCheckInterval);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        console.log('🛑 Service stopped');
    }
}

// Start the service
const service = new PriceSyncService();
service.start().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', () => {
    service.stop();
    process.exit();
});

process.on('SIGTERM', () => {
    service.stop();
    process.exit();
});