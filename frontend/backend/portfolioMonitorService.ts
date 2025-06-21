// backend/portfolioMonitor.ts
import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { CONFIG } from './config';

interface PortfolioPosition {
    timestamp: string;
    stableBalance: number;
    volatileBalance: number;
    portfolioValueUSD: number;
    fgi: number;
    tradeId?: string;
    decisionQuality?: 'good' | 'neutral' | 'bad';
}

const LOGS_DIR = path.join(__dirname, 'logs');
const PORTFOLIO_LOG_FILE = path.join(LOGS_DIR, 'portfolio-logs.json');

const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);

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
        // Get balances
        const stableMock = require('../app/abis/MockStable.json');
        const stableContract = new ethers.Contract(
            CONFIG.stableToken,
            stableMock,
            provider
        );

        const volatileMock = require('../app/abis/MockVolatile.json');
        const volatileContract = new ethers.Contract(
            CONFIG.volatileToken,
            volatileMock,
            provider
        );

        const stableBalance = await stableContract.balanceOf(CONFIG.executorAddress);
        const volatileBalance = await volatileContract.balanceOf(CONFIG.executorAddress);

        // Get portfolio value from Exchange
        const executorAbi = require('../app/abis/TradeExecutor.json');
        const executor = new ethers.Contract(CONFIG.executorAddress, executorAbi, provider);
        const exchangeAddress = await executor.exchange();

        const exchangeAbi = require('../app/abis/Exchange.json');
        const exchange = new ethers.Contract(exchangeAddress, exchangeAbi, provider);
        const portfolioValue = await exchange.getPortfolioValue();

        return {
            stableBalance: parseFloat(ethers.utils.formatUnits(stableBalance, 6)),
            volatileBalance: parseFloat(ethers.utils.formatUnits(volatileBalance, 18)),
            portfolioValueUSD: parseFloat(ethers.utils.formatUnits(portfolioValue, 18)),
            fgi: 50 // Will be updated later
        };
    } catch (error) {
        console.error('❌ Failed to get portfolio value:', error);
        return {
            stableBalance: 0,
            volatileBalance: 0,
            portfolioValueUSD: 0,
            fgi: 50
        };
    }
}

async function getFearAndGreedIndex(): Promise<number> {
    try {
        // In a real implementation, you would call an external service
        return 54; // Default value for simulation
    } catch (error) {
        return 50; // Neutral value
    }
}

async function logPortfolioPosition() {
    try {
        const portfolioData = await getPortfolioValue();
        const fgi = await getFearAndGreedIndex();

        const position: PortfolioPosition = {
            ...portfolioData,
            fgi,
            timestamp: new Date().toISOString()
        };

        const logsContent = await readFile(PORTFOLIO_LOG_FILE, 'utf-8');
        const logs: PortfolioPosition[] = JSON.parse(logsContent);
        logs.push(position);
        await writeFile(PORTFOLIO_LOG_FILE, JSON.stringify(logs, null, 2));

        console.log(`📊 Portfolio logged: $${position.portfolioValueUSD.toFixed(2)}`);
    } catch (error) {
        console.error('❌ Failed to log portfolio position:', error);
    }
}

async function main() {
    await setupEnvironment();

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
}

main().catch(console.error);