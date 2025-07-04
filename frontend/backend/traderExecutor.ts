import { ethers } from 'ethers';
import { GraphQLClient, gql } from 'graphql-request';
import express from 'express';
import cors from 'cors';
import { DataSource } from 'typeorm';
import { getLogger } from './shared/logger';
import {
    PriceDetectionLog,
    TradeExecutionLog,
    ProcessedTrigger
} from '../backend/shared/entities';

// ======================
// Configuration
// ======================
const CONFIG = {
    rpcUrl: 'http://127.0.0.1:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    slippagePercent: 1,
    minContractBalance: '10',
    maxTradeAmount: '0.04',
    processingDelay: 5000,
    minTradeAmount: '0.001',
    graphqlEndpoint: 'http://localhost:4000/graphql',
    databasePath: 'data/trigger-system.db'
};

// ======================
// Database Setup
// ======================
const AppDataSource = new DataSource({
    type: "sqlite",
    database: CONFIG.databasePath,
    entities: [PriceDetectionLog, TradeExecutionLog, ProcessedTrigger],
    synchronize: true,
    logging: false
});

// ======================
// Global Declarations
// ======================
const logger = getLogger('trade-executor');
let provider: ethers.providers.JsonRpcProvider;
let wallet: ethers.Wallet;
let executorContract: ethers.Contract;
let graphQLClient: GraphQLClient;

// ======================
// GraphQL Integration
// ======================
async function logTradeToGraphQL(log: TradeExecutionLog) {
    const mutation = gql`
        mutation LogTrade($entry: TradeInput!) {
            logTrade(entry: $entry)
        }
    `;

    try {
        await graphQLClient.request(mutation, {
            entry: {
                id: log.id,  // Add this
                sourceLogId: log.sourceLogId,
                status: log.status,
                tokenIn: log.tokenIn,
                tokenOut: log.tokenOut,
                amount: log.amount,
                tokenInDecimals: log.tokenInDecimals,
                tokenOutDecimals: log.tokenOutDecimals,
                txHash: log.txHash,
                gasUsed: log.gasUsed,
                amountIn: log.amountIn,
                minAmountOut: log.minAmountOut,
                actualAmountOut: log.actualAmountOut,
                error: log.error
            }
        });
        logger.info(`📤 Logged trade to GraphQL: ${log.sourceLogId}`);
    } catch (error) {
        logger.error('GraphQL trade log error:', error);
    }
}

// ======================
// Core Functions
// ======================
async function initializeDatabase() {
    try {
        await AppDataSource.initialize();
        logger.info('✅ Database connected');
    } catch (error) {
        logger.error('❌ Database initialization failed', error);
        process.exit(1);
    }
}

async function setupEnvironment() {
    try {
        provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
        wallet = new ethers.Wallet(CONFIG.privateKey, provider);
        graphQLClient = new GraphQLClient(CONFIG.graphqlEndpoint);

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

        const code = await provider.getCode(CONFIG.executorAddress);
        if (code === '0x') {
            throw new Error(`❌ No contract at ${CONFIG.executorAddress}`);
        }

        logger.info('✅ Environment setup complete');
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

        if (stableBalance.lt(minStable)) {
            const transferAmount = minStable.sub(stableBalance);
            logger.info(`⚡ Transferring ${ethers.utils.formatUnits(transferAmount, stableDecimals)} stable tokens`);
            const tx = await stableToken.transfer(CONFIG.executorAddress, transferAmount);
            await tx.wait();
        }

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
    decision: any,
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

    const balance = await tokenInContract.balanceOf(CONFIG.executorAddress);
    if (balance.lt(amountIn)) {
        throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(balance, tokenInDecimals)} < ${decision.amount}`);
    }

    const allowance = await tokenInContract.allowance(CONFIG.executorAddress, exchangeAddress);
    if (allowance.lt(amountIn)) {
        logger.info('⚠️ Increasing allowance...');
        const approveTx = await tokenInContract.approve(exchangeAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
    }

    const [reserve0, reserve1] = await exchangeContract.getReserves();
    const stableReserve = buyVolatile ? reserve0 : reserve1;
    const volatileReserve = buyVolatile ? reserve1 : reserve0;

    const expectedOutput = buyVolatile
        ? calculateOutputWithFees(amountIn, stableReserve, volatileReserve)
        : calculateOutputWithFees(amountIn, volatileReserve, stableReserve);

    const priceImpact = buyVolatile
        ? amountIn.div(stableReserve.add(amountIn))
        : amountIn.div(volatileReserve.add(amountIn));

    if (priceImpact.gt(ethers.utils.parseUnits('0.05', 18))) {
        throw new Error(`Price impact too high: ${ethers.utils.formatUnits(priceImpact.mul(100), 16)}%`);
    }

    let slippage = decision.slippage || CONFIG.slippagePercent;
    let minAmountOut = calculateMinAmountOut(expectedOutput, slippage);
    let simulationSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!simulationSuccess && attempts < maxAttempts) {
        try {
            logger.info(`🔍 Simulating trade (attempt ${attempts + 1}) with slippage: ${slippage}%...`);

            const [newReserve0, newReserve1] = await exchangeContract.getReserves();
            const newStableReserve = buyVolatile ? newReserve0 : newReserve1;
            const newVolatileReserve = buyVolatile ? newReserve1 : newReserve0;

            const freshExpectedOutput = buyVolatile
                ? calculateOutputWithFees(amountIn, newStableReserve, newVolatileReserve)
                : calculateOutputWithFees(amountIn, newVolatileReserve, newStableReserve);

            minAmountOut = calculateMinAmountOut(freshExpectedOutput, slippage);

            const gasEstimate = await executorContract.estimateGas.executeTrade(
                buyVolatile,
                amountIn,
                minAmountOut,
                { from: wallet.address }
            );

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
            slippage += 1;
            logger.warn(`⚠️ Simulation failed, increasing slippage to ${slippage}%`);
        }
    }

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
// Decision Processing
// ======================
function validateTradeDecision(decision: any): string | null {
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

function createFallbackDecision(error: string): any {
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

        const priceDetectionLogRepo = AppDataSource.getRepository(PriceDetectionLog);
        const processedTriggerRepo = AppDataSource.getRepository(ProcessedTrigger);
        const tradeExecutionLogRepo = AppDataSource.getRepository(TradeExecutionLog);

        // Get unprocessed completed logs
        const unprocessedLogs = await priceDetectionLogRepo
            .createQueryBuilder('log')
            .leftJoin(
                ProcessedTrigger,
                'pt',
                'pt.id = :tradePrefix || log.id',
                { tradePrefix: 'trade-' }
            )
            .where('log.status = :status', { status: 'completed' })
            .andWhere('pt.id IS NULL')
            .getMany();

        if (unprocessedLogs.length === 0) {
            logger.info('⏭️ No new logs to process');
            return;
        }

        logger.info(`🔍 Found ${unprocessedLogs.length} new logs to process`);

        for (const log of unprocessedLogs) {
            logger.info(`🔎 Processing log: ${log.id}`);
            let decision: any = null;
            let tradeResult = null;
            let decisionStatus: string = 'invalid';
            let errorMessage = '';

            try {
                const parsedDecision = JSON.parse(log.decision ?? '{}');
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

                if (!decision) {
                    decision = createFallbackDecision(errorMessage);
                }
            }

            // Create and save trade execution log
            const tradeLog = new TradeExecutionLog();
            tradeLog.id = `exec-${Date.now()}`;
            tradeLog.timestamp = new Date().toISOString();
            tradeLog.createdAt = new Date().toISOString();
            tradeLog.sourceLogId = log.id;
            tradeLog.status = decisionStatus;
            tradeLog.tokenIn = decision.tokenIn || '';
            tradeLog.tokenOut = decision.tokenOut || '';
            tradeLog.amount = decision.amount || '0';
            tradeLog.tokenInDecimals = tradeResult?.tokenInDecimals || 0;
            tradeLog.tokenOutDecimals = tradeResult?.tokenOutDecimals || 0;
            tradeLog.amountIn = tradeResult?.amountIn || '0';
            tradeLog.minAmountOut = tradeResult?.minAmountOut || '0';
            tradeLog.actualAmountOut = tradeResult?.actualAmountOut || '0';
            tradeLog.txHash = tradeResult?.txHash || null;
            tradeLog.gasUsed = tradeResult?.gasUsed || null;
            tradeLog.error = errorMessage || null;

            // Stringify decision object to avoid constraint error
            tradeLog.decision = JSON.stringify(decision);

            try {
                await tradeExecutionLogRepo.save(tradeLog);
                logger.info(`📝 Saved trade execution log: ${tradeLog.id}`);
            } catch (saveError) {
                logger.error(`❌ Failed to save trade log: ${saveError}`);
                // Fallback to console logging if DB save fails
                console.error('Trade Log Data:', tradeLog);
            }

            // Log to GraphQL
            try {
                await logTradeToGraphQL(tradeLog);
            } catch (graphQLError) {
                logger.error(`❌ Failed to log trade to GraphQL: ${graphQLError}`);
            }

            // Mark as processed only if we have a valid trade result or hold decision
            if (decisionStatus === 'executed' || decisionStatus === 'skipped') {
                try {
                    const processed = new ProcessedTrigger();
                    processed.id = `trade-${log.id}`;
                    await processedTriggerRepo.save(processed);
                    logger.info(`✅ Marked log as processed: trade-${log.id}`);
                } catch (markError) {
                    logger.error(`❌ Failed to mark log as processed: ${markError}`);
                }
            } else {
                logger.warn(`⚠️ Not marking invalid log as processed: ${log.id}`);
            }
        }

        logger.info(`✅ Processed ${unprocessedLogs.length} logs`);
    } catch (error) {
        logger.error('❌❌❌ Log processing failed:', error);
    }
}

// ======================
// Health Server Setup
// ======================
async function startHealthServer() {
    const healthApp = express();
    healthApp.use(cors());

    healthApp.get('/health', async (_, res) => {
        const dbStatus = AppDataSource.isInitialized ? "connected" : "disconnected";
        const status = dbStatus === "connected" ? "ok" : "degraded";

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            status,
            services: ['trade-executor'],
            database: dbStatus
        });
    });

    const PORT = 3001;
    const server = healthApp.listen(PORT, () => {
        logger.info(`✅ Trade Executor health server running on port ${PORT}`);
    });

    return server;
}

// ======================
// Main Execution
// ======================
async function main() {
    logger.info('🚀 Starting Trade Executor');

    try {
        await initializeDatabase();
        await setupEnvironment();

        const healthServer = await startHealthServer();

        // Initial processing
        await new Promise(resolve => setTimeout(resolve, CONFIG.processingDelay));
        await processLogs();

        // Periodic processing
        const interval = setInterval(async () => {
            logger.info('\n🔄 Periodic log check');
            await processLogs();
        }, 15000);

        // Graceful shutdown
        process.on('SIGINT', async () => {
            clearInterval(interval);
            logger.info('\n🛑 Shutting down servers...');
            healthServer.close(() => {
                logger.info('🛑 Trade executor stopped');
                process.exit(0);
            });
        });
    } catch (err) {
        logger.error('Fatal error in trade executor:', err);
        process.exit(1);
    }
}

main();