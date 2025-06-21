import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getFearAndGreedIndex } from './utils/fgiService';

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

// Updated Configuration
const CONFIG = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',  // USDC (6 decimals)
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',  // MVT (18 decimals)
    defaultAmount: '10',  // Default trade amount
    slippagePercent: 1,   // Default slippage percentage
    maxGasPrice: ethers.utils.parseUnits('100', 'gwei').toString(),
    minContractBalance: '10'  // Minimum token balance in contract
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

// Ensure contract has sufficient funds
async function ensureContractFunds() {
    try {
        // Use standard ERC20 ABI to check balances
        const stableMock = require('../app/abis/MockStable.json');
        const stableTokenContract = new ethers.Contract(
            CONFIG.stableToken,
            stableMock,
            provider
        );

        const volatileMock = require('../app/abis/MockVolatile.json');

        const volatileTokenContract = new ethers.Contract(
            CONFIG.volatileToken,
            volatileMock,
            provider
        );

        const stableDecimals = await stableTokenContract.decimals();
        const volatileDecimals = await volatileTokenContract.decimals();

        const stableBalance = await stableTokenContract.balanceOf(CONFIG.executorAddress);
        const volatileBalance = await volatileTokenContract.balanceOf(CONFIG.executorAddress);

        // Format balances for display
        const formattedStableBalance = ethers.utils.formatUnits(stableBalance, stableDecimals);
        const formattedVolatileBalance = ethers.utils.formatUnits(volatileBalance, volatileDecimals);

        console.log(`💰 Contract Balances: 
  Stable: ${formattedStableBalance} (Min: ${CONFIG.minContractBalance})
  Volatile: ${formattedVolatileBalance} (Min: ${CONFIG.minContractBalance})`);

        // Transfer tokens if below threshold
        const transferToken = async (tokenAddress: string, amount: string, decimals: number) => {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function transfer(address,uint256) returns(bool)'],
                wallet
            );

            const amountWei = ethers.utils.parseUnits(amount, decimals);
            console.log(`⏳ Transferring ${amount} tokens to executor...`);
            const tx = await tokenContract.transfer(CONFIG.executorAddress, amountWei);
            await tx.wait();
            console.log(`✅ Transferred ${amount} tokens to executor. TX: ${tx.hash}`);
        };

        // Only transfer if below threshold
        const minStable = ethers.utils.parseUnits(CONFIG.minContractBalance, stableDecimals);
        if (stableBalance.lt(minStable)) {
            const transferAmount = (minStable.sub(stableBalance)).add(ethers.utils.parseUnits('10', stableDecimals));
            await transferToken(
                CONFIG.stableToken,
                ethers.utils.formatUnits(transferAmount, stableDecimals),
                stableDecimals
            );
        }

        // Only transfer if below threshold
        const minVolatile = ethers.utils.parseUnits(CONFIG.minContractBalance, volatileDecimals);
        if (volatileBalance.lt(minVolatile)) {
            const transferAmount = minVolatile.sub(volatileBalance).add(ethers.utils.parseUnits('10', volatileDecimals));
            await transferToken(
                CONFIG.volatileToken,
                ethers.utils.formatUnits(transferAmount, volatileDecimals),
                volatileDecimals
            );
        }
    } catch (error) {
        console.error('❌ Contract fund check failed:', error);
    }
}

async function simulateTrade(
    tokenIn: string,
    tokenOut: string,
    amountIn: ethers.BigNumber
): Promise<ethers.BigNumber> {
    try {
        // Get exchange address from executor
        const executorAbi = require('../app/abis/TradeExecutor.json');
        const ExchangeAbi = require('../app/abis/Exchange.json');
        const executor = new ethers.Contract(CONFIG.executorAddress, executorAbi, provider);
        const exchangeAddress = await executor.exchange();

        // Get quote from exchange
        const exchange = new ethers.Contract(exchangeAddress, ExchangeAbi, provider);
        const amountOut = await exchange.getQuote(tokenIn, tokenOut, amountIn);

        return amountOut;
    } catch (error) {
        console.error('❌ Trade simulation failed:', error);
        return ethers.BigNumber.from(0);
    }
}


// Calculate minAmountOut with slippage
function calculateMinAmountOut(amountOut: ethers.BigNumber, slippagePercent: number): ethers.BigNumber {
    const slippageFactor = 100 - slippagePercent;
    return amountOut.mul(slippageFactor).div(100);
}


// Updated executeOnChainTrade function
async function executeOnChainTrade(
    decision: TradingDecision,
    source: 'venice' | 'price-trigger',
    sourceLogId: string
): Promise<TradeExecutionLog> {
    try {
        // Validate decision
        if (!decision || !['buy', 'sell'].includes(decision.decision)) {
            throw new Error(`Invalid trading decision: ${decision?.decision}`);
        }

        // Load TradeExecutor ABI
        const executorAbi = require('../app/abis/TradeExecutor.json');

        const executor = new ethers.Contract(
            CONFIG.executorAddress,
            executorAbi,
            wallet
        );

        // Determine trade parameters
        const buyVolatile = decision.decision === 'buy';
        const tokenIn = buyVolatile ? CONFIG.stableToken : CONFIG.volatileToken;
        const tokenOut = buyVolatile ? CONFIG.volatileToken : CONFIG.stableToken;

        // Get token decimals
        const erc20Abi = ["function decimals() view returns (uint8)"];
        const tokenInContract = new ethers.Contract(tokenIn, erc20Abi, provider);
        const tokenOutContract = new ethers.Contract(tokenOut, erc20Abi, provider);
        const tokenInDecimals = await tokenInContract.decimals();
        const tokenOutDecimals = await tokenOutContract.decimals();

        // Validate and set amount
        let amount = decision.amount || CONFIG.defaultAmount;
        let amountNum = parseFloat(amount);
        if (isNaN(amountNum)) {
            console.warn(`⚠️ Invalid amount: ${amount}, using default`);
            amount = CONFIG.defaultAmount;
            amountNum = parseFloat(CONFIG.defaultAmount);
        }
        if (amountNum <= 0) {
            console.warn(`⚠️ Non-positive amount: ${amount}, using default`);
            amount = CONFIG.defaultAmount;
            amountNum = parseFloat(CONFIG.defaultAmount);
        }
        const amountIn = ethers.utils.parseUnits(amount, tokenInDecimals);

        // Simulate trade to get expected output
        const exchangeAddress = await executor.exchange();
        const exchangeAbi = require('../app/abis/Exchange.json');

        const exchange = new ethers.Contract(exchangeAddress, exchangeAbi, provider);
        const expectedAmountOut = await exchange.calculateTradeOutput(buyVolatile, amountIn);

        // Calculate minAmountOut with slippage
        const slippage = decision.slippage || CONFIG.slippagePercent;
        const minAmountOut = expectedAmountOut
            .mul(100 - slippage)
            .div(100);

        console.log(`⚡ Executing ${buyVolatile ? 'BUY' : 'SELL'} trade:`);
        console.log(`  From: ${tokenIn} (${amount} tokens)`);
        console.log(`  To:   ${tokenOut}`);
        console.log(`  Amount In: ${ethers.utils.formatUnits(amountIn, tokenInDecimals)} tokens`);
        console.log(`  Expected Out: ${ethers.utils.formatUnits(expectedAmountOut, tokenOutDecimals)} tokens`);
        console.log(`  Min Out: ${ethers.utils.formatUnits(minAmountOut, tokenOutDecimals)} tokens (slippage: ${slippage}%)`);

        // Execute trade
        console.log('🚀 Executing trade...');
        const tx = await executor.executeTrade(buyVolatile, amountIn, minAmountOut, {
            gasLimit: 300000,
            gasPrice: ethers.BigNumber.from(CONFIG.maxGasPrice)
        });

        const receipt = await tx.wait();
        console.log(`✅ Trade executed! TX hash: ${receipt.transactionHash}`);

        // Parse actual amount out from event
        let actualAmountOut = ethers.BigNumber.from(0);
        const tradeEvent = receipt.events?.find((e: any) => e.event === 'TradeExecuted');
        if (tradeEvent) {
            actualAmountOut = tradeEvent.args.amountOut;
            console.log(`🔄 Actual Output: ${ethers.utils.formatUnits(actualAmountOut, tokenOutDecimals)} tokens`);
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
            tokenIn: decision.tokenIn || (decision.decision === 'buy' ? CONFIG.stableToken : CONFIG.volatileToken),
            tokenOut: decision.tokenOut || (decision.decision === 'buy' ? CONFIG.volatileToken : CONFIG.stableToken),
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
        await ensureContractFunds();

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
                tokenIn: decision?.tokenIn || (decision?.decision === 'buy' ? CONFIG.volatileToken : CONFIG.stableToken) || '',
                tokenOut: decision?.tokenOut || (decision?.decision === 'buy' ? CONFIG.stableToken : CONFIG.volatileToken) || '',
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
                tokenIn: decision?.tokenIn || (decision?.decision === 'buy' ? CONFIG.volatileToken : CONFIG.stableToken) || '',
                tokenOut: decision?.tokenOut || (decision?.decision === 'buy' ? CONFIG.stableToken : CONFIG.volatileToken) || '',
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
function extractDecision(decisionStr: string, fgi: number): TradingDecision {
    // Handle empty or whitespace-only decisions
    if (!decisionStr || decisionStr.trim() === '') {
        console.warn('⚠️ Empty decision string, using fallback');
        return createFallbackDecision(fgi, "Empty decision content");
    }

    try {
        const cleanStr = decisionStr
            .replace(/[\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        let parsedDecision: any = null;

        // Attempt 1: Parse as pure JSON
        try {
            parsedDecision = JSON.parse(cleanStr);
            return enforceDecisionRules(parsedDecision, fgi);
        } catch (e) {
            // Not pure JSON, continue
        }

        // Attempt 2: Extract JSON from text
        try {
            const jsonStart = cleanStr.indexOf('{');
            const jsonEnd = cleanStr.lastIndexOf('}');

            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const jsonString = cleanStr.substring(jsonStart, jsonEnd + 1);
                parsedDecision = JSON.parse(jsonString);
                return enforceDecisionRules(parsedDecision, fgi);
            }
        } catch (e) {
            // Extraction failed, continue
        }

        // Attempt 3: Parse as key-value pairs
        try {
            const decisionMatch = cleanStr.match(/(?:"decision"|decision)\s*:\s*["']?(\w+)["']?/i);
            if (!decisionMatch) {
                throw new Error("No decision found in key-value pairs");
            }

            let decision = decisionMatch[1].toLowerCase() as 'buy' | 'sell' | 'hold' | 'wait';
            if (!['buy', 'sell', 'hold', 'wait'].includes(decision)) {
                throw new Error(`Invalid decision: ${decision}`);
            }

            const tokenInMatch = cleanStr.match(/(?:"tokenIn"|tokenIn)\s*:\s*["']?(\w+)["']?/i);
            const tokenOutMatch = cleanStr.match(/(?:"tokenOut"|tokenOut)\s*:\s*["']?(\w+)["']?/i);
            const amountMatch = cleanStr.match(/(?:"amount"|amount)\s*:\s*["']?([\d.]+)["']?/i);
            const slippageMatch = cleanStr.match(/(?:"slippage"|slippage)\s*:\s*(\d+)/i);

            return enforceDecisionRules({
                decision,
                tokenIn: tokenInMatch ? tokenInMatch[1] : undefined,
                tokenOut: tokenOutMatch ? tokenOutMatch[1] : undefined,
                amount: amountMatch ? amountMatch[1] : undefined,
                slippage: slippageMatch ? parseInt(slippageMatch[1]) : undefined
            }, fgi);
        } catch (e) {
            console.warn('Key-value parse error:', e instanceof Error ? e.message : e);
            return createFallbackDecision(fgi, "Key-value parse error");
        }

        // Final fallback if all parsing attempts fail
        console.warn('⚠️ All parsing attempts failed, using fallback');
        return createFallbackDecision(fgi, "All parsing methods failed");
    } catch (error) {
        console.error('❌ Decision extraction failed:', error);
        return createFallbackDecision(fgi, "Critical extraction error");
    }
}

// Enhanced enforceDecisionRules with robust validation
function enforceDecisionRules(parsed: any, fgi: number, isPriceTrigger: boolean = false): TradingDecision {
    // Validate basic structure
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid decision format: not an object');
    }

    // Validate decision type
    if (!parsed.decision || typeof parsed.decision !== 'string') {
        throw new Error('Missing or invalid decision property');
    }

    let decision = parsed.decision.toLowerCase() as 'buy' | 'sell' | 'hold' | 'wait';
    if (!['buy', 'sell', 'hold', 'wait'].includes(decision)) {
        throw new Error(`Invalid decision value: ${decision}`);
    }

    if (decision === 'wait' && !isPriceTrigger) {
        decision = fgi >= 50 ? 'sell' : 'buy';
        console.log(`⚠️ Overriding 'wait' decision to '${decision}' based on FGI ${fgi}`);
    }

    // Enforce valid token pairs
    const isBuy = decision === 'buy';
    const validTokens = [CONFIG.stableToken, CONFIG.volatileToken];

    let tokenIn = parsed.tokenIn;
    let tokenOut = parsed.tokenOut;

    if (!tokenIn || !validTokens.includes(tokenIn)) {
        tokenIn = isBuy ? CONFIG.stableToken : CONFIG.volatileToken;
    }

    if (!tokenOut || !validTokens.includes(tokenOut)) {
        tokenOut = isBuy ? CONFIG.volatileToken : CONFIG.stableToken;
    }

    // Validate amount - ensure it's positive
    let amount = parsed.amount || CONFIG.defaultAmount;
    if (typeof amount === 'number') {
        amount = amount.toString();
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
        console.warn(`⚠️ Invalid amount: ${amount}, using default`);
        amount = CONFIG.defaultAmount;
    } else if (amountNum <= 0) {
        console.warn(`⚠️ Non-positive amount: ${amount}, using default`);
        amount = CONFIG.defaultAmount;
    }

    // Validate slippage
    let slippage = parsed.slippage;
    if (typeof slippage === 'string') {
        slippage = parseFloat(slippage);
    }

    if (typeof slippage !== 'number' || isNaN(slippage)) {
        slippage = CONFIG.slippagePercent;
    } else {
        slippage = Math.max(0.1, Math.min(5, slippage)); // Clamp between 0.1-5%
        if (slippage !== parsed.slippage) {
            console.warn(`⚠️ Adjusted slippage: ${parsed.slippage}% → ${slippage}%`);
        }
    }

    return {
        decision,
        tokenIn,
        tokenOut,
        amount,
        slippage
    };
}

// Create fallback decision with increased amount
function createFallbackDecision(fgi: number, reason: string): TradingDecision {
    console.warn(`🛑 Using fallback decision: ${reason}`);
    const isSell = fgi >= 55;
    return {
        decision: isSell ? 'sell' : 'buy',
        tokenIn: isSell ? CONFIG.volatileToken : CONFIG.stableToken,
        tokenOut: isSell ? CONFIG.stableToken : CONFIG.volatileToken,
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

// Add this debug function to traderExecutor.ts
async function debugExchange() {
    const executorAbi = ["function exchange() view returns (address)"];
    const executor = new ethers.Contract(CONFIG.executorAddress, executorAbi, provider);
    const exchangeAddress = await executor.exchange();

    const exchangeAbi = [
        "function getNormalizedPrice() view returns (uint256)",
        "function stableReserve() view returns (uint256)",
        "function volatileReserve() view returns (uint256)",
        "function stableFeed() view returns (address)",
        "function volatileFeed() view returns (address)"
    ];

    const exchange = new ethers.Contract(exchangeAddress, exchangeAbi, provider);

    console.log("🛠️ Exchange Debug:");
    console.log(`  Address: ${exchangeAddress}`);
    console.log(`  Stable Reserve: ${await exchange.stableReserve()}`);
    console.log(`  Volatile Reserve: ${await exchange.volatileReserve()}`);
    console.log(`  Normalized Price: ${await exchange.getNormalizedPrice()}`);
    console.log(`  Stable Feed: ${await exchange.stableFeed()}`);
    console.log(`  Volatile Feed: ${await exchange.volatileFeed()}`);
}



// Main application function
async function main() {
    try {
        await setupEnvironment();

        // Initial token transfer to executor
        await ensureContractFunds();

        const balance = await wallet.getBalance();
        console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

        // Check if executor contract is deployed
        const code = await provider.getCode(CONFIG.executorAddress);
        if (code === '0x') {
            throw new Error(`❌ No contract deployed at ${CONFIG.executorAddress}`);
        }
        console.log(`✅ Contract verified at ${CONFIG.executorAddress}`);

        // Verify contract owner
        try {
            const executorAbi = require('../app/abis/TradeExecutor.json');
            const executor = new ethers.Contract(CONFIG.executorAddress, executorAbi, provider);
            const owner = await executor.owner();
            console.log(`🔒 Executor contract owner: ${owner}`);
            if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
                console.warn(`⚠️ Warning: Wallet is not the contract owner!`);
            }
        } catch (error) {
            console.error('❌ Failed to connect to executor contract:', error);
        }

        await processLogs();

        await debugExchange();

        const interval = setInterval(async () => {
            console.log('\n🔎 Checking for new trading decisions...');
            await processLogs();
        }, 15000);

        console.log('🚀 Trade executor started. Listening for decisions...');
        console.log('============================================================');
        console.log(`   Executor: ${CONFIG.executorAddress}`);
        console.log(`   Stable Token:  ${CONFIG.stableToken}`);
        console.log(`   Volatile Token:  ${CONFIG.volatileToken}`);
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