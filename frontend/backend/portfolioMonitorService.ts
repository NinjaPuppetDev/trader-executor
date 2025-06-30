import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { CONFIG } from './config';
import dotenv from 'dotenv';

dotenv.config();

interface PortfolioPosition {
    timestamp: string;
    stableBalance: number;
    volatileBalance: number;
    portfolioValueUSD: number;
    isPriceStale: boolean;
    tradeId?: string;
    decisionQuality?: 'good' | 'neutral' | 'bad';
}

const LOGS_DIR = path.join(__dirname, 'logs');
const PORTFOLIO_LOG_FILE = path.join(LOGS_DIR, 'portfolio-logs.json');

const provider = new ethers.providers.JsonRpcProvider({
    url: CONFIG.rpcUrl,
    timeout: 30000,
    throttleLimit: 1
}, {
    chainId: CONFIG.chainId,
    name: CONFIG.networkName
});

// Constants matching Exchange contract
const FEED_DECIMALS = 8;

async function setupEnvironment() {
    if (!existsSync(LOGS_DIR)) {
        await mkdir(LOGS_DIR, { recursive: true });
    }

    if (!existsSync(PORTFOLIO_LOG_FILE)) {
        await writeFile(PORTFOLIO_LOG_FILE, '[]', 'utf-8');
    }
}

async function getPortfolioValue(): Promise<Omit<PortfolioPosition, 'timestamp'>> {
    try {
        console.log(`🔗 Connecting to network: ${CONFIG.networkName} (Chain ID: ${CONFIG.chainId})`);
        console.log(`🔄 Using RPC: ${CONFIG.rpcUrl}`);

        // Load ABIs
        const executorAbi = JSON.parse(await readFile(path.join(__dirname, '../app/abis/TradeExecutor.json'), 'utf-8'));
        const mockStableAbi = JSON.parse(await readFile(path.join(__dirname, '../app/abis/MockStable.json'), 'utf-8'));
        const mockVolatileAbi = JSON.parse(await readFile(path.join(__dirname, '../app/abis/MockVolatile.json'), 'utf-8'));
        const exchangeAbi = JSON.parse(await readFile(path.join(__dirname, '../app/abis/Exchange.json'), 'utf-8'));

        // Create contracts
        const executor = new ethers.Contract(CONFIG.executorAddress, executorAbi, provider);
        const stableContract = new ethers.Contract(CONFIG.stableToken, mockStableAbi, provider);
        const volatileContract = new ethers.Contract(CONFIG.volatileToken, mockVolatileAbi, provider);

        // Get token addresses from executor
        const exchangeAddress = await executor.exchange();
        const exchange = new ethers.Contract(exchangeAddress, exchangeAbi, provider);

        // Get balances
        const stableBalance = await stableContract.balanceOf(CONFIG.executorAddress);
        const volatileBalance = await volatileContract.balanceOf(CONFIG.executorAddress);

        // Get token decimals
        const stableDecimals = await stableContract.decimals();
        const volatileDecimals = await volatileContract.decimals();

        console.log(`📊 Balances fetched - Stable: ${ethers.utils.formatUnits(stableBalance, stableDecimals)}, Volatile: ${ethers.utils.formatUnits(volatileBalance, volatileDecimals)}`);

        // Get price data from Exchange
        const [currentStablePrice, currentVolatilePrice, lastPriceUpdate, maxDataAge] = await Promise.all([
            exchange.currentStablePrice(),
            exchange.currentVolatilePrice(),
            exchange.lastPriceUpdate(),
            exchange.MAX_DATA_AGE()
        ]);

        // Check price staleness
        const now = Math.floor(Date.now() / 1000);
        const isPriceStale = (now - lastPriceUpdate.toNumber()) > maxDataAge.toNumber();
        console.log(`📡 Price staleness: ${isPriceStale ? 'Stale' : 'Fresh'} | Last update: ${lastPriceUpdate.toString()}`);

        let portfolioValueUSD = 0;

        if (!isPriceStale) {
            // Calculate portfolio value using oracle prices (method from Exchange contract)
            const scaledStablePrice = currentStablePrice.mul(10 ** (18 - FEED_DECIMALS));
            const scaledVolatilePrice = currentVolatilePrice.mul(10 ** (18 - FEED_DECIMALS));

            const stableValue = stableBalance
                .mul(10 ** (18 - stableDecimals))
                .mul(scaledStablePrice);

            const volatileValue = volatileBalance
                .mul(scaledVolatilePrice);

            const totalValue = stableValue.add(volatileValue).div(ethers.constants.WeiPerEther);
            portfolioValueUSD = parseFloat(ethers.utils.formatUnits(totalValue, 18));
        } else {
            // Fallback to reserve-based pricing
            const reserveBasedPrice = await exchange.getReserveBasedPrice();

            if (reserveBasedPrice.isZero()) {
                console.log('⚠️  Reserve-based price is zero, using stable balance only');
                portfolioValueUSD = parseFloat(ethers.utils.formatUnits(stableBalance, stableDecimals));
            } else {
                const volatileValue = volatileBalance
                    .mul(reserveBasedPrice)
                    .div(ethers.constants.WeiPerEther);

                portfolioValueUSD =
                    parseFloat(ethers.utils.formatUnits(stableBalance, stableDecimals)) +
                    parseFloat(ethers.utils.formatUnits(volatileValue, stableDecimals));
            }
        }

        return {
            stableBalance: parseFloat(ethers.utils.formatUnits(stableBalance, stableDecimals)),
            volatileBalance: parseFloat(ethers.utils.formatUnits(volatileBalance, volatileDecimals)),
            portfolioValueUSD,
            isPriceStale
        };
    } catch (error) {
        console.error('❌ Failed to get portfolio value:', error);
        return {
            stableBalance: 0,
            volatileBalance: 0,
            portfolioValueUSD: 0,
            isPriceStale: true
        };
    }
}

async function logPortfolioPosition() {
    try {
        const portfolioData = await getPortfolioValue();

        const position: PortfolioPosition = {
            ...portfolioData,
            timestamp: new Date().toISOString()
        };

        const logsContent = await readFile(PORTFOLIO_LOG_FILE, 'utf-8');
        const logs: PortfolioPosition[] = JSON.parse(logsContent);
        logs.push(position);
        await writeFile(PORTFOLIO_LOG_FILE, JSON.stringify(logs, null, 2));

        console.log(`📊 Portfolio logged: $${position.portfolioValueUSD.toFixed(2)} | Stale: ${position.isPriceStale}`);
    } catch (error) {
        console.error('❌ Failed to log portfolio position:', error);
    }
}

async function main() {
    try {
        await setupEnvironment();

        // Verify connection
        const network = await provider.getNetwork();
        console.log(`✅ Connected to: ${network.name} (Chain ID: ${network.chainId})`);
        console.log(`🔄 Block number: ${await provider.getBlockNumber()}`);

        // Initial log
        await logPortfolioPosition();

        // Periodic logging
        const interval = setInterval(async () => {
            await logPortfolioPosition();
        }, 15 * 60 * 1000); // Every 15 minutes

        console.log('📈 Portfolio monitor started');

        process.on('SIGINT', () => {
            clearInterval(interval);
            console.log('\n🛑 Portfolio monitor stopped');
            process.exit(0);
        });
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        process.exit(1);
    }
}

main().catch(console.error);