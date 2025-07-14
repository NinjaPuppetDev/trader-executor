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
// Updated Configuration
// ======================
const CONFIG = {
    rpcUrl: 'http://127.0.0.1:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    executorAddress: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    stableToken: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    volatileToken: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    exchangeAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    slippagePercent: 1,
    slippageIncrement: 1.5,
    maxSlippage: 10,
    minContractBalance: '10',
    maxTradeAmount: '0.04',
    processingDelay: 5000,
    minTradeAmount: '0.001',
    graphqlEndpoint: 'http://localhost:4000/graphql',
    databasePath: 'data/trigger-system.db',
    minStableLiquidity: '100',
    minVolatileLiquidity: '1',
    maxPriceImpact: '0.05'
};

// ======================
// ABI Definitions
// ======================
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256)",
    "function decimals() view returns (uint8)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
];

const EXCHANGE_ABI = require('../app/abis/Exchange.json');

const TRADE_EXECUTOR_ABI = require('../app/abis/TradeExecutor.json');

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
                id: log.id,
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
                error: log.error,
                decision: log.decision,
                pairId: log.pairId
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
            TRADE_EXECUTOR_ABI,
            wallet
        );

        // Verify contract exists
        const code = await provider.getCode(CONFIG.executorAddress);
        if (code === '0x') {
            throw new Error(`❌ No contract at ${CONFIG.executorAddress}`);
        }

        // Verify contract initialization
        try {
            await executorContract.verifyInitialization();
            logger.info('✅ Contract initialization verified');
        } catch (e) {
            let errorMessage = 'Unknown initialization error';
            if (e instanceof Error) {
                errorMessage = e.message;
            } else if (typeof e === 'string') {
                errorMessage = e;
            }
            throw new Error(`Contract initialization failed: ${errorMessage}`);
        }

        logger.info('✅ Environment setup complete');
    } catch (error) {
        // Handle the outer error similarly
        let errorMessage = 'Unknown environment setup error';
        if (error instanceof Error) {
            errorMessage = error.message;
        } else if (typeof error === 'string') {
            errorMessage = error;
        }
        logger.error('❌ Environment setup failed:', errorMessage);
        throw new Error(errorMessage);
    }
}

async function ensureContractFunds() {
    try {
        // Use auto-generated getters
        const stableAddress = await executorContract.getStableToken();
        const volatileAddress = await executorContract.getVolatileToken();
        const exchangeAddress = await executorContract.getExchange();

        const stableToken = new ethers.Contract(
            stableAddress,
            ERC20_ABI,
            wallet
        );

        const volatileToken = new ethers.Contract(
            volatileAddress,
            ERC20_ABI,
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

// ======================
// Robust Reserve Handling
// ======================
async function getReserves(): Promise<{
    stable: ethers.BigNumber,
    volatile: ethers.BigNumber
}> {
    // Use auto-generated getter
    const exchangeAddress = await executorContract.getExchange();
    const exchangeContract = new ethers.Contract(
        exchangeAddress,
        EXCHANGE_ABI,
        provider
    );

    try {
        // Try the standard getReserves call with new format
        const reserves = await exchangeContract.getReserves();
        return { stable: reserves[0], volatile: reserves[1] };
    } catch (error) {
        logger.warn('⚠️ Standard getReserves failed, using fallback method');

        try {
            // Fallback: Use individual reserve functions
            const [stableReserve, volatileReserve] = await Promise.all([
                exchangeContract.stableReserve(),
                exchangeContract.volatileReserve()
            ]);
            return { stable: stableReserve, volatile: volatileReserve };
        } catch (fallbackError) {
            logger.warn('⚠️ Reserve functions failed, using direct balances');

            // Final fallback: Get token balances directly
            const stableAddress = await executorContract.stableToken();
            const volatileAddress = await executorContract.getVolatileToken();

            const stableToken = new ethers.Contract(stableAddress, ERC20_ABI, provider);
            const volatileToken = new ethers.Contract(volatileAddress, ERC20_ABI, provider);

            const [stableReserve, volatileReserve] = await Promise.all([
                stableToken.balanceOf(exchangeAddress),
                volatileToken.balanceOf(exchangeAddress)
            ]);

            return { stable: stableReserve, volatile: volatileReserve };
        }
    }
}

async function checkLiquidity() {
    try {
        const reserves = await getReserves();
        const minStable = ethers.utils.parseUnits(CONFIG.minStableLiquidity, 6);
        const minVolatile = ethers.utils.parseUnits(CONFIG.minVolatileLiquidity, 18);

        logger.info(`💧 Exchange liquidity: ${ethers.utils.formatUnits(reserves.stable, 6)} stable, ${ethers.utils.formatUnits(reserves.volatile, 18)} volatile`);

        if (reserves.stable.lt(minStable)) {
            logger.warn('⚠️ Low stable liquidity in exchange');
        }
        if (reserves.volatile.lt(minVolatile)) {
            logger.warn('⚠️ Low volatile liquidity in exchange');
        }

        return reserves;
    } catch (error) {
        logger.error('Liquidity check failed:', error);
        return { stable: ethers.BigNumber.from(0), volatile: ethers.BigNumber.from(0) };
    }
}

async function simulateTrade(
    buyVolatile: boolean,
    amountIn: ethers.BigNumber,
    slippage: number
): Promise<{
    minAmountOut: ethers.BigNumber;
    priceImpact: number;
}> {
    const reserves = await getReserves();
    const stableReserve = reserves.stable;
    const volatileReserve = reserves.volatile;

    const expectedOutput = buyVolatile
        ? calculateOutputWithFees(amountIn, stableReserve, volatileReserve)
        : calculateOutputWithFees(amountIn, volatileReserve, stableReserve);

    const priceImpact = buyVolatile
        ? parseFloat(ethers.utils.formatUnits(amountIn.mul(100).div(stableReserve.add(amountIn)), 16))
        : parseFloat(ethers.utils.formatUnits(amountIn.mul(100).div(volatileReserve.add(amountIn)), 16));

    const minAmountOut = calculateMinAmountOut(expectedOutput, slippage);

    return {
        minAmountOut,
        priceImpact
    };
}

// ======================
// Enhanced Trade Execution
// ======================
async function executeTrade(
    decision: any,
    sourceLogId: string
) {
    if (!['buy', 'sell'].includes(decision.decision)) {
        throw new Error(`Invalid trading decision: ${decision.decision}`);
    }

    // Use auto-generated getters
    const stableAddress = await executorContract.stableToken();
    const volatileAddress = await executorContract.volatileToken();
    const exchangeAddress = await executorContract.exchange();

    const buyVolatile = decision.decision === 'buy';
    const tokenInAddress = buyVolatile ? stableAddress : volatileAddress;

    const tokenInContract = new ethers.Contract(
        tokenInAddress,
        ERC20_ABI,
        wallet
    );

    const tokenInDecimals = await tokenInContract.decimals();
    const amountIn = ethers.utils.parseUnits(decision.amount, tokenInDecimals);

    // Check executor balance
    const balance = await tokenInContract.balanceOf(CONFIG.executorAddress);
    if (balance.lt(amountIn)) {
        throw new Error(`Insufficient balance: ${ethers.utils.formatUnits(balance, tokenInDecimals)} < ${decision.amount}`);
    }

    // Check and update allowance
    const allowance = await tokenInContract.allowance(CONFIG.executorAddress, exchangeAddress);
    if (allowance.lt(amountIn)) {
        logger.info('⚠️ Increasing allowance...');
        const approveTx = await tokenInContract.approve(exchangeAddress, ethers.constants.MaxUint256);
        await approveTx.wait();
    }

    // Check liquidity before proceeding
    const liquidity = await checkLiquidity();

    let slippage = decision.slippage || CONFIG.slippagePercent;
    let minAmountOut = ethers.BigNumber.from(0);
    let attempts = 0;
    const maxAttempts = 3;
    let priceImpact = 0;
    let simulationSuccess = false;

    // Simulation loop with increasing slippage
    while (!simulationSuccess && attempts < maxAttempts) {
        try {
            logger.info(`🔍 Simulating trade (attempt ${attempts + 1}) with slippage: ${slippage}%...`);

            // Simulate trade with current slippage
            const simulation = await simulateTrade(
                buyVolatile,
                amountIn,
                slippage
            );

            minAmountOut = simulation.minAmountOut;
            priceImpact = simulation.priceImpact;

            // Check price impact
            const maxImpact = parseFloat(CONFIG.maxPriceImpact);
            if (priceImpact > maxImpact) {
                throw new Error(`Price impact too high: ${priceImpact.toFixed(2)}% (max ${maxImpact * 100}%)`);
            }

            // Check liquidity warning
            const outputValue = buyVolatile
                ? parseFloat(ethers.utils.formatUnits(minAmountOut, 18))
                : parseFloat(ethers.utils.formatUnits(minAmountOut, 6));

            const stableValue = parseFloat(ethers.utils.formatUnits(liquidity.stable, 6));
            if (outputValue > stableValue * 0.01) {
                logger.warn(`⚠️ Output amount (${outputValue}) exceeds 1% of stable reserves`);
            }

            // Estimate gas
            const gasEstimate = await executorContract.estimateGas.executeTrade(
                buyVolatile,
                amountIn,
                minAmountOut,
                { from: wallet.address }
            );

            const gasLimit = gasEstimate.mul(120).div(100);

            // Static call simulation
            await executorContract.callStatic.executeTrade(
                buyVolatile,
                amountIn,
                minAmountOut,
                { gasLimit }
            );

            simulationSuccess = true;
        } catch (simError: any) {
            attempts++;
            const errorMsg = simError.reason || simError.message || 'Unknown simulation error';

            if (attempts >= maxAttempts) {
                throw new Error(`Trade simulation failed: ${errorMsg}`);
            }

            // Increase slippage for next attempt
            slippage += CONFIG.slippageIncrement;
            if (slippage > CONFIG.maxSlippage) {
                throw new Error(`Slippage exceeded maximum allowed (${CONFIG.maxSlippage}%)`);
            }

            logger.warn(`⚠️ Simulation failed: ${errorMsg}. Increasing slippage to ${slippage}%`);
        }
    }

    if (!simulationSuccess) {
        throw new Error('Trade simulation failed after maximum attempts');
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
    let positionId = '';
    let entryPrice = '0';

    // Parse both events from receipt
    for (const event of receipt.events || []) {
        try {
            if (event.event === 'TradeExecuted') {
                actualAmountOut = event.args.amountOut.toString();
            }
            if (event.event === 'PositionOpened') {
                positionId = event.args.positionId;
                entryPrice = event.args.entryPrice.toString();
            }
        } catch (e) {
            logger.warn('⚠️ Error parsing event:', e);
        }
    }

    // Retrieve entry price if not captured in event
    if (!entryPrice && positionId) {
        try {
            entryPrice = (await executorContract.entryPrices(positionId)).toString();
        } catch (e) {
            logger.error('❌ Failed to retrieve entry price:', e);
        }
    }

    const tokenOutAddress = buyVolatile ? volatileAddress : stableAddress;
    const tokenOutContract = new ethers.Contract(
        tokenOutAddress,
        ERC20_ABI,
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
        tokenOutDecimals,
        priceImpact,
        positionId: positionId || null,
        entryPrice: entryPrice || null
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
// Updated Log Processing
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
            } catch (error: any) {
                errorMessage = error.reason || error.message || JSON.stringify(error);
                logger.error(`❌❌❌ CRITICAL ERROR processing log ${log.id}: ${errorMessage}`);

                if (!decision) {
                    decision = createFallbackDecision(errorMessage);
                }
            }

            // Create and save trade execution log
            const tradeLog = new TradeExecutionLog();
            tradeLog.id = `exec-${Date.now()}`;
            tradeLog.pairId = log.pairId;
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
            tradeLog.positionId = tradeResult?.positionId ?? null;
            tradeLog.entryPrice = tradeResult?.entryPrice || null;

            // Stringify decision object to avoid constraint error
            tradeLog.decision = JSON.stringify(decision);

            try {
                await tradeExecutionLogRepo.save(tradeLog);
                logger.info(`📝 Saved trade execution log: ${tradeLog.id}`);

                // Log to GraphQL
                try {
                    await logTradeToGraphQL(tradeLog);
                    logger.info(`📤 Logged trade to GraphQL: ${tradeLog.id}`);
                } catch (graphQLError) {
                    logger.error(`❌ Failed to log trade to GraphQL: ${graphQLError}`);
                }
            } catch (saveError) {
                logger.error(`❌ Failed to save trade log: ${saveError}`);
            }

            // Update original price detection log status (CRITICAL ADDITION)
            try {
                let newStatus = '';

                switch (decisionStatus) {
                    case 'executed':
                        newStatus = 'executed';
                        break;
                    case 'skipped':
                        newStatus = 'hold';
                        break;
                    default:
                        newStatus = 'failed';
                }

                await priceDetectionLogRepo.update(log.id, { status: newStatus });
                logger.info(`🔄 Updated price detection log status to: ${newStatus}`);

            } catch (updateError) {
                logger.error(`❌ Failed to update price detection log status: ${updateError}`);
            }

            // Mark as processed only if we have a valid trade result or hold decision
            if (decisionStatus === 'executed' || decisionStatus === 'skipped') {
                try {
                    const processed = new ProcessedTrigger();
                    processed.id = `trade-${log.id}`;
                    processed.pairId = log.pairId; // CRITICAL FIX: Add pairId propagation
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

    healthApp.get('/', (_, res) => {
        res.json({
            service: 'Trade Executor',
            version: '1.0',
            routes: ['/health']
        });
    });

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
            await checkLiquidity(); // Regular liquidity monitoring
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