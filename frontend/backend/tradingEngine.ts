import { mkdir, readFile, writeFile } from 'fs/promises';
import { ethers } from 'ethers';
import MockTrader from '../app/abis/MockTrader.json';
import path from "path";
import { existsSync } from 'fs';

interface VeniceLog {
    id: string;
    timestamp: string;
    prompt: string;
    decision: string;
    decisionLength: number;
    status: 'completed' | 'pending' | 'failed' | 'error';
    createdAt: string;
    txHash?: string;
    blockNumber?: number;
}

interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold' | 'wait';
}

// Configuration
const CONFIG = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    contractAddress: process.env.TRADING_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    privateKey: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
const traderContract = new ethers.Contract(
    CONFIG.contractAddress,
    MockTrader,
    wallet
);

// Configure paths
const LOGS_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'venice-logs.json');
const PROCESSED_FILE = path.join(LOGS_DIR, 'processed.json');

// Ensure logs directory exists
async function ensureLogsDirectory() {
    if (!existsSync(LOGS_DIR)) {
        await mkdir(LOGS_DIR, { recursive: true });
        await writeFile(LOG_FILE, '[]', 'utf-8');
        await writeFile(PROCESSED_FILE, '[]', 'utf-8');
        console.log(`📁 Created logs directory and empty files`);
    }
}

async function executeTrade(action: 'buy' | 'sell'): Promise<ethers.providers.TransactionReceipt> {
    try {
        const actionValue = action === 'buy' ? 0 : 1; // Map to enum values

        const tx = await traderContract.executeTrade(
            actionValue,
            { gasLimit: 500000 }
        );

        console.log(`📊 Trade ${action} triggered: ${tx.hash}`);
        const receipt = await tx.wait();

        // Parse actual TradeExecuted event
        const event = receipt.events?.find((e: any) => e.event === 'TradeExecuted');
        if (event) {
            console.log(`🔔 TradeExecuted: 
        Action: ${event.args.action} 
        Executor: ${event.args.executor}
        Timestamp: ${new Date(event.args.timestamp * 1000).toISOString()}`);
        }

        return receipt;
    } catch (error) {
        console.error(`❌ Trade execution failed:`, error);
        throw error;
    }
}

// Extract decision from the log's decision field
function extractDecision(decisionStr: string): TradingDecision | null {
    try {
        // Find the JSON part in the decision string
        const jsonStart = decisionStr.lastIndexOf('{');
        const jsonEnd = decisionStr.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
            return null;
        }

        const jsonStr = decisionStr.substring(jsonStart, jsonEnd + 1);
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('❌ Failed to parse decision:', error);
        return null;
    }
}

// Track processed IDs to avoid duplicates
async function getProcessedIds(): Promise<Set<string>> {
    try {
        const content = await readFile(PROCESSED_FILE, 'utf-8');
        const ids = JSON.parse(content) as string[];
        return new Set(ids);
    } catch {
        return new Set();
    }
}

async function saveProcessedIds(ids: Set<string>) {
    await writeFile(PROCESSED_FILE, JSON.stringify([...ids], null, 2));
}

// Process decisions from logs
export async function processDecisions() {
    await ensureLogsDirectory();

    try {
        const logsContent = await readFile(LOG_FILE, 'utf-8');
        const logs: VeniceLog[] = JSON.parse(logsContent);
        const processedIds = await getProcessedIds();
        let newProcessed = false;

        for (const log of logs) {
            if (log.status !== 'completed' || processedIds.has(log.id)) {
                continue;
            }

            const decisionObj = extractDecision(log.decision);
            if (!decisionObj) {
                console.log(`⏭️ Skipping log ${log.id}: No valid decision found`);
                processedIds.add(log.id);
                newProcessed = true;
                continue;
            }

            const { decision } = decisionObj;
            console.log(`🔍 Processing log ${log.id}: ${decision}`);

            if (decision === 'buy' || decision === 'sell') {
                await executeTrade(decision);
            } else {
                console.log(`⏭️ Skipping trade for ${log.id}: ${decision}`);
            }

            processedIds.add(log.id);
            newProcessed = true;
        }

        if (newProcessed) {
            await saveProcessedIds(processedIds);
            console.log('✅ Processed new trading decisions');
        } else {
            console.log('✅ No new decisions to process');
        }
    } catch (error) {
        console.error('❌ Failed to process decisions:', error);
    }
}

// Run as cron job
setInterval(processDecisions, 30000);