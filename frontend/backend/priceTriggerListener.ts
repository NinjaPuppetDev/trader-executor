// backend/priceTriggerListener.ts
import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import dotenv from "dotenv";
import { PromptService } from "./prompts/promptService";
import { getFearAndGreedIndex } from "./utils/fgiService";
import { GraphQLClient, gql } from 'graphql-request';
import express from "express";
import cors from 'cors';
import "reflect-metadata";
import {
    PriceDetectionLog,
    ApiDebugLog
} from "../backend/shared/entities";
import { AppDataSource } from "../backend/shared/database";
import { TradingDecision, BayesianRegressionResult } from "./types";
import ExchangeAbi from "../app/abis/Exchange.json";
import { MarketDataCollector } from "./utils/marketDataCollector";


dotenv.config();

// ======================
// Configuration
// ======================
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const STABLE_TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const VOLATILE_TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const STABLE_TOKEN_CHECKSUM = ethers.utils.getAddress(STABLE_TOKEN);
const VOLATILE_TOKEN_CHECKSUM = ethers.utils.getAddress(VOLATILE_TOKEN);

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    EXCHANGE_ADDRESS: process.env.EXCHANGE_ADDRESS || "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    DEBUG: true,
    GRAPHQL_ENDPOINT: process.env.GRAPHQL_ENDPOINT || "http://localhost:4000/graphql",
    EVENT_COOLDOWN: 30000, // 30 seconds
    PAIR_ID: process.env.PAIR_ID || "1",
    TRADING_PAIR: process.env.TRADING_PAIR || "ethusdt",
};

// ======================
// Price Trigger Listener
// ======================
export class PriceTriggerListener {
    private provider: ethers.providers.JsonRpcProvider;
    private priceTriggerContract: ethers.Contract;
    private graphQLClient: GraphQLClient;
    private isProcessing: boolean = false;
    private lastEventTime: number = 0;
    private exchangeContract: ethers.Contract;
    private marketDataCollector: MarketDataCollector;
    private promptService: PromptService;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.priceTriggerContract = new ethers.Contract(
            CONFIG.PRICE_TRIGGER_ADDRESS,
            PriceTriggerAbi,
            this.provider
        );

        this.exchangeContract = new ethers.Contract(
            CONFIG.EXCHANGE_ADDRESS,
            ExchangeAbi,
            this.provider
        );

        this.graphQLClient = new GraphQLClient(CONFIG.GRAPHQL_ENDPOINT);
        this.marketDataCollector = new MarketDataCollector(CONFIG.TRADING_PAIR);
        this.promptService = new PromptService(
            this.marketDataCollector,
            STABLE_TOKEN_CHECKSUM,
            VOLATILE_TOKEN_CHECKSUM,
            CONFIG.TRADING_PAIR
        );

        this.initializeDatabase();
    }

    private async initializeDatabase() {
        try {
            await AppDataSource.initialize();
            this.log("✅ Database connected");
        } catch (error) {
            this.error("Database initialization failed", error);
            process.exit(1);
        }
    }

    async start() {
        this.marketDataCollector.start();
        this.log(`🔌 Connected to ${CONFIG.TRADING_PAIR} market data stream`);
        this.log("🚀 Starting Price Trigger Listener");
        this.log("🔔 Listening for price spikes to trigger AI analysis");

        try {
            const network = await this.provider.getNetwork();
            this.log(`⛓️ Connected to: ${network.name} (ID: ${network.chainId})`);
            this.setupEventListeners();
        } catch (error) {
            this.error("Initialization failed", error);
            process.exit(1);
        }
    }

    private setupEventListeners() {
        try {
            const filter = this.priceTriggerContract.filters.PriceSpikeDetected();

            this.priceTriggerContract.on(filter, async (...args: any[]) => {
                if (this.isProcessing) {
                    this.log("⚠️ Skipping event - processing in progress");
                    return;
                }

                // Check cooldown
                const now = Date.now();
                if (now - this.lastEventTime < CONFIG.EVENT_COOLDOWN) {
                    this.log("⏳ Cooldown active - skipping event");
                    return;
                }
                this.lastEventTime = now;

                try {
                    const event = args[args.length - 1] as ethers.Event;
                    const [currentPrice, previousPrice, changePercent] = args.slice(0, -1) as [
                        ethers.BigNumber,
                        ethers.BigNumber,
                        ethers.BigNumber
                    ];

                    await this.processPriceSpike(
                        currentPrice,
                        previousPrice,
                        changePercent,
                        event
                    );
                } catch (err) {
                    this.error("Event processing error", err);
                }
            });

            this.log("👂 Listening for PriceSpikeDetected events...");
        } catch (error) {
            this.error("Failed to setup event listeners", error);
            setTimeout(() => this.setupEventListeners(), 5000);
        }
    }

    private async processPriceSpike(
        currentPrice: ethers.BigNumber,
        previousPrice: ethers.BigNumber,
        changePercent: ethers.BigNumber,
        event: ethers.Event
    ) {
        this.isProcessing = true;
        const startTime = Date.now();
        const eventId = `spike-${event.blockNumber}-${event.transactionIndex}`;

        try {
            await this.waitForMarketDataReady();
            // 1. Create log entry
            const logEntry = new PriceDetectionLog();
            logEntry.id = eventId;
            logEntry.timestamp = new Date().toISOString();
            logEntry.eventTxHash = event.transactionHash;
            logEntry.eventBlockNumber = event.blockNumber;
            logEntry.createdAt = new Date().toISOString();
            logEntry.regime = 'transitioning';

            // 2. Get pair details with fallback
            let pairId: number;
            try {
                const pairIdBN = await this.priceTriggerContract.getPairId();
                pairId = pairIdBN.toNumber();
            } catch (error) {
                pairId = parseInt(CONFIG.PAIR_ID);
                this.error("pairId contract call failed, using config fallback", error);
            }
            logEntry.pairId = pairId;

            // 3. Fetch token addresses
            const [stableAddr, volatileAddr] = await this.exchangeContract.getTokenAddresses(pairId);
            const stableToken = ethers.utils.getAddress(stableAddr);
            const volatileToken = ethers.utils.getAddress(volatileAddr);

            // 4. Convert prices
            const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
            const previousPriceNum = parseFloat(ethers.utils.formatUnits(previousPrice, 8));
            const changePercentNum = parseFloat(ethers.utils.formatUnits(changePercent, 2));
            logEntry.spikePercent = changePercentNum;

            // 5. Fetch FGI data
            let fgiData = { value: 50, classification: "Neutral" };
            try {
                fgiData = await getFearAndGreedIndex();
            } catch (error) {
                this.error("FGI fetch failed, using fallback", error);
            }
            logEntry.fgi = fgiData.value;
            logEntry.fgiClassification = fgiData.classification;

            // 6. Generate AI prompt
            const promptResult = await this.promptService.generatePromptConfig(currentPriceNum);
            const basePrompt = promptResult.config;
            const marketState = this.marketDataCollector.getCurrentMarketState();
            const bayesianAnalysis = marketState?.bayesianAnalysis || promptResult.bayesianAnalysis;

            const enhancedPrompt = this.enhancePromptWithSpike(
                basePrompt,
                currentPriceNum,
                previousPriceNum,
                changePercentNum
            );

            const promptString = JSON.stringify(enhancedPrompt);
            logEntry.priceContext = promptString;

            // 7. Get trading decision
            const signal = await this.fetchTradingSignal(promptString, eventId);
            const tradingDecision = await this.parseTradingDecision(
                signal,
                eventId,
                stableToken,
                volatileToken,
                currentPriceNum,
                bayesianAnalysis
            );

            // 8. Update log with decision
            logEntry.decision = JSON.stringify(tradingDecision);
            logEntry.decisionLength = logEntry.decision.length;
            logEntry.tokenIn = tradingDecision.tokenIn;
            logEntry.tokenOut = tradingDecision.tokenOut;
            logEntry.confidence = tradingDecision.confidence;
            logEntry.amount = tradingDecision.amount;
            logEntry.stopLoss = tradingDecision.stopLoss;
            logEntry.takeProfit = tradingDecision.takeProfit;

            // 9. Set status for Trade Executor
            logEntry.status = "completed";

            // 10. Save to database
            await AppDataSource.manager.save(logEntry);
            await this.logDetectionToGraphQL(logEntry, bayesianAnalysis);
            this.log(`✅ Spike processed. Sent to Trade Executor in ${Date.now() - startTime}ms`);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            this.error("Price spike processing failed", errorMsg);

            // Create error log entry
            const errorLog = new PriceDetectionLog();
            errorLog.id = `error-${Date.now()}`;
            errorLog.timestamp = new Date().toISOString();
            errorLog.createdAt = new Date().toISOString();
            errorLog.eventTxHash = event.transactionHash;
            errorLog.eventBlockNumber = event.blockNumber;
            errorLog.status = "failed";
            errorLog.error = errorMsg;
            errorLog.pairId = parseInt(CONFIG.PAIR_ID);
            errorLog.priceContext = "Error context";
            errorLog.decision = "{}";
            errorLog.decisionLength = 2;
            errorLog.spikePercent = 0;
            errorLog.tokenIn = ZERO_ADDRESS;
            errorLog.tokenOut = ZERO_ADDRESS;
            errorLog.confidence = "unknown";
            errorLog.amount = "0";

            await AppDataSource.manager.save(errorLog);
        } finally {
            this.isProcessing = false;
        }
    }

    private async waitForMarketDataReady(timeout = 30000): Promise<void> {
        const start = Date.now();
        while (!this.marketDataCollector.isReady()) {
            if (Date.now() - start > timeout) {
                throw new Error("Market data initialization timeout");
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }


    private enhancePromptWithSpike(
        basePrompt: any,
        currentPrice: number,
        previousPrice: number,
        changePercent: number
    ): any {
        const direction = currentPrice > previousPrice ? "up" : "down";
        const priceChange = Math.abs(changePercent);
        const volatilityLevel = priceChange < 2 ? "low" :
            priceChange < 5 ? "medium" :
                priceChange < 10 ? "high" : "extreme";

        return {
            ...basePrompt,
            market_context: {
                ...(basePrompt.market_context || {}),
                price_event: {
                    type: "spike",
                    direction,
                    change_percent: priceChange,
                    current_price: currentPrice,
                    previous_price: previousPrice,
                    volatility_level: volatilityLevel
                }
            },
            instructions: `${basePrompt.instructions}\n\nIMPORTANT: Price spike detected (${priceChange.toFixed(2)}% ${direction})`
        };
    }

    private async logDetectionToGraphQL(log: PriceDetectionLog, analysis: BayesianRegressionResult) {
        const mutation = gql`
        mutation LogDetection($entry: DetectionInput!) {
            logDetection(entry: $entry)
        }
    `;

        try {
            await this.graphQLClient.request(mutation, {
                entry: {
                    id: log.id,
                    pairId: log.pairId,
                    timestamp: log.timestamp,
                    createdAt: log.createdAt,
                    priceContext: log.priceContext,
                    decision: log.decision,
                    decisionLength: log.decisionLength,
                    status: log.status,
                    spikePercent: log.spikePercent,
                    eventTxHash: log.eventTxHash,
                    eventBlockNumber: log.eventBlockNumber,
                    fgi: log.fgi,
                    fgiClassification: log.fgiClassification,
                    tokenIn: log.tokenIn,
                    tokenOut: log.tokenOut,
                    confidence: log.confidence,
                    amount: log.amount,
                    stopLoss: log.stopLoss,
                    takeProfit: log.takeProfit,
                    error: log.error || null,
                    positionId: log.positionId || null,
                    tradeTxHash: log.tradeTxHash || null,
                    riskManagerTxHash: log.riskManagerTxHash || null,
                    entryPrice: log.entryPrice || null,
                    bayesianAnalysis: JSON.stringify(analysis)
                }
            });
            this.log(`📤 Logged detection to GraphQL: ${log.id}`);
        } catch (error) {
            this.error('GraphQL detection log error:', error);
        }
    }

    private async parseTradingDecision(
        signal: string,
        eventId: string,
        stableToken: string,
        volatileToken: string,
        currentPrice: number,
        analysis: BayesianRegressionResult
    ): Promise<TradingDecision> {
        this.debugLog(`Raw signal (${signal.length} chars): ${signal.substring(0, 300)}${signal.length > 300 ? '...' : ''}`);

        const debugEntry = new ApiDebugLog();
        debugEntry.id = eventId;
        debugEntry.timestamp = new Date().toISOString();
        debugEntry.rawResponse = signal;

        // Fallback decision
        const fallbackDecision: TradingDecision = {
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "FALLBACK: Could not parse decision",
            confidence: "medium",
            stopLoss: 0,
            takeProfit: 0
        };

        debugEntry.parsedDecision = JSON.stringify(fallbackDecision);

        try {
            // Parse as JSON
            try {
                const decision = JSON.parse(signal);
                this.debugLog("✅ Successfully parsed JSON");
                const validated = this.validateDecisionStructure(decision, stableToken, volatileToken, currentPrice, analysis);
                debugEntry.parsedDecision = JSON.stringify(validated);
                return validated;
            } catch (primaryError) {
                debugEntry.error = primaryError instanceof Error ? primaryError.message : 'JSON parse failed';
            }

            // Extract JSON from string
            try {
                const startIndex = signal.indexOf('{');
                const endIndex = signal.lastIndexOf('}');
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    const candidate = signal.substring(startIndex, endIndex + 1);
                    const parsed = JSON.parse(candidate);
                    this.debugLog(`✅ Extracted JSON with bracket matching`);
                    const validated = this.validateDecisionStructure(parsed, stableToken, volatileToken, currentPrice, analysis);
                    debugEntry.parsedDecision = JSON.stringify(validated);
                    return validated;
                }
            } catch (bracketError) {
                debugEntry.error += bracketError instanceof Error ? ` | ${bracketError.message}` : ' | Bracket matching failed';
            }

            // Regex extraction
            try {
                const jsonRegex = /{(?:[^{}]|{[^{}]*})*}/;
                const match = signal.match(jsonRegex);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    this.debugLog(`✅ Extracted JSON with regex`);
                    const validated = this.validateDecisionStructure(parsed, stableToken, volatileToken, currentPrice, analysis);
                    debugEntry.parsedDecision = JSON.stringify(validated);
                    return validated;
                }
            } catch (regexError) {
                debugEntry.error += regexError instanceof Error ? ` | ${regexError.message}` : ' | Regex extraction failed';
            }

            return fallbackDecision;
        } finally {
            await this.saveDebugLog(debugEntry);
        }
    }

    private async saveDebugLog(entry: ApiDebugLog) {
        if (!CONFIG.DEBUG) return;

        try {
            const debugLogRepo = AppDataSource.getRepository(ApiDebugLog);
            await debugLogRepo.save(entry);
            this.debugLog(`📝 Debug log saved: ${entry.id}`);
        } catch (error) {
            this.debugLog(`❌ Failed to save debug log to DB: ${error}`);
        }
    }

    private validateDecisionStructure(
        decision: any,
        stableToken: string,
        volatileToken: string,
        currentPrice: number,
        analysis: BayesianRegressionResult
    ): TradingDecision {
        if (!decision || typeof decision !== 'object') {
            throw new Error("Decision must be a valid object");
        }

        // 1. Validate decision type
        const action = decision.decision?.toString().toLowerCase().trim();
        if (!action || !['buy', 'sell', 'hold'].includes(action)) {
            throw new Error(`Invalid decision type: ${decision.decision}`);
        }

        // 2. Handle hold decision
        if (action === "hold") {
            return this.validateHoldDecision(decision);
        }

        // 3. Validate token addresses
        const { tokenIn, tokenOut } = this.validateTokenAddresses(
            decision,
            stableToken,
            volatileToken,
            action
        );

        // 4. Validate amount
        const amount = this.validateAmount(decision, action);

        // 5. Validate risk parameters
        const { stopLoss, takeProfit } = this.validateRiskParameters(
            decision,
            currentPrice,
            action,
            analysis
        );

        // 6. Validate slippage using volatility from Bayesian analysis
        const slippage = this.validateSlippage(decision, analysis.volatility);

        // 7. Validate confidence level
        const confidence = this.validateConfidence(decision);

        // 8. Validate position sizing using probability
        this.validatePositionSize(
            amount,
            action,
            tokenIn,
            stableToken,
            analysis
        );

        return {
            decision: action as 'buy' | 'sell',
            tokenIn,
            tokenOut,
            amount: amount.toString(),
            slippage,
            reasoning: decision.reasoning || "Statistical trade execution",
            confidence: confidence as 'high' | 'medium' | 'low',
            stopLoss,
            takeProfit
        };
    }

    // ======== HELPER METHODS ========

    private validateHoldDecision(decision: any): TradingDecision {
        return {
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: decision.reasoning || "Market conditions uncertain",
            confidence: "medium",
            stopLoss: 0,
            takeProfit: 0
        };
    }

    private validateTokenAddresses(
        decision: any,
        stableToken: string,
        volatileToken: string,
        action: string
    ) {
        const tokenIn = decision.tokenIn ? ethers.utils.getAddress(decision.tokenIn) : '';
        const tokenOut = decision.tokenOut ? ethers.utils.getAddress(decision.tokenOut) : '';

        if (action === 'buy') {
            if (tokenIn !== stableToken || tokenOut !== volatileToken) {
                throw new Error(
                    `For BUY: tokenIn must be stablecoin (${stableToken}) ` +
                    `and tokenOut must be volatile token (${volatileToken})`
                );
            }
        } else if (action === 'sell') {
            if (tokenIn !== volatileToken || tokenOut !== stableToken) {
                throw new Error(
                    `For SELL: tokenIn must be volatile token (${volatileToken}) ` +
                    `and tokenOut must be stablecoin (${stableToken})`
                );
            }
        }

        return { tokenIn, tokenOut };
    }

    private validateAmount(decision: any, action: string) {
        const amountStr = decision.amount?.toString() || "0";
        const amount = parseFloat(amountStr);

        if (isNaN(amount)) {
            throw new Error(`Invalid trade amount: ${amountStr}`);
        }

        if (amount <= 0) {
            throw new Error(`${action.toUpperCase()} amount must be positive: ${amount}`);
        }

        return amount;
    }

    private validateRiskParameters(
        decision: any,
        currentPrice: number,
        action: string,
        analysis: BayesianRegressionResult
    ) {
        if (decision.stopLoss === undefined || decision.takeProfit === undefined) {
            throw new Error(`Risk parameters (stopLoss, takeProfit) are required for ${action}`);
        }

        const stopLoss = parseFloat(decision.stopLoss.toString());
        const takeProfit = parseFloat(decision.takeProfit.toString());

        if (isNaN(stopLoss) || isNaN(takeProfit)) {
            throw new Error("Stop loss and take profit must be valid numbers");
        }

        // Check alignment with Bayesian parameters
        const slDiff = Math.abs(stopLoss - analysis.stopLoss);
        const tpDiff = Math.abs(takeProfit - analysis.takeProfit);

        if (slDiff > currentPrice * 0.01) {
            throw new Error(
                `Stop loss differs >1% from Bayesian value ` +
                `(${stopLoss} vs ${analysis.stopLoss})`
            );
        }

        if (tpDiff > currentPrice * 0.01) {
            throw new Error(
                `Take profit differs >1% from Bayesian value ` +
                `(${takeProfit} vs ${analysis.takeProfit})`
            );
        }

        // Validate directional logic
        if (action === 'buy') {
            if (stopLoss >= currentPrice) {
                throw new Error(`BUY stop loss must be BELOW current price (${currentPrice})`);
            }
            if (takeProfit <= currentPrice) {
                throw new Error(`BUY take profit must be ABOVE current price (${currentPrice})`);
            }
        } else if (action === 'sell') {
            if (stopLoss <= currentPrice) {
                throw new Error(`SELL stop loss must be ABOVE current price (${currentPrice})`);
            }
            if (takeProfit >= currentPrice) {
                throw new Error(`SELL take profit must be BELOW current price (${currentPrice})`);
            }
        }

        return { stopLoss, takeProfit };
    }

    private validateSlippage(decision: any, volatility: number) {
        let slippage = parseFloat(decision.slippage?.toString() || "1");

        if (isNaN(slippage)) {
            slippage = 1;
        }

        // Volatility-based validation
        const maxSlippage = volatility > 0.03 ? 3 : 1.5;
        if (slippage < 0.5 || slippage > maxSlippage) {
            throw new Error(
                `Slippage ${slippage}% outside allowed range (0.5-${maxSlippage}%) ` +
                `for volatility ${volatility.toFixed(4)}`
            );
        }

        return parseFloat(slippage.toFixed(2));
    }

    private validateConfidence(decision: any) {
        const confidence = (decision.confidence || 'medium').toLowerCase();
        if (!['high', 'medium', 'low'].includes(confidence)) {
            throw new Error(`Invalid confidence level: ${confidence}`);
        }
        return confidence;
    }

    private validatePositionSize(
        amount: number,
        action: string,
        tokenIn: string,
        stableToken: string,
        analysis: BayesianRegressionResult
    ) {
        // Get expected size based on probability
        let expectedAmount = 0;
        if (analysis.probability > 0.8) expectedAmount = 0.04;
        else if (analysis.probability > 0.65) expectedAmount = 0.03;

        // Convert to input token if needed
        if (action === 'buy' && tokenIn === stableToken) {
            expectedAmount *= analysis.predictedPrice;
        }

        // Allow 10% tolerance
        const tolerance = expectedAmount * 0.1;
        if (expectedAmount > 0 && Math.abs(amount - expectedAmount) > tolerance) {
            throw new Error(
                `Position size ${amount} doesn't match expected ${expectedAmount.toFixed(4)} ` +
                `for probability ${analysis.probability}`
            );
        }
    }

    private async fetchTradingSignal(prompt: string, eventId: string): Promise<string> {
        this.log("📡 Calling Venice API with populated prompt...");
        this.debugLog(`Prompt: ${prompt.substring(0, 200)}...`);

        const debugEntry = new ApiDebugLog();
        debugEntry.id = eventId;
        debugEntry.timestamp = new Date().toISOString();
        debugEntry.prompt = prompt;

        try {
            if (!CONFIG.VENICE_API_KEY) {
                throw new Error("VENICE_API_KEY not set");
            }

            const rawSignal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
            debugEntry.rawResponse = rawSignal;

            if (typeof rawSignal !== "string") {
                throw new Error(`API returned non-string response: ${typeof rawSignal}`);
            }

            const hasDecision = /"decision"\s*:\s*["']?(buy|sell|hold)["']?/i.test(rawSignal);

            if (!hasDecision) {
                throw new Error("API response missing required field: decision");
            }

            // Only require tokenIn for buy/sell decisions
            if (hasDecision && /buy|sell/i.test(rawSignal)) {
                const hasTokenIn = /"tokenIn"\s*:\s*["']?0x[a-fA-F0-9]{40}["']?/i.test(rawSignal);
                if (!hasTokenIn) {
                    throw new Error("API response missing required field: tokenIn for trade");
                }
            }

            return rawSignal;
        } catch (err) {
            const fallback = {
                reasoning: "Error: Failed to fetch valid signal",
                decision: "hold",
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                confidence: "medium"
            };

            debugEntry.error = err instanceof Error ? err.message : "Unknown error";
            debugEntry.parsedDecision = JSON.stringify(fallback);
            this.error("API processing failed", err);
            return JSON.stringify(fallback);
        } finally {
            await this.saveDebugLog(debugEntry);
        }
    }

    private log(message: string) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    private debugLog(message: string) {
        if (CONFIG.DEBUG) {
            console.debug(`[${new Date().toISOString()}] DEBUG: ${message}`);
        }
    }

    private error(message: string, error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${new Date().toISOString()}] ❌ ${message}: ${errorMsg}`);
    }
}

// ======================
// Health Server Setup
// ======================
function startHealthServer() {
    const healthApp = express();
    healthApp.use(cors());

    healthApp.get('/', (_, res) => {
        res.json({
            service: 'Price Trigger',
            version: '1.0',
            routes: ['/health']
        });
    });

    healthApp.get('/health', (_, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            status: 'ok',
            services: ['price-trigger'],
            database: 'connected'
        });
    });

    const PORT = 3002;
    const server = healthApp.listen(PORT, () => {
        console.log(`✅ Price Trigger health server running on port ${PORT}`);
    });
    return server;
}

// ======================
// Main Execution
// ======================
async function main() {
    const listener = new PriceTriggerListener();
    const healthServer = startHealthServer();

    // Start the listener after health server is up
    setTimeout(() => listener.start(), 1000);

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log("\n🛑 Shutting down servers...");
        healthServer.close(() => {
            console.log("🛑 Price trigger listener stopped");
            process.exit(0);
        });
    });
}

main().catch(err => {
    console.error('❌ Fatal error in price trigger:', err);
    process.exit(1);
});