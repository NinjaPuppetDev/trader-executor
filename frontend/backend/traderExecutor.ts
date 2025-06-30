import { ethers } from 'ethers';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { lock } from 'proper-lockfile';
import WebSocket from 'isomorphic-ws';
import { TradeExecutionLog, TradingDecision } from './types';

// Define TradeStatus type if not already imported
type TradeStatus = 'invalid' | 'skipped' | 'executed';
import { allocatePort, releasePort, isPortAvailable } from './shared/portManager';
import { getLogger } from './shared/logger';

// ======================
// Configuration
// ======================
const CONFIG = {
    rpcUrl: 'http://127.0.0.1:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    defaultAmount: '10',
    slippagePercent: 1,
    minContractBalance: '10',
    maxTradeAmount: '0.04',
    processingDelay: 5000,
    minTradeAmount: '0.001',
    wsReconnectInterval: 5000,
    wsMaxRetries: 5,
    heartbeatInterval: 30000
};

// ======================
// File Paths
// ======================
const LOGS_DIR = path.join(__dirname, 'logs');
const PRICE_DETECTION_FILE = path.join(LOGS_DIR, 'price-detections.json');
const TRADE_EXECUTIONS_FILE = path.join(LOGS_DIR, 'executed-trades.json');
const PROCESSED_FILE = path.join(LOGS_DIR, 'processed-ids.json');

// ======================
// Global Declarations
// ======================
const logger = getLogger('trade-executor');
const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
let executorContract: ethers.Contract;
let wsClient: WebSocket | null = null;
let wsConnectionAttempts = 0;
let allocatedWsPort: number | null = null;

// ======================
// WebSocket Management
// ======================
async function setupWebSocketServer() {
    try {
        allocatedWsPort = await allocatePort('tradeExecutorWs');

        // Verify port availability at system level
        const isAvailable = await isPortAvailable(allocatedWsPort);
        if (!isAvailable) {
            throw new Error(`Port ${allocatedWsPort} is already in use at system level`);
        }

        const wss = new WebSocket.Server({ port: allocatedWsPort });
        logger.info(`📡 Trade Executor WebSocket server started on port ${allocatedWsPort}`);

        wss.on('connection', async (ws: WebSocket) => {
            logger.info('🔌 New client connected to Executed Trades WebSocket');

            // Setup heartbeat
            let isAlive = true;
            const heartbeatInterval = setInterval(() => {
                if (!isAlive) {
                    logger.warn('Terminating unresponsive client');
                    ws.terminate();
                    return;
                }

                isAlive = false;
                ws.ping();
            }, CONFIG.heartbeatInterval);

            ws.on('pong', () => {
                isAlive = true;
            });

            try {
                const content = await readFile(TRADE_EXECUTIONS_FILE, 'utf-8');
                const logs = content.trim() ? JSON.parse(content) : [];

                ws.send(JSON.stringify({
                    type: 'initialLogs',
                    data: logs.slice(0, 50)
                }));
            } catch (error) {
                logger.error('Error sending initial logs:', error);
            }

            ws.on('close', () => {
                logger.info('🔌 Client disconnected');
                clearInterval(heartbeatInterval);
            });
        });

        wss.on('error', (err: Error) => {
            if (err.message.includes('EADDRINUSE')) {
                logger.warn('Port conflict detected');
            } else {
                logger.error('WebSocket server error:', err);
            }
        });

        return wss;
    } catch (error) {
        logger.error('WebSocket server setup failed:', error);
        if (allocatedWsPort) {
            releasePort(allocatedWsPort);
        }
        throw error;
    }
}

function connectToWebSocketServer() {
    if (!allocatedWsPort) {
        logger.error('WebSocket port not allocated');
        return;
    }

    wsClient = new WebSocket(`ws://localhost:${allocatedWsPort}`);

    wsClient.on('open', () => {
        wsConnectionAttempts = 0;
        logger.info(`🔌 Connected to Trade Executor WebSocket server on port ${allocatedWsPort}`);
    });

    wsClient.on('error', (err: unknown) => {
        logger.error("WebSocket connection error", err);

        // Attempt reconnect with exponential backoff
        wsConnectionAttempts++;
        if (wsConnectionAttempts <= CONFIG.wsMaxRetries) {
            const delay = Math.min(
                CONFIG.wsReconnectInterval * Math.pow(1.5, wsConnectionAttempts),
                30000
            );
            logger.info(`♻️ Reconnecting in ${delay / 1000}s (attempt ${wsConnectionAttempts}/${CONFIG.wsMaxRetries})`);
            setTimeout(() => connectToWebSocketServer(), delay);
        } else {
            logger.error("❌ Maximum WebSocket connection attempts reached");
        }
    });

    wsClient.on('close', () => {
        logger.info("🔌 WebSocket connection closed");
        if (wsConnectionAttempts < CONFIG.wsMaxRetries) {
            setTimeout(() => connectToWebSocketServer(), CONFIG.wsReconnectInterval);
        }
    });
}

async function broadcastTradeUpdate(log: TradeExecutionLog) {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) {
        logger.warn("⚠️ WebSocket not connected, skipping broadcast");
        return;
    }

    try {
        const message = JSON.stringify({
            type: 'tradeUpdate',
            data: log
        });
        wsClient.send(message);
        logger.info(`📤 Broadcasted trade update for ${log.id}`);
    } catch (err) {
        logger.error("WebSocket send error", err);
    }
}

// ======================
// Core Functions
// ======================
async function logTradeExecution(entry: TradeExecutionLog) {
    return withFileLock(TRADE_EXECUTIONS_FILE, async (content) => {
        const logs: TradeExecutionLog[] = content.trim() ? JSON.parse(content) : [];
        logs.unshift(entry);
        await writeFile(TRADE_EXECUTIONS_FILE, JSON.stringify(logs, null, 2));
        await broadcastTradeUpdate(entry);
        return true;
    });
}

async function setupEnvironment() {
    try {
        if (!existsSync(LOGS_DIR)) {
            await mkdir(LOGS_DIR, { recursive: true });
        }

        const files = [
            { path: PRICE_DETECTION_FILE, default: '[]' },
            { path: TRADE_EXECUTIONS_FILE, default: '[]' },
            { path: PROCESSED_FILE, default: '[]' }
        ];

        for (const { path: filePath, default: defaultContent } of files) {
            if (!existsSync(filePath)) {
                await writeFile(filePath, defaultContent, 'utf-8');
            } else {
                try {
                    const content = await readFile(filePath, 'utf-8');
                    if (!content.trim()) await writeFile(filePath, defaultContent, 'utf-8');
                } catch {
                    await writeFile(filePath, defaultContent, 'utf-8');
                }
            }
        }

        executorContract = new ethers.Contract(
            CONFIG.executorAddress,
            [
                "function executeTrade(bool buyVolatile, uint256 amountIn, uint256 minAmountOut)",
                "function stableToken() view returns (address)",
                "function volatileToken() view returns (address)",
                "function exchange() view returns (address)"
            ],
            wallet
        );
    } catch (error) {
        logger.error('❌ Environment setup failed:', error);
        throw error;
    }
}

async function ensureContractFunds() {
    try {
        const stableAddress = await executorContract.stableToken();
        const volatileAddress = await executorContract.volatileToken();

        const stableToken = new ethers.Contract(
            stableAddress,
            ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256)", "function decimals() view returns (uint8)"],
            wallet
        );

        const volatileToken = new ethers.Contract(
            volatileAddress,
            ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256)", "function decimals() view returns (uint8)"],
            wallet
        );

        const [stableDecimals, volatileDecimals] = await Promise.all([
            stableToken.decimals(),
            volatileToken.decimals()
        ]);

        const minStable = ethers.utils.parseUnits(CONFIG.minContractBalance, stableDecimals);
        const minVolatile = ethers.utils.parseUnits(CONFIG.minContractBalance, volatileDecimals);

        const [stableBalance, volatileBalance] = await Promise.all([
            stableToken.balanceOf(CONFIG.executorAddress),
            volatileToken.balanceOf(CONFIG.executorAddress)
        ]);

        logger.info(`Stable balance: ${ethers.utils.formatUnits(stableBalance, stableDecimals)}`);
        logger.info(`Volatile balance: ${ethers.utils.formatUnits(volatileBalance, volatileDecimals)}`);

        // Fund stable token if needed
        if (stableBalance.lt(minStable)) {
            const transferAmount = minStable.sub(stableBalance);
            logger.info(`⚡ Transferring ${ethers.utils.formatUnits(transferAmount, stableDecimals)} stable tokens`);
            const tx = await stableToken.transfer(CONFIG.executorAddress, transferAmount);
            await tx.wait();
        }

        // Fund volatile token if needed
        if (volatileBalance.lt(minVolatile)) {
            const transferAmount = minVolatile.sub(volatileBalance);
            logger.info(`⚡ Transferring ${ethers.utils.formatUnits(transferAmount, volatileDecimals)} volatile tokens`);
            const tx = await volatileToken.transfer(CONFIG.executorAddress, transferAmount);
            await tx.wait();
        }

        logger.info('✅ Contract funds ensured');
    } catch (error) {
        logger.error('❌ Contract fund check failed:', error);
    }
}

function calculateMinAmountOut(
    expectedOutput: ethers.BigNumber,
    slippage: number = CONFIG.slippagePercent
): ethers.BigNumber {
    const slippageBasisPoints = Math.floor(slippage * 100);
    const factor = 10000 - slippageBasisPoints;
    return expectedOutput.mul(factor).div(10000);
}

function calculateOutputWithFees(
    amountIn: ethers.BigNumber,
    reserveIn: ethers.BigNumber,
    reserveOut: ethers.BigNumber
): ethers.BigNumber {
    const amountInWithFee = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
}

async function executeTrade(
    decision: TradingDecision,
    sourceLogId: string
) {
    if (!['buy', 'sell'].includes(decision.decision)) {
        throw new Error(`Invalid trading decision: ${decision.decision}`);
    }

    const stableAddress = await executorContract.stableToken();
    const volatileAddress = await executorContract.volatileToken();
    const exchangeAddress = await executorContract.exchange();

    const exchangeContract = new ethers.Contract(
        exchangeAddress,
        ['function getReserves() view returns (uint112, uint112)'],
        provider
    );

    const buyVolatile = decision.decision === 'buy';
    const tokenInAddress = buyVolatile ? stableAddress : volatileAddress;

    const tokenInContract = new ethers.Contract(
        tokenInAddress,
        [
            'function decimals() view returns (uint8)',
            'function balanceOf(address) view returns (uint256)',
            'function allowance(address,address) view returns (uint256)',
            'function approve(address,uint256) returns (bool)'
        ],
        wallet
    );

    const tokenInDecimals = await tokenInContract.decimals();
    const amountIn = ethers.utils.parseUnits(decision.amount, tokenInDecimals);

    // 1. Check token balance
    const balance = await tokenInContract.balanceOf(CONFIG.executorAddress);
    if (balance.lt(amountIn)) {
        throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(balance, tokenInDecimals)} < ${decision.amount}`);
    }

    // 2. Check and set allowance
    const allowance = await tokenInContract.allowance(CONFIG.executorAddress, exchangeAddress);
    if (allowance.lt(amountIn)) {
        logger.info('⚠️ Increasing allowance...');
        const approveTx = await tokenInContract.approve(exchangeAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
    }

    // 3. Get reserves and calculate expected output with fees
    const [reserve0, reserve1] = await exchangeContract.getReserves();
    const stableReserve = buyVolatile ? reserve0 : reserve1;
    const volatileReserve = buyVolatile ? reserve1 : reserve0;

    // Use fee-adjusted calculation
    const expectedOutput = buyVolatile
        ? calculateOutputWithFees(amountIn, stableReserve, volatileReserve)
        : calculateOutputWithFees(amountIn, volatileReserve, stableReserve);

    // 4. Price impact check (max 5%)
    const priceImpact = buyVolatile
        ? amountIn.div(stableReserve.add(amountIn))
        : amountIn.div(volatileReserve.add(amountIn));

    if (priceImpact.gt(ethers.utils.parseUnits('0.05', 18))) {
        throw new Error(`Price impact too high: ${ethers.utils.formatUnits(priceImpact.mul(100), 16)}%`);
    }

    // Dynamic slippage adjustment
    let slippage = decision.slippage || CONFIG.slippagePercent;
    let minAmountOut = calculateMinAmountOut(expectedOutput, slippage);
    let simulationSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!simulationSuccess && attempts < maxAttempts) {
        try {
            logger.info(`🔍 Simulating trade (attempt ${attempts + 1}) with slippage: ${slippage}%...`);

            // Get fresh reserves for each attempt
            const [newReserve0, newReserve1] = await exchangeContract.getReserves();
            const newStableReserve = buyVolatile ? newReserve0 : newReserve1;
            const newVolatileReserve = buyVolatile ? newReserve1 : newReserve0;

            const freshExpectedOutput = buyVolatile
                ? calculateOutputWithFees(amountIn, newStableReserve, newVolatileReserve)
                : calculateOutputWithFees(amountIn, newVolatileReserve, newStableReserve);

            minAmountOut = calculateMinAmountOut(freshExpectedOutput, slippage);

            // Estimate gas cost
            const gasEstimate = await executorContract.estimateGas.executeTrade(
                buyVolatile,
                amountIn,
                minAmountOut,
                { from: wallet.address }
            );

            // Add 20% buffer
            const gasLimit = gasEstimate.mul(120).div(100);

            await executorContract.callStatic.executeTrade(
                buyVolatile,
                amountIn,
                minAmountOut,
                { gasLimit }
            );
            simulationSuccess = true;
        } catch (simError) {
            attempts++;
            if (attempts >= maxAttempts) {
                let reason = 'Unknown error';
                if (typeof simError === 'object' && simError !== null) {
                    if ('reason' in simError) reason = (simError as any).reason;
                    else if ('message' in simError) reason = (simError as any).message;
                }
                throw new Error(`Trade simulation failed: ${reason}`);
            }

            // Increase slippage for next attempt
            slippage += 1;
            logger.warn(`⚠️ Simulation failed, increasing slippage to ${slippage}%`);
        }
    }

    // 5. Execute actual trade
    logger.info(`🏁 Executing trade with slippage: ${slippage}%`);
    const txResponse = await executorContract.executeTrade(
        buyVolatile,
        amountIn,
        minAmountOut,
        { gasLimit: 1500000 }
    );

    const receipt = await txResponse.wait();
    let actualAmountOut = '0';

    const tradeEvent = receipt.events?.find((e: any) => e.event === 'TradeExecuted');
    if (tradeEvent) {
        actualAmountOut = tradeEvent.args.amountOut.toString();
    }

    const tokenOutAddress = buyVolatile ? volatileAddress : stableAddress;
    const tokenOutContract = new ethers.Contract(
        tokenOutAddress,
        ['function decimals() view returns (uint8)'],
        provider
    );
    const tokenOutDecimals = await tokenOutContract.decimals();

    return {
        txHash: txResponse.hash,
        amountIn: amountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        actualAmountOut,
        gasUsed: receipt.gasUsed.toString(),
        tokenInDecimals,
        tokenOutDecimals
    };
}

// ======================
// Logging Utilities
// ======================
async function withFileLock<T>(filePath: string, operation: (content: string) => Promise<T>): Promise<T> {
    const release = await lock(filePath, { retries: 5 });
    try {
        const content = existsSync(filePath) ? await readFile(filePath, 'utf-8') : '';
        return await operation(content);
    } finally {
        await release();
    }
}

// ======================
// Decision Processing
// ======================
function validateTradeDecision(decision: TradingDecision): string | null {
    if (!['buy', 'sell', 'hold'].includes(decision.decision)) {
        return 'Invalid decision type';
    }

    if (decision.decision === 'hold') return null;

    const validTokens = [
        CONFIG.stableToken.toLowerCase(),
        CONFIG.volatileToken.toLowerCase()
    ];

    if (!validTokens.includes(decision.tokenIn.toLowerCase()) ||
        !validTokens.includes(decision.tokenOut.toLowerCase())) {
        return 'Invalid token addresses';
    }

    const amountNum = parseFloat(decision.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
        return 'Invalid trade amount';
    }

    // Minimum trade amount check
    if (amountNum < parseFloat(CONFIG.minTradeAmount)) {
        return `Amount too small (min ${CONFIG.minTradeAmount})`;
    }

    const maxAmount = parseFloat(CONFIG.maxTradeAmount);
    const confidence = decision.confidence || 'medium';
    const maxAllowed = confidence === 'high' ? maxAmount :
        confidence === 'medium' ? maxAmount * 0.75 :
            maxAmount * 0.5;

    if (amountNum > maxAllowed) {
        return `Amount exceeds ${maxAllowed} limit for ${confidence} confidence`;
    }

    return null;
}

function createFallbackDecision(error: string): TradingDecision {
    return {
        decision: 'hold',
        tokenIn: '',
        tokenOut: '',
        amount: '0',
        slippage: 0,
        reasoning: error || 'Fallback: Could not parse decision',
        confidence: 'low'
    };
}

// ======================
// Main Processing
// ======================
async function processLogs() {
    try {
        await ensureContractFunds();

        const priceDetectionLogs = await withFileLock<any[]>(
            PRICE_DETECTION_FILE,
            async (content) => content.trim() ? JSON.parse(content) : []
        );

        const processedIds = await withFileLock<string[]>(
            PROCESSED_FILE,
            async (content) => content.trim() ? JSON.parse(content) : []
        );

        const newLogs = priceDetectionLogs.filter(log =>
            !processedIds.includes(log.id) &&
            log.status === 'completed' &&
            log.decision
        );

        if (newLogs.length === 0) {
            logger.info('⏭️ No new logs to process');
            return;
        }

        logger.info(`🔍 Found ${newLogs.length} new logs to process`);

        for (const log of newLogs) {
            logger.info(`🔎 Processing log: ${log.id}`);
            let decision: TradingDecision | null = null;
            let tradeResult = null;
            let decisionStatus: TradeStatus = 'invalid';
            let errorMessage = '';

            try {
                // Try to parse the decision
                const parsedDecision: TradingDecision = JSON.parse(log.decision);
                const validationError = validateTradeDecision(parsedDecision);

                if (validationError) {
                    throw new Error(validationError);
                }

                decision = parsedDecision;

                if (parsedDecision.decision === 'hold') {
                    decisionStatus = 'skipped';
                    logger.info(`⏭️ Holding for log ${log.id}`);
                } else {
                    logger.info(`🏁 Executing trade: ${parsedDecision.decision} ${parsedDecision.amount}`);
                    tradeResult = await executeTrade(parsedDecision, log.id);
                    decisionStatus = 'executed';
                    logger.info(`✅ Trade executed for log ${log.id}`);
                }
            } catch (error) {
                // Enhanced error handling
                if (error instanceof Error) {
                    errorMessage = `${error.message}`;
                } else if (typeof error === 'string') {
                    errorMessage = error;
                } else if (error && typeof error === 'object' && 'reason' in error) {
                    errorMessage = typeof (error as any).reason === 'string' ?
                        (error as any).reason :
                        JSON.stringify((error as any).reason);
                } else {
                    errorMessage = JSON.stringify(error);
                }

                logger.error(`❌❌❌ CRITICAL ERROR processing log ${log.id}: ${errorMessage}`);

                // Create fallback decision if parsing failed
                if (!decision) {
                    decision = createFallbackDecision(errorMessage);
                }
            }

            const tradeLog: TradeExecutionLog = {
                source: 'trade-execution',
                id: `exec-${Date.now()}`,
                timestamp: new Date().toISOString(),
                sourceLogId: log.id,
                sourceType: 'price-detections',
                decision: decision!, // Now matches the type
                status: decisionStatus, // Use status directly
                createdAt: new Date().toISOString(),
                tokenIn: decision?.tokenIn || '',
                tokenOut: decision?.tokenOut || '',
                amount: decision?.amount || '0',
                tokenInDecimals: tradeResult?.tokenInDecimals || 0,
                tokenOutDecimals: tradeResult?.tokenOutDecimals || 0,
                amountIn: tradeResult?.amountIn || '0',
                minAmountOut: tradeResult?.minAmountOut || '0',
                actualAmountOut: tradeResult?.actualAmountOut || '0',
                txHash: tradeResult?.txHash,
                gasUsed: tradeResult?.gasUsed,
                error: errorMessage,
                type: 'trade-execution'
            };

            await logTradeExecution(tradeLog);
            processedIds.push(log.id);
        }

        await withFileLock(PROCESSED_FILE, async () => {
            await writeFile(PROCESSED_FILE, JSON.stringify(processedIds, null, 2));
        });

        logger.info(`✅ Processed ${newLogs.length} logs`);
    } catch (error) {
        logger.error('❌❌❌ Log processing failed:', error);
    }
}

// ======================
// Main Application
// ======================
async function main() {
    logger.info('🚀 Starting Trade Executor');
    await setupEnvironment();

    // Setup WebSocket server
    const wss = await setupWebSocketServer();
    connectToWebSocketServer();

    const code = await provider.getCode(CONFIG.executorAddress);
    if (code === '0x') {
        throw new Error(`❌ No contract at ${CONFIG.executorAddress}`);
    }

    // Initial processing
    await processLogs();

    // Periodic processing
    const interval = setInterval(async () => {
        logger.info('\n🔄 Periodic log check');
        await new Promise(resolve => setTimeout(resolve, CONFIG.processingDelay));
        await processLogs();
    }, 15000);

    process.on('SIGINT', async () => {
        clearInterval(interval);
        if (wsClient) {
            wsClient.close();
        }
        if (wss) {
            wss.close();
        }
        if (allocatedWsPort) {
            releasePort(allocatedWsPort);
        }
        logger.info('\n🛑 Trade executor stopped');
        process.exit(0);
    });
}

main().catch(err => {
    logger.error('Fatal error in trade executor:', err);
    process.exit(1);
});