import { mkdir, readFile, writeFile } from 'fs/promises';
import { ethers } from 'ethers';
import MagicTraderSenderABI from '../app/abis/MagicTraderSender.json';
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
    ccipMessageId?: string;
}

interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold' | 'wait';
}

// Configuration
const CONFIG = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    contractAddress: process.env.SENDER_CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    privateKey: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    assetTokenAddress: process.env.ASSET_TOKEN_ADDRESS || '0xYourAssetToken',
    linkTokenAddress: process.env.LINK_TOKEN_ADDRESS || '0xYourLinkToken',
    destChainSelector: process.env.DEST_CHAIN_SELECTOR || '16015286601757825753' // Base Sepolia
};

const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
const senderContract = new ethers.Contract(
    CONFIG.contractAddress,
    MagicTraderSenderABI,
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

async function executeCrossChainTrade(action: 'buy' | 'sell'): Promise<VeniceLog> {
    try {
        const actionValue = action === 'buy' ? 0 : 1; // Map to enum values

        // 1. Approve asset token
        const assetContract = new ethers.Contract(
            CONFIG.assetTokenAddress,
            ['function approve(address spender, uint256 amount) returns (bool)'],
            wallet
        );

        const tradingAmount = await senderContract.TRADING_AMOUNT();
        const approveTx = await assetContract.approve(
            CONFIG.contractAddress,
            tradingAmount
        );
        await approveTx.wait();
        console.log(`🔐 Approved ${ethers.utils.formatUnits(tradingAmount)} tokens for trading`);

        // 2. Execute cross-chain trade
        const tx = await senderContract.executeTrade(
            actionValue,
            { gasLimit: 500000 }
        );
        console.log(`📊 Cross-chain ${action} triggered: ${tx.hash}`);

        const receipt = await tx.wait();

        // Find TradeSent event
        const tradeSentEvent = receipt.events?.find(
            (e: any) => e.event === 'TradeSent'
        );

        if (!tradeSentEvent) {
            throw new Error('TradeSent event not found in transaction receipt');
        }

        const msgId = tradeSentEvent.args.msgId;
        console.log(`🔔 TradeSent: 
  Action: ${tradeSentEvent.args.action === 0 ? 'Buy' : 'Sell'}
  Executor: ${tradeSentEvent.args.executor}
  CCIP Message ID: ${msgId}`);

        // Return log with cross-chain details
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            prompt: `Execute ${action} trade`,
            decision: JSON.stringify({ decision: action }),
            decisionLength: action.length,
            status: 'completed',
            createdAt: new Date().toISOString(),
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            ccipMessageId: msgId
        };

    } catch (error: any) {
        console.error(`❌ Cross-chain trade execution failed:`, error);
        throw error;
    }
}

// Extract decision from the log's decision field
function extractDecision(decisionStr: string): TradingDecision | null {
    try {
        // Find the JSON part in the decision string
        const jsonStart = decisionStr.indexOf('{');
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

async function updateVeniceLog(newLog: VeniceLog) {
    try {
        const logsContent = await readFile(LOG_FILE, 'utf-8');
        const logs: VeniceLog[] = JSON.parse(logsContent);

        // Add new log at the beginning
        logs.unshift(newLog);

        await writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
        console.log(`📝 Updated Venice log with new trade execution`);
    } catch (error) {
        console.error('❌ Failed to update Venice log:', error);
    }
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
                try {
                    const tradeLog = await executeCrossChainTrade(decision);

                    // Update the original log with execution details
                    log.txHash = tradeLog.txHash;
                    log.blockNumber = tradeLog.blockNumber;
                    log.ccipMessageId = tradeLog.ccipMessageId;
                    log.status = 'completed';

                    // Add new execution log
                    await updateVeniceLog(tradeLog);
                } catch (error) {
                    log.status = 'failed';
                    console.error(`❌ Failed to execute trade for log ${log.id}`);
                }
            } else {
                console.log(`⏭️ Skipping trade for ${log.id}: ${decision}`);
            }

            processedIds.add(log.id);
            newProcessed = true;
        }

        if (newProcessed) {
            await saveProcessedIds(processedIds);
            // Update the main log file with modified logs
            await writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
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