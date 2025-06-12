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
    contractAddress: process.env.SENDER_CONTRACT_ADDRESS || '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    privateKey: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    assetTokenAddress: process.env.ASSET_TOKEN_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    linkTokenAddress: process.env.LINK_TOKEN_ADDRESS || '0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e',
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

// Fund sender with link tokens
async function ensureLinkBalance() {
    const linkTokenContract = new ethers.Contract(
        CONFIG.linkTokenAddress,
        [
            'function transfer(address to, uint256 amount) returns (bool)',
            'function balanceOf(address account) view returns (uint256)'
        ],
        wallet
    );

    const requiredBalance = ethers.utils.parseUnits("20", 18); // 20 LINK
    const currentBalance = await linkTokenContract.balanceOf(wallet.address);

    if (currentBalance.lt(requiredBalance)) {
        // Get the simulator address (first account in Anvil)
        const simulatorAddress = "0x9f1ac54BEF0DD2f6f3462EA0fa94fC62300d3a8e";

        // Impersonate the simulator account
        await provider.send("anvil_impersonateAccount", [simulatorAddress]);
        const simulatorSigner = provider.getSigner(simulatorAddress);

        // Transfer LINK from simulator to our wallet
        const linkTokenSimulator = linkTokenContract.connect(simulatorSigner);
        const transferTx = await linkTokenSimulator.transfer(wallet.address, requiredBalance);
        await transferTx.wait();

        // Stop impersonating
        await provider.send("anvil_stopImpersonatingAccount", [simulatorAddress]);

        console.log(`💸 Transferred 20 LINK to wallet: ${wallet.address}`);
    }
}

async function executeCrossChainTrade(action: 'buy' | 'sell'): Promise<VeniceLog> {
    try {
        // Ensure wallet has LINK tokens
        await ensureLinkBalance();

        const actionValue = action === 'buy' ? 0 : 1; // Map to enum values

        // 1. Get trading amount from contract
        const tradingAmount = await senderContract.TRADING_AMOUNT();
        console.log(`🔢 Trading amount: ${ethers.utils.formatUnits(tradingAmount)} tokens`);

        // 2. Approve asset token using config address
        const assetContract = new ethers.Contract(
            CONFIG.assetTokenAddress,
            [
                'function approve(address spender, uint256 amount) returns (bool)',
                'function allowance(address owner, address spender) view returns (uint256)'
            ],
            wallet
        );

        // Check current allowance
        const currentAllowance = await assetContract.allowance(wallet.address, CONFIG.contractAddress);
        console.log(`ℹ️ Current allowance: ${ethers.utils.formatUnits(currentAllowance)} tokens`);

        if (currentAllowance.lt(tradingAmount)) {
            console.log(`🔐 Approving ${ethers.utils.formatUnits(tradingAmount)} tokens for trading...`);
            const approveTx = await assetContract.approve(CONFIG.contractAddress, tradingAmount);
            await approveTx.wait();
            console.log(`✅ Approval confirmed in tx: ${approveTx.hash}`);

            // Verify new allowance
            const newAllowance = await assetContract.allowance(wallet.address, CONFIG.contractAddress);
            console.log(`ℹ️ New allowance: ${ethers.utils.formatUnits(newAllowance)} tokens`);
        } else {
            console.log(`👍 Sufficient allowance already exists: ${ethers.utils.formatUnits(currentAllowance)} tokens`);
        }

        // 3. Fund contract with LINK
        const linkTokenContract = new ethers.Contract(
            CONFIG.linkTokenAddress,
            [
                'function transfer(address to, uint256 amount) returns (bool)',
                'function balanceOf(address account) view returns (uint256)'
            ],
            wallet
        );

        const linkAmount = ethers.utils.parseUnits("10", 18);
        const senderLinkBalance = await linkTokenContract.balanceOf(CONFIG.contractAddress);

        if (senderLinkBalance.lt(linkAmount)) {
            console.log(`💸 Funding sender contract with 10 LINK...`);
            const fundTx = await linkTokenContract.transfer(CONFIG.contractAddress, linkAmount);
            await fundTx.wait();
            console.log(`✅ Sent 10 LINK to sender contract: ${fundTx.hash}`);

            const newBalance = await linkTokenContract.balanceOf(CONFIG.contractAddress);
            console.log(`ℹ️ New LINK balance: ${ethers.utils.formatUnits(newBalance)}`);
        } else {
            console.log(`👍 Sufficient LINK balance: ${ethers.utils.formatUnits(senderLinkBalance)}`);
        }

        // 4. Debug contract configuration
        console.log(`ℹ️ Contract Configuration:`);
        console.log(`  Sender: ${CONFIG.contractAddress}`);
        console.log(`  Receiver: ${await senderContract.receiver()}`);
        console.log(`  Router: ${await senderContract.router()}`);
        console.log(`  Dest Chain: ${await senderContract.destChain()}`);
        console.log(`  Link Token: ${await senderContract.linkToken()}`);

        // 5. Execute trade with only action parameter
        console.log(`🚀 Triggering cross-chain ${action} trade...`);
        const tx = await senderContract.executeTrade(
            actionValue,
            {
                gasLimit: 2_000_000,
                gasPrice: ethers.utils.parseUnits("10", "gwei")
            }
        );
        console.log(`📊 Cross-chain ${action} triggered: ${tx.hash}`);

        // 6. Wait for transaction
        const receipt = await tx.wait(2);
        console.log(`✅ Transaction mined in block: ${receipt.blockNumber}`);

        // 7. Handle TradeSent event
        const tradeSentEvent = receipt.events?.find(
            (e: any) => e.event === 'TradeSent'
        );

        if (!tradeSentEvent) {
            console.log(`⚠️ TradeSent event not found. All events:`, receipt.events);
            throw new Error('TradeSent event not found');
        }

        const msgId = tradeSentEvent.args.msgId;
        console.log(`🔔 TradeSent: 
  Action: ${tradeSentEvent.args.action === 0 ? 'Buy' : 'Sell'}
  Executor: ${tradeSentEvent.args.executor}
  CCIP Message ID: ${msgId}`);

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

        if (error.transactionHash) {
            console.error(`🔍 Try debugging with: cast receipt ${error.transactionHash} --rpc-url ${CONFIG.rpcUrl}`);
        }

        throw error;
    }
}

// Ownership management functions
async function transferOwnership(newOwner: string) {
    const tx = await senderContract.transferOwnership(newOwner);
    await tx.wait();
    console.log(`🔄 Ownership transfer initiated to ${newOwner}`);
}

async function acceptOwnership() {
    const tx = await senderContract.acceptOwnership();
    await tx.wait();
    console.log(`✅ Ownership accepted`);
}

// Withdraw LINK from contract
async function withdrawLink(amount: ethers.BigNumber) {
    const tx = await senderContract.withdrawLink(amount);
    await tx.wait();
    console.log(`💸 Withdrew ${ethers.utils.formatUnits(amount)} LINK from contract`);
}

// Extract decision from the log's decision field
function extractDecision(decisionStr: string): TradingDecision | null {
    try {
        const directParse = JSON.parse(decisionStr);
        if (directParse.decision && ['buy', 'sell', 'hold', 'wait'].includes(directParse.decision)) {
            return directParse;
        }
    } catch (e) {
        const jsonMatch = decisionStr.match(/\{[^{}]*\}(?![\s\S]*\{)/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.decision && ['buy', 'sell', 'hold', 'wait'].includes(parsed.decision)) {
                    return parsed;
                }
            } catch (parseError) {
                console.error('❌ JSON parse error:', parseError);
            }
        }
    }
    console.log('⚠️ No valid decision found in:', decisionStr);
    return null;
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

                    // Update original log with execution details
                    log.txHash = tradeLog.txHash;
                    log.blockNumber = tradeLog.blockNumber;
                    log.ccipMessageId = tradeLog.ccipMessageId;
                    log.status = 'completed';

                    // Add new execution log
                    await updateVeniceLog(tradeLog);
                } catch (error) {
                    log.status = 'failed';
                    console.error(`❌ Failed to execute trade for log ${log.id}:`, error);
                }
            } else {
                console.log(`⏭️ Skipping trade for ${log.id}: ${decision}`);
            }

            processedIds.add(log.id);
            newProcessed = true;
        }

        if (newProcessed) {
            await saveProcessedIds(processedIds);
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