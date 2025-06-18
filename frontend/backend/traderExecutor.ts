// traderExecutor.ts
import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getFearAndGreedIndex } from './fgiService';

// Types
interface BaseLog {
    id: string;
    timestamp: string;
    decision: string;
    decisionLength: number;
    status: 'completed' | 'pending' | 'failed' | 'error';
    createdAt: string;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    fgi?: number;
}

interface VeniceLog extends BaseLog {
    source: 'venice';
    prompt: string;
}

interface PriceTriggerLog extends BaseLog {
    source: 'price-trigger';
    priceContext: string;
    spikePercent: number;
    fgi?: number;
    fgiClassification?: string;
}

interface TradeExecutionLog extends BaseLog {
    source: 'trade-execution';
    sourceLogId: string;
    sourceType: 'venice' | 'price-trigger';
    amountIn: string;
    tokenIn: string;
    tokenOut: string;
    minAmountOut: string;
    actualAmountOut?: string;
    gasUsed?: string;
    decisionStatus: 'executed' | 'skipped' | 'invalid';
}

type LogEntry = VeniceLog | PriceTriggerLog | TradeExecutionLog;

interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold' | 'wait';
    tokenIn?: string;
    tokenOut?: string;
    amount?: string;
    slippage?: number;
}

// Configuration
const CONFIG = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    tokenA: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    tokenB: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    routerAddress: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    defaultAmount: '1',
    slippagePercent: 1,
    poolFee: 3000,
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei').toString()
};

// File paths
const LOGS_DIR = path.join(__dirname, 'logs');
const VENICE_LOG_FILE = path.join(LOGS_DIR, 'venice-logs.json');
const PRICE_TRIGGER_LOG_FILE = path.join(LOGS_DIR, 'price-trigger-logs.json');
const TRADE_EXECUTIONS_FILE = path.join(LOGS_DIR, 'trade-executions.json');
const PROCESSED_FILE = path.join(LOGS_DIR, 'processed.json');

// Setup provider and wallet
const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(CONFIG.privateKey, provider);

// Initialize environment
async function setupEnvironment() {
    try {
        if (!existsSync(LOGS_DIR)) {
            await mkdir(LOGS_DIR, { recursive: true });
            console.log(`📁 Created logs directory at ${LOGS_DIR}`);
        }

        const files = [
            { path: VENICE_LOG_FILE, default: '[]' },
            { path: PRICE_TRIGGER_LOG_FILE, default: '[]' },
            { path: TRADE_EXECUTIONS_FILE, default: '[]' },
            { path: PROCESSED_FILE, default: '[]' }
        ];

        for (const file of files) {
            let shouldWrite = false;

            if (!existsSync(file.path)) {
                shouldWrite = true;
            } else {
                try {
                    const content = await readFile(file.path, 'utf-8');
                    JSON.parse(content);
                } catch (error) {
                    console.warn(`⚠️ ${path.basename(file.path)} is invalid, resetting...`);
                    shouldWrite = true;
                }
            }

            if (shouldWrite) {
                await writeFile(file.path, file.default, 'utf-8');
                console.log(`📄 Initialized ${path.basename(file.path)}`);
            }
        }

        console.log('✅ Environment setup complete');
    } catch (error) {
        console.error('❌ Environment setup failed:', error);
        throw error;
    }
}

// Save trade execution log
async function logTradeExecution(entry: TradeExecutionLog) {
    try {
        const logsContent = await readFile(TRADE_EXECUTIONS_FILE, 'utf-8');
        const logs: TradeExecutionLog[] = JSON.parse(logsContent);
        logs.unshift(entry);
        await writeFile(TRADE_EXECUTIONS_FILE, JSON.stringify(logs, null, 2));

        if (entry.decisionStatus === 'executed') {
            console.log(`💾 Saved executed trade: ${entry.id}`);
        } else if (entry.decisionStatus === 'skipped') {
            console.log(`💾 Saved skipped decision: ${entry.id}`);
        } else {
            console.log(`💾 Saved invalid decision: ${entry.id}`);
        }

        return true;
    } catch (error) {
        console.error('❌ Failed to log trade execution:', error);
        return false;
    }
}

// Execute trade on-chain
async function executeOnChainTrade(
    decision: TradingDecision,
    source: 'venice' | 'price-trigger',
    sourceLogId: string
): Promise<TradeExecutionLog> {
    try {
        if (!decision || !['buy', 'sell'].includes(decision.decision)) {
            throw new Error(`Invalid trading decision: ${decision?.decision}`);
        }

        const executorAbi = require('../app/abis/traderExecutor.json');
        const executor = new ethers.Contract(
            CONFIG.executorAddress,
            executorAbi,
            wallet
        );

        const isBuy = decision.decision === 'buy';
        const tokenIn = isBuy ? CONFIG.tokenB : CONFIG.tokenA;
        const tokenOut = isBuy ? CONFIG.tokenA : CONFIG.tokenB;

        let amount = decision.amount || CONFIG.defaultAmount;
        const amountNum = parseFloat(amount);

        if (isNaN(amountNum)) {
            console.warn(`⚠️ Invalid amount: ${amount}, using default: ${CONFIG.defaultAmount}`);
            amount = CONFIG.defaultAmount;
        } else if (amountNum <= 0) {
            throw new Error(`Amount must be positive: ${amount}`);
        }

        const amountIn = ethers.utils.parseUnits(amount, 18);

        const tokenContract = new ethers.Contract(
            tokenIn,
            [
                'function balanceOf(address) view returns (uint256)',
                'function approve(address,uint256) returns (bool)',
                'function allowance(address,address) view returns (uint256)'
            ],
            wallet
        );

        const contractBalance = await tokenContract.balanceOf(CONFIG.executorAddress);
        if (contractBalance.lt(amountIn)) {
            const formattedBalance = ethers.utils.formatUnits(contractBalance, 18);
            throw new Error(
                `Insufficient contract balance. Needed: ${amount}, Available: ${formattedBalance}`
            );
        }

        const slippage = decision.slippage || CONFIG.slippagePercent;
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        const baseRate = isBuy ? 0.01 : 100;
        const expectedOut = amountIn.mul(
            ethers.utils.parseUnits(baseRate.toString(), 18)
        ).div(ethers.utils.parseUnits('1', 18));

        const minAmountOut = expectedOut.mul(100 - slippage).div(100);

        console.log(`⚡ Executing ${isBuy ? 'BUY' : 'SELL'} trade:`);
        console.log(`  From: ${tokenIn} (${amount} tokens)`);
        console.log(`  To:   ${tokenOut}`);
        console.log(`  Min Output: ${ethers.utils.formatUnits(minAmountOut, 18)} tokens`);
        console.log(`  Contract Balance: ${ethers.utils.formatUnits(contractBalance, 18)} tokens`);

        const allowance = await tokenContract.allowance(wallet.address, CONFIG.executorAddress);
        if (allowance.lt(amountIn)) {
            console.log('⏳ Approving tokens...');
            const approveTx = await tokenContract.approve(CONFIG.executorAddress, amountIn);
            await approveTx.wait();
            console.log(`✅ Approved ${amount} tokens`);
        }

        console.log('🚀 Executing trade...');
        const tx = await executor.executeTrade(
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            CONFIG.poolFee,
            deadline,
            {
                gasLimit: 500000,
                gasPrice: ethers.BigNumber.from(CONFIG.maxGasPrice)
            }
        );

        const receipt = await tx.wait();
        console.log(`✅ Trade executed! TX hash: ${receipt.transactionHash}`);

        let actualAmountOut = ethers.BigNumber.from(0);
        const tradeEvent = receipt.events?.find((e: any) => e.event === 'TradeExecuted');
        if (tradeEvent) {
            actualAmountOut = tradeEvent.args.amountOut;
            console.log(`🔄 Actual Output: ${ethers.utils.formatUnits(actualAmountOut, 18)} tokens`);
        }

        const executionLog: TradeExecutionLog = {
            source: 'trade-execution',
            id: `exec-${Date.now()}`,
            timestamp: new Date().toISOString(),
            sourceLogId,
            sourceType: source,
            decision: JSON.stringify(decision),
            decisionLength: decision.decision.length,
            status: 'completed',
            createdAt: new Date().toISOString(),
            txHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            amountIn: amountIn.toString(),
            tokenIn,
            tokenOut,
            minAmountOut: minAmountOut.toString(),
            actualAmountOut: actualAmountOut.toString(),
            gasUsed: receipt.gasUsed.toString(),
            decisionStatus: 'executed'
        };

        await logTradeExecution(executionLog);
        return executionLog;

    } catch (error: any) {
        console.error(`❌ Trade execution failed:`, error);

        const executionLog: TradeExecutionLog = {
            source: 'trade-execution',
            id: `exec-${Date.now()}`,
            timestamp: new Date().toISOString(),
            sourceLogId,
            sourceType: source,
            decision: JSON.stringify(decision),
            decisionLength: decision.decision?.length || 0,
            status: 'failed',
            createdAt: new Date().toISOString(),
            error: error.message || 'Unknown error',
            amountIn: '0',
            tokenIn: decision.tokenIn || (decision.decision === 'buy' ? CONFIG.tokenB : CONFIG.tokenA),
            tokenOut: decision.tokenOut || (decision.decision === 'buy' ? CONFIG.tokenA : CONFIG.tokenB),
            minAmountOut: '0',
            decisionStatus: 'executed'
        };

        await logTradeExecution(executionLog);
        return executionLog;
    }
}

// Update log file with new entry
async function updateLogFile<T extends LogEntry>(filePath: string, log: T) {
    try {
        const logsContent = await readFile(filePath, 'utf-8');
        const logs: T[] = JSON.parse(logsContent);
        const index = logs.findIndex(l => l.id === log.id);

        if (index !== -1) {
            logs[index] = log;
            await writeFile(filePath, JSON.stringify(logs, null, 2));
            console.log(`📝 Updated ${path.basename(filePath)}: ${log.id}`);
            return true;
        }
    } catch (error) {
        console.error(`❌ Failed to update log file: ${path.basename(filePath)}`, error);
    }
    return false;
}

// Load logs with validation
async function loadLogsWithValidation<T extends LogEntry>(filePath: string): Promise<T[]> {
    try {
        const content = await readFile(filePath, 'utf-8');
        return JSON.parse(content) as T[];
    } catch (error) {
        console.error(`❌ Failed to load logs from ${path.basename(filePath)}:`, error);
        return [];
    }
}

// Get current FGI for decision enforcement
async function getCurrentFgi(): Promise<number> {
    try {
        const fgiData = await getFearAndGreedIndex();
        return fgiData.value;
    } catch (error) {
        console.error('❌ Failed to get current FGI, using default 50:', error);
        return 50;
    }
}

// Process logs from all sources
async function processLogs() {
    try {
        const veniceLogs = await loadLogsWithValidation<VeniceLog>(VENICE_LOG_FILE);
        const priceTriggerLogs = await loadLogsWithValidation<PriceTriggerLog>(PRICE_TRIGGER_LOG_FILE);

        let processedIds: Set<string> = new Set();
        try {
            const processedContent = await readFile(PROCESSED_FILE, 'utf-8');
            processedIds = new Set(JSON.parse(processedContent));
        } catch (error) {
            console.error('❌ Failed to parse processed file, initializing new one');
            await writeFile(PROCESSED_FILE, '[]', 'utf-8');
        }

        console.log(`🔍 Found ${veniceLogs.length} Venice logs, ${priceTriggerLogs.length} Price Trigger logs, ${processedIds.size} processed IDs`);

        let hasUpdates = false;
        let processedCount = 0;
        const currentFgi = await getCurrentFgi();

        // Process Venice logs
        for (const log of veniceLogs) {
            if (!log.id || processedIds.has(log.id)) continue;

            console.log(`🔎 Processing Venice log ${log.id} (status: ${log.status})`);

            if (log.status === 'failed' || log.status === 'error') {
                console.log(`⏩ Skipping - status is '${log.status}'`);
                processedIds.add(log.id);
                hasUpdates = true;
                processedCount++;
                continue;
            }

            console.log(`  Decision Content: ${truncateString(log.decision, 200)}`);

            let decision: TradingDecision | null = null;
            let decisionStatus: 'executed' | 'skipped' | 'invalid' = 'invalid';
            let skipReason = '';
            let executionLog: TradeExecutionLog | null = null;

            try {
                decision = extractDecision(log.decision, currentFgi);

                console.log(`  Parsed Decision: ${JSON.stringify(decision, null, 2)}`);

                if (!decision) {
                    skipReason = 'invalid decision format';
                    decisionStatus = 'invalid';
                } else if (decision.decision === 'hold') {
                    skipReason = 'hold decision';
                    decisionStatus = 'skipped';
                } else if (!decision.amount || parseFloat(decision.amount) <= 0) {
                    skipReason = `invalid amount: ${decision.amount}`;
                    decisionStatus = 'invalid';
                } else {
                    console.log(`🚀 Executing ${decision.decision} trade from Venice log ${log.id}`);
                    const tradeResult = await executeOnChainTrade(decision, 'venice', log.id);
                    decisionStatus = tradeResult.status === 'completed' ? 'executed' : 'invalid';

                    log.txHash = tradeResult.txHash;
                    log.blockNumber = tradeResult.blockNumber;
                    log.status = tradeResult.status;
                    if (tradeResult.error) log.error = tradeResult.error;

                    await updateLogFile(VENICE_LOG_FILE, log);
                    executionLog = tradeResult;
                }
            } catch (error) {
                console.error(`❌ Venice trade processing failed:`, error);
                skipReason = error instanceof Error ? error.message : 'Unknown error';
                decisionStatus = 'invalid';
            }

            const tradeLog: TradeExecutionLog = {
                source: 'trade-execution',
                id: `exec-${Date.now()}`,
                timestamp: new Date().toISOString(),
                sourceLogId: log.id,
                sourceType: 'venice',
                decision: JSON.stringify(decision || log.decision),
                decisionLength: decision ? decision.decision.length : log.decision.length,
                status: decisionStatus === 'executed' ? 'completed' : 'failed',
                createdAt: new Date().toISOString(),
                decisionStatus,
                amountIn: decision?.amount || '0',
                tokenIn: decision?.tokenIn || (decision?.decision === 'buy' ? CONFIG.tokenB : CONFIG.tokenA) || '',
                tokenOut: decision?.tokenOut || (decision?.decision === 'buy' ? CONFIG.tokenA : CONFIG.tokenB) || '',
                minAmountOut: '0',
                error: skipReason || undefined,
                txHash: executionLog?.txHash,
                blockNumber: executionLog?.blockNumber,
                actualAmountOut: executionLog?.actualAmountOut,
                gasUsed: executionLog?.gasUsed
            };

            await logTradeExecution(tradeLog);
            processedIds.add(log.id);
            hasUpdates = true;
            processedCount++;

            if (skipReason) {
                console.log(`⏩ Skipping - ${skipReason}`);
            }
        }

        // Process Price Trigger logs
        for (const log of priceTriggerLogs) {
            if (!log.id || processedIds.has(log.id)) continue;

            console.log(`🔎 Processing Price Trigger log ${log.id} (status: ${log.status})`);
            console.log(`  Spike: ${log.spikePercent}% | FGI: ${log.fgi || 'N/A'} (${log.fgiClassification || 'N/A'})`);

            if (log.status === 'failed' || log.status === 'error') {
                console.log(`⏩ Skipping - status is '${log.status}'`);
                processedIds.add(log.id);
                hasUpdates = true;
                processedCount++;
                continue;
            }

            console.log(`  Decision Content: ${truncateString(log.decision, 200)}`);

            let decision: TradingDecision | null = null;
            let decisionStatus: 'executed' | 'skipped' | 'invalid' = 'invalid';
            let skipReason = '';
            let executionLog: TradeExecutionLog | null = null;

            try {
                decision = extractDecision(log.decision, log.fgi || currentFgi);

                console.log(`  Parsed Decision: ${JSON.stringify(decision, null, 2)}`);

                if (!decision) {
                    skipReason = 'invalid decision format';
                    decisionStatus = 'invalid';
                } else if (decision.decision === 'hold') {
                    skipReason = 'hold decision';
                    decisionStatus = 'skipped';
                } else if (!decision.amount || parseFloat(decision.amount) <= 0) {
                    skipReason = `invalid amount: ${decision.amount}`;
                    decisionStatus = 'invalid';
                } else {
                    console.log(`🚀 Executing ${decision.decision} trade from Price Trigger log ${log.id}`);
                    const tradeResult = await executeOnChainTrade(decision, 'price-trigger', log.id);
                    decisionStatus = tradeResult.status === 'completed' ? 'executed' : 'invalid';

                    log.txHash = tradeResult.txHash;
                    log.blockNumber = tradeResult.blockNumber;
                    log.status = tradeResult.status;
                    if (tradeResult.error) log.error = tradeResult.error;

                    await updateLogFile(PRICE_TRIGGER_LOG_FILE, log);
                    executionLog = tradeResult;
                }
            } catch (error) {
                console.error(`❌ Price Trigger trade processing failed:`, error);
                skipReason = error instanceof Error ? error.message : 'Unknown error';
                decisionStatus = 'invalid';
            }

            const tradeLog: TradeExecutionLog = {
                source: 'trade-execution',
                id: `exec-${Date.now()}`,
                timestamp: new Date().toISOString(),
                sourceLogId: log.id,
                sourceType: 'price-trigger',
                decision: JSON.stringify(decision || log.decision),
                decisionLength: decision ? decision.decision.length : log.decision.length,
                status: decisionStatus === 'executed' ? 'completed' : 'failed',
                createdAt: new Date().toISOString(),
                decisionStatus,
                amountIn: decision?.amount || '0',
                tokenIn: decision?.tokenIn || (decision?.decision === 'buy' ? CONFIG.tokenB : CONFIG.tokenA) || '',
                tokenOut: decision?.tokenOut || (decision?.decision === 'buy' ? CONFIG.tokenA : CONFIG.tokenB) || '',
                minAmountOut: '0',
                error: skipReason || undefined,
                txHash: executionLog?.txHash,
                blockNumber: executionLog?.blockNumber,
                actualAmountOut: executionLog?.actualAmountOut,
                gasUsed: executionLog?.gasUsed
            };

            await logTradeExecution(tradeLog);
            processedIds.add(log.id);
            hasUpdates = true;
            processedCount++;

            if (skipReason) {
                console.log(`⏩ Skipping - ${skipReason}`);
            }
        }

        if (hasUpdates) {
            await writeFile(PROCESSED_FILE, JSON.stringify([...processedIds], null, 2));
            console.log(`✅ Processed ${processedCount} new logs`);
        } else {
            console.log('⏩ No new logs to process');
        }
    } catch (error) {
        console.error('❌ Log processing failed:', error);
    }
}

// Enhanced decision extraction with FGI enforcement
function extractDecision(decisionStr: string, fgi: number): TradingDecision | null {
    if (!decisionStr || decisionStr.trim() === '') return null;

    try {
        const cleanStr = decisionStr
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Try to parse as pure JSON
        try {
            const parsed = JSON.parse(cleanStr);
            return enforceDecisionRules(parsed, fgi);
        } catch (e) {
            // Not pure JSON, continue
        }

        // Try to extract JSON from text
        try {
            const jsonStart = cleanStr.indexOf('{');
            const jsonEnd = cleanStr.lastIndexOf('}');

            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const jsonString = cleanStr.substring(jsonStart, jsonEnd + 1);
                const parsed = JSON.parse(jsonString);
                return enforceDecisionRules(parsed, fgi);
            }
        } catch (e) {
            // Extraction failed, continue
        }

        // Try to parse as key-value pairs
        try {
            const decisionMatch = cleanStr.match(/["']?decision["']?\s*:\s*["']?(\w+)["']?/i);
            if (!decisionMatch) return createFallbackDecision(fgi, "No decision found");

            let decision = decisionMatch[1].toLowerCase();
            if (!['buy', 'sell', 'hold', 'wait'].includes(decision)) {
                return createFallbackDecision(fgi, `Invalid decision: ${decision}`);
            }

            const tokenInMatch = cleanStr.match(/["']?tokenIn["']?\s*:\s*["']?(\w+)["']?/i);
            const tokenOutMatch = cleanStr.match(/["']?tokenOut["']?\s*:\s*["']?(\w+)["']?/i);
            const amountMatch = cleanStr.match(/["']?amount["']?\s*:\s*["']?([\d.]+)["']?/i);
            const slippageMatch = cleanStr.match(/["']?slippage["']?\s*:\s*(\d+)/i);

            return enforceDecisionRules({
                decision,
                tokenIn: tokenInMatch ? tokenInMatch[1] : undefined,
                tokenOut: tokenOutMatch ? tokenOutMatch[1] : undefined,
                amount: amountMatch ? amountMatch[1] : undefined,
                slippage: slippageMatch ? parseInt(slippageMatch[1]) : undefined
            }, fgi);
        } catch (e) {
            console.warn('Decision parse error:', e instanceof Error ? e.message : e);
            return createFallbackDecision(fgi, "Parse error");
        }
    } catch (error) {
        console.error('❌ Decision extraction failed:', error);
        return createFallbackDecision(fgi, "Extraction error");
    }
}

// Enforce trading rules on decisions
function enforceDecisionRules(parsed: any, fgi: number): TradingDecision {
    // Override "wait" decisions based on FGI
    if (parsed.decision === 'wait') {
        parsed.decision = fgi >= 55 ? 'sell' : 'buy';
        console.log(`⚠️ Overriding 'wait' decision to '${parsed.decision}' based on FGI ${fgi}`);
    }

    // Enforce valid token pairs
    const isBuy = parsed.decision === 'buy';
    const validTokens = [CONFIG.tokenA, CONFIG.tokenB];

    if (!parsed.tokenIn || !validTokens.includes(parsed.tokenIn)) {
        parsed.tokenIn = isBuy ? CONFIG.tokenB : CONFIG.tokenA;
    }

    if (!parsed.tokenOut || !validTokens.includes(parsed.tokenOut)) {
        parsed.tokenOut = isBuy ? CONFIG.tokenA : CONFIG.tokenB;
    }

    // Validate amount
    if (!parsed.amount || parseFloat(parsed.amount) <= 0) {
        parsed.amount = CONFIG.defaultAmount;
    }

    // Validate slippage
    if (!parsed.slippage || parsed.slippage < 1 || parsed.slippage > 5) {
        parsed.slippage = CONFIG.slippagePercent;
    }

    return {
        decision: parsed.decision,
        tokenIn: parsed.tokenIn,
        tokenOut: parsed.tokenOut,
        amount: parsed.amount,
        slippage: parsed.slippage
    };
}

// Create fallback decision based on FGI
function createFallbackDecision(fgi: number, reason: string): TradingDecision {
    const isSell = fgi >= 55;
    return {
        decision: isSell ? 'sell' : 'buy',
        tokenIn: isSell ? CONFIG.tokenA : CONFIG.tokenB,
        tokenOut: isSell ? CONFIG.tokenB : CONFIG.tokenA,
        amount: CONFIG.defaultAmount,
        slippage: CONFIG.slippagePercent
    };
}

// Helper function to truncate long strings
function truncateString(str: string, maxLength: number): string {
    if (!str) return '""';
    if (str.length <= maxLength) return `"${str}"`;
    return `"${str.substring(0, maxLength)}..." (length: ${str.length})`;
}

// Check token balances in the wallet and contract
async function checkTokenBalances() {
    try {
        const tokenAContract = new ethers.Contract(
            CONFIG.tokenA,
            ['function balanceOf(address) view returns (uint256)'],
            wallet
        );

        const tokenBContract = new ethers.Contract(
            CONFIG.tokenB,
            ['function balanceOf(address) view returns (uint256)'],
            wallet
        );

        const executorABalance = await tokenAContract.balanceOf(CONFIG.executorAddress);
        const executorBBalance = await tokenBContract.balanceOf(CONFIG.executorAddress);
        const walletABalance = await tokenAContract.balanceOf(wallet.address);
        const walletBBalance = await tokenBContract.balanceOf(wallet.address);

        console.log('💰 Token Balances:');
        console.log(`  Executor TKNA: ${ethers.utils.formatUnits(executorABalance, 18)}`);
        console.log(`  Executor TKNB: ${ethers.utils.formatUnits(executorBBalance, 18)}`);
        console.log(`  Wallet TKNA:   ${ethers.utils.formatUnits(walletABalance, 18)}`);
        console.log(`  Wallet TKNB:   ${ethers.utils.formatUnits(walletBBalance, 18)}`);

        return {
            executor: {
                tokenA: executorABalance,
                tokenB: executorBBalance
            },
            wallet: {
                tokenA: walletABalance,
                tokenB: walletBBalance
            }
        };
    } catch (error) {
        console.error('❌ Failed to check token balances:', error);
        throw error;
    }
}

// Main application function
async function main() {
    try {
        await setupEnvironment();
        await checkTokenBalances();

        const balance = await wallet.getBalance();
        console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

        const code = await provider.getCode(CONFIG.executorAddress);
        if (code === '0x') {
            throw new Error(`❌ No contract deployed at ${CONFIG.executorAddress}`);
        }
        console.log(`✅ Contract verified at ${CONFIG.executorAddress}`);

        try {
            const executorAbi = require('../app/abis/traderExecutor.json');
            const executor = new ethers.Contract(
                CONFIG.executorAddress,
                executorAbi,
                provider
            );
            const owner = await executor.owner();
            console.log(`🔒 Executor contract owner: ${owner}`);
            if (owner !== wallet.address) {
                console.warn('⚠️ Warning: Wallet is not contract owner!');
            } else {
                console.log('🔐 Wallet is contract owner - authorized to execute trades');
            }
        } catch (error) {
            console.error('❌ Failed to connect to executor contract:', error);
        }

        await processLogs();

        const interval = setInterval(async () => {
            console.log('\n🔎 Checking for new trading decisions...');
            await processLogs();
        }, 15000);

        console.log('🚀 Trade executor started. Listening for decisions...');
        console.log('============================================================');
        console.log(`   Executor: ${CONFIG.executorAddress}`);
        console.log(`   Token A:  ${CONFIG.tokenA} (TKNA)`);
        console.log(`   Token B:  ${CONFIG.tokenB} (TKNB)`);
        console.log(`   Wallet:   ${wallet.address}`);
        console.log('============================================================');

        process.on('SIGINT', () => {
            clearInterval(interval);
            console.log('\n🛑 Trade executor stopped');
            process.exit(0);
        });
    } catch (error) {
        console.error('❌ Trade executor failed to start:', error);
        process.exit(1);
    }
}

// Start the application
main().catch(console.error);