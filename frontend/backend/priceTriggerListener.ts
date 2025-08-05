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
    ApiDebugLog,
    Position
} from "../backend/shared/entities";
import { DataSource } from "typeorm";
import { TradingDecision, BayesianRegressionResult } from "./types";
import ExchangeAbi from "../app/abis/Exchange.json";
import { MarketDataCollector } from "./utils/marketDataCollector";
import { PositionManager } from "./positionManager";

dotenv.config();

// ======================
// Unified Configuration
// ======================
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DATABASE_PATH = process.env.DATABASE_PATH || "data/trading-system.db";

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    RPC_URL: process.env.RPC_URL || "ws://127.0.0.1:8545",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    EXCHANGE_ADDRESS: process.env.EXCHANGE_ADDRESS || "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    DEBUG: false,
    GRAPHQL_ENDPOINT: process.env.GRAPHQL_ENDPOINT || "http://localhost:4000/graphql",
    EVENT_COOLDOWN: 10000, // 10 seconds
    PAIR_ID: process.env.PAIR_ID || "1",
    TRADING_PAIR: process.env.TRADING_PAIR || "ethusdt",
    DATABASE_PATH,
    WARMUP_PERIOD: parseInt(process.env.WARMUP_PERIOD || "120000"), // 2 minutes
    RISK_REWARD_RATIO: parseFloat(process.env.RISK_REWARD_RATIO || "2.5"),
    STRONG_SPIKE_THRESHOLD: parseFloat(process.env.STRONG_SPIKE_THRESHOLD || "0.5") // 0.5%
};

// ======================
// Database Initialization
// ======================
export const AppDataSource = new DataSource({
    type: "sqlite",
    database: CONFIG.DATABASE_PATH,
    entities: [PriceDetectionLog, ApiDebugLog, Position],
    synchronize: true,
    logging: false
});

// ======================
// Price Trigger Listener
// ======================
export class PriceTriggerListener {
    private provider: ethers.providers.WebSocketProvider;
    private priceTriggerContract: ethers.Contract;
    private graphQLClient: GraphQLClient;
    private isProcessing: boolean = false;
    private lastEventTime: number = 0;
    private exchangeContract: ethers.Contract;
    private marketDataCollector: MarketDataCollector;
    private promptService: PromptService;
    private positionManager: PositionManager;
    private startTime: number = Date.now();
    private positionMonitorInterval: NodeJS.Timeout | null = null;
    
    constructor() {
        this.provider = new ethers.providers.WebSocketProvider(CONFIG.RPC_URL);
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
            CONFIG.TRADING_PAIR
        );
        this.positionManager = new PositionManager();
    }

    private async initializeDatabase() {
        try {
            if (!AppDataSource.isInitialized) {
                await AppDataSource.initialize();
            }
            this.log(`✅ Database connected at ${CONFIG.DATABASE_PATH}`);
        } catch (error) {
            this.error("Database initialization failed", error);
            process.exit(1);
        }
    }

    async start() {
        await this.initializeDatabase();
        this.marketDataCollector.start();
        this.log(`🔌 Connected to ${CONFIG.TRADING_PAIR} market data stream`);
        this.log("🚀 Starting Price Trigger Listener");
        this.log("🔔 Listening for price spikes to trigger AI analysis");

        // Start position monitoring
        this.positionMonitorInterval = setInterval(
            () => this.monitorOpenPositions(), 
            60000 // Check every minute
        );

        try {
            const network = await this.provider.getNetwork();
            this.log(`⛓️ Connected to: ${network.name} (ID: ${network.chainId})`);
            this.setupEventListeners();
        } catch (error) {
            this.error("Initialization failed", error);
            process.exit(1);
        }
    }

    private async monitorOpenPositions() {
        try {
            const positions = await this.positionManager.getOpenPositions();
            const lastUpdate = this.marketDataCollector.getLastUpdateTime();
            
            const STALE_DATA_THRESHOLD = 120000; // 2 minutes
            if (Date.now() - lastUpdate > STALE_DATA_THRESHOLD) {
                this.log("⚠️ Skipping position monitoring: Stale market data");
                return;
            }

            const currentPrice = this.marketDataCollector.getCurrentPrice();
            if (currentPrice === null) {
                this.log("⚠️ Skipping position monitoring: No market price available");
                return;
            }
            
            const PRECISION = 0.0001;
            
            for (const position of positions) {
                if (position.direction === 'long') {
                    if (currentPrice <= position.stopLoss - PRECISION) {
                        await this.positionManager.closePosition(
                            position.id,
                            currentPrice,
                            'stop_loss',
                            undefined
                        );
                        this.log(`🛑 STOP LOSS TRIGGERED for LONG position`);
                    }
                    else if (position.takeProfit && currentPrice >= position.takeProfit + PRECISION) {
                        await this.positionManager.closePosition(
                            position.id,
                            currentPrice,
                            'take_profit',
                            undefined
                        );
                        this.log(`🎯 TAKE PROFIT TRIGGERED for LONG position`);
                    }
                } 
                else if (position.direction === 'short') {
                    if (currentPrice >= position.stopLoss + PRECISION) {
                        await this.positionManager.closePosition(
                            position.id,
                            currentPrice,
                            'stop_loss',
                            undefined
                        );
                        this.log(`🛑 STOP LOSS TRIGGERED for SHORT position`);
                    }
                    else if (position.takeProfit && currentPrice <= position.takeProfit - PRECISION) {
                        await this.positionManager.closePosition(
                            position.id,
                            currentPrice,
                            'take_profit',
                            undefined
                        );
                        this.log(`🎯 TAKE PROFIT TRIGGERED for SHORT position`);
                    }
                }
            }
        } catch (error) {
            this.error("Position monitoring error", error);
        }
    }

    private setupEventListeners() {
        try {
            const filter = this.priceTriggerContract.filters.PriceSpikeDetected();

            this.priceTriggerContract.on(filter, async (...args: any[]) => {
                if (this.isProcessing) {
                    return;
                }

                // Check cooldown
                const now = Date.now();
                if (now - this.lastEventTime < CONFIG.EVENT_COOLDOWN) {
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
    // System warm-up check
    const now = Date.now();
    if (now - this.startTime < CONFIG.WARMUP_PERIOD) {
        const remaining = (CONFIG.WARMUP_PERIOD - (now - this.startTime)) / 1000;
        this.log(`⏳ Skipping event: System warming up (${remaining.toFixed(1)}s remaining)`);
        return;
    }

    this.isProcessing = true;
    const processingStart = Date.now();
    const eventId = `spike-${event.blockNumber}-${event.transactionIndex}`;
    
    const debugEntry = new ApiDebugLog();
    debugEntry.id = eventId;
    debugEntry.timestamp = new Date().toISOString();
    
    const logEntry = new PriceDetectionLog();
    logEntry.id = eventId;
    logEntry.timestamp = new Date().toISOString();
    logEntry.createdAt = new Date().toISOString();
    logEntry.eventTxHash = event.transactionHash;
    logEntry.eventBlockNumber = event.blockNumber;
    logEntry.regime = "trending";
    logEntry.priceContext = "Initializing...";

    // Convert prices EARLY for spike parameters
    const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
    const previousPriceNum = parseFloat(ethers.utils.formatUnits(previousPrice, 8));
    const changePercentNum = parseFloat(ethers.utils.formatUnits(changePercent, 2));
    const direction = currentPriceNum > previousPriceNum ? "up" : "down";
    const displayDirection = currentPriceNum > previousPriceNum ? "▲ BUY" : "▼ SELL";
    const changeDisplay = Math.abs(changePercentNum).toFixed(2);
    
    logEntry.spikePercent = changePercentNum;
    logEntry.currentPrice = currentPriceNum;

    try {
        // Log price spike detection
        this.log(`📊 Price Spike Detected: ${changeDisplay}% ${displayDirection} | ` +
                `Current: ${currentPriceNum.toFixed(4)} | ` +
                `Previous: ${previousPriceNum.toFixed(4)}`);
        
        let pairId: number;
        try {
            const pairIdBN = await this.priceTriggerContract.getPairId();
            pairId = pairIdBN.toNumber();
        } catch {
            pairId = parseInt(CONFIG.PAIR_ID);
        }
        logEntry.pairId = pairId;

        const [stableAddr, volatileAddr] = await this.exchangeContract.getTokenAddresses(pairId);
        const stableToken = ethers.utils.getAddress(stableAddr);
        const volatileToken = ethers.utils.getAddress(volatileAddr);

        let fgiData = { value: 50, classification: "Neutral" };
        try {
            fgiData = await getFearAndGreedIndex();
        } catch (error) {}
        logEntry.fgi = fgiData.value;
        logEntry.fgiClassification = fgiData.classification;

        // TYPE-SAFE PROMPT CALL
        const promptResult = await (this.promptService as any).generatePromptConfig(
            Math.abs(changePercentNum),
            direction
        );
        const bayesianAnalysis = promptResult.bayesianAnalysis;
        logEntry.regime = bayesianAnalysis.regime;

        const enhancedPrompt = this.enhancePromptWithSpike(
            promptResult.config,
            currentPriceNum,
            previousPriceNum,
            changePercentNum
        );

        const promptString = JSON.stringify(enhancedPrompt);
        logEntry.priceContext = promptString;
        debugEntry.prompt = promptString;

        // Get trading decision
        const signal = await this.fetchTradingSignal(promptString, debugEntry, bayesianAnalysis);
        const tradingDecision = await this.parseTradingDecision(
            signal,
            debugEntry,
            stableToken,
            volatileToken,
            currentPriceNum,
            bayesianAnalysis,
            logEntry
        );

        // Handle position
        await this.handlePositionAction(tradingDecision, logEntry, currentPriceNum, bayesianAnalysis);
        
        // Update log with final decision
        const decisionString = JSON.stringify(tradingDecision);
        logEntry.decision = decisionString;
        logEntry.decisionLength = decisionString.length;
        logEntry.tokenIn = tradingDecision.tokenIn;
        logEntry.tokenOut = tradingDecision.tokenOut;
        logEntry.confidence = tradingDecision.confidence;
        logEntry.amount = tradingDecision.amount;
        logEntry.stopLoss = tradingDecision.stopLoss || null;
        logEntry.takeProfit = tradingDecision.takeProfit || null;
        logEntry.status = "completed";
        
        if (tradingDecision.positionId) {
            logEntry.positionId = tradingDecision.positionId;
        }

        // Decision logging
        this.log(`⚖️ Trading Decision: ${tradingDecision.decision.toUpperCase()} | ` +
                `Action: ${tradingDecision.positionAction.toUpperCase()} | ` +
                `Confidence: ${tradingDecision.confidence} | ` +
                `Amount: ${tradingDecision.amount}`);
        
        if (tradingDecision.positionAction !== 'hold') {
            this.log(`🛡️ Risk Management: ` +
                    `SL: ${tradingDecision.stopLoss?.toFixed(4) || 'N/A'} | ` +
                    `TP: ${tradingDecision.takeProfit?.toFixed(4) || 'N/A'}`);
        }

        // Save to database
        await AppDataSource.manager.save(logEntry);
        await this.logDetectionToGraphQL(logEntry, bayesianAnalysis);
        
        this.log(`✅ Spike processed in ${Date.now() - processingStart}ms | ID: ${logEntry.id}`);

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        this.error("Price spike processing failed", errorMsg);
        this.log(`⚠️ Fallback Decision: HOLD | Reason: ${errorMsg}`);
        
        const errorDecision = {
            error: errorMsg,
            positionAction: 'hold',
            decision: "hold",
            amount: "0"
        };
        const errorString = JSON.stringify(errorDecision);
        
        logEntry.decision = errorString;
        logEntry.decisionLength = errorString.length;
        logEntry.status = "failed";
        logEntry.tokenIn = ZERO_ADDRESS;
        logEntry.tokenOut = ZERO_ADDRESS;
        logEntry.confidence = "unknown";
        logEntry.amount = "0";
        logEntry.priceContext = `Error: ${errorMsg}`;
        
        if (!logEntry.pairId) logEntry.pairId = parseInt(CONFIG.PAIR_ID);
        
        try {
            await AppDataSource.manager.save(logEntry);
        } catch (dbError) {
            this.error("Failed to save error log", dbError);
        }
        debugEntry.error = errorMsg;
        
    } finally {
        if (CONFIG.DEBUG) {
            try {
                await AppDataSource.manager.save(debugEntry);
            } catch (dbError) {
                this.error("Failed to save debug log", dbError);
            }
        }
        this.isProcessing = false;
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
    const isStrong = priceChange > CONFIG.STRONG_SPIKE_THRESHOLD;
    
    return {
        ...basePrompt,
        market_context: {
            ...(basePrompt.market_context || {}),
            price_event: {
                type: "spike",
                direction,
                magnitude: priceChange,
                strength: isStrong ? "strong" : "moderate",
                current_price: currentPrice,
                previous_price: previousPrice
            }
        },
        instructions: `${basePrompt.instructions}\n\nIMPORTANT: PRICE SPIKE DETECTED - ${priceChange.toFixed(2)}% ${direction.toUpperCase()} MOVE`
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
                    decisionLength: log.decision?.length || 0,
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
                    bayesianAnalysis: JSON.stringify(analysis),
                    positionAction: log.positionAction,
                    positionId: log.positionId,
                    currentPrice: log.currentPrice
                }
            });
        } catch (error) {
            this.error('GraphQL detection log error:', error);
        }
    }

    private async parseTradingDecision(
        signal: string,
        debugEntry: ApiDebugLog,
        stableToken: string,
        volatileToken: string,
        currentPrice: number,
        analysis: BayesianRegressionResult,
        logEntry: PriceDetectionLog
    ): Promise<TradingDecision> {
        type TokenMapKey = 'STABLECOIN' | 'VOLATILE';
        const tokenMap: Record<TokenMapKey, string> = {
            "STABLECOIN": stableToken,
            "VOLATILE": volatileToken
        };
    
        const convertToken = (token: any): string => {
            if (typeof token !== 'string') return token;
            const tokenKey = token.toUpperCase();
            return tokenMap[tokenKey as TokenMapKey] || token;
        };
    
        const fallbackDecision: TradingDecision = {
            positionAction: 'hold',
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "FALLBACK: Could not parse decision",
            confidence: "medium",
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit
        };
    
        debugEntry.rawResponse = signal;
        debugEntry.parsedDecision = JSON.stringify(fallbackDecision);
    
        try {
            let parsed: any;
            try {
                parsed = JSON.parse(signal);
            } catch {
                const startIndex = signal.indexOf('{');
                const endIndex = signal.lastIndexOf('}');
                if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                    parsed = JSON.parse(signal.substring(startIndex, endIndex + 1));
                } else {
                    throw new Error("Could not extract JSON from signal");
                }
            }
            
            // Convert token identifiers
            parsed.tokenIn = convertToken(parsed.tokenIn);
            parsed.tokenOut = convertToken(parsed.tokenOut);
            
            // Apply Bayesian SL/TP as fallback
            if (typeof parsed.stopLoss !== 'number' || isNaN(parsed.stopLoss)) {
                parsed.stopLoss = analysis.stopLoss;
            }
            if (typeof parsed.takeProfit !== 'number' || isNaN(parsed.takeProfit)) {
                parsed.takeProfit = analysis.takeProfit;
            }
            
            // Add position action if missing
            if (!parsed.positionAction) {
                parsed.positionAction = 'open';
            }
            
            // Try to find position ID if not provided but needed
            if (['close', 'adjust'].includes(parsed.positionAction) && !parsed.positionId) {
                const openPosition = await this.positionManager.getOpenPosition(logEntry.pairId);
                if (openPosition) {
                    parsed.positionId = openPosition.id;
                }
            }
            
            // Validate and adjust
            const validatedDecision = this.validateDecisionStructure(
                parsed,
                stableToken,
                volatileToken,
                currentPrice,
                analysis
            );
            
            debugEntry.parsedDecision = JSON.stringify(validatedDecision);
            return validatedDecision;
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Parsing error";
            debugEntry.error = errorMsg;
            return fallbackDecision;
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
            throw new Error("Invalid decision object");
        }

        // Validate position action
        if (!['open', 'close', 'adjust', 'hold'].includes(decision.positionAction)) {
            throw new Error(`Invalid position action: ${decision.positionAction}`);
        }

        const action = decision.decision?.toString().toLowerCase().trim() || 'hold';
        if (!['buy', 'sell', 'hold'].includes(action)) {
            throw new Error(`Invalid decision type: ${decision.decision}`);
        }

        // Handle hold decisions
        if (action === "hold" || decision.positionAction === "hold") {
            return {
                positionAction: 'hold',
                decision: 'hold',
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                reasoning: decision.reasoning || "Market conditions uncertain",
                confidence: this.getConfidenceLevel(analysis.probability),
                stopLoss: analysis.stopLoss,
                takeProfit: analysis.takeProfit,
                positionId: decision.positionId
            };
        }

        // Validate token addresses for open positions
        if (decision.positionAction === 'open') {
            const tokenIn = decision.tokenIn ? ethers.utils.getAddress(decision.tokenIn) : '';
            const tokenOut = decision.tokenOut ? ethers.utils.getAddress(decision.tokenOut) : '';

            if (action === 'buy') {
                if (tokenIn !== stableToken || tokenOut !== volatileToken) {
                    throw new Error(`For BUY: tokenIn must be stablecoin and tokenOut must be volatile token`);
                }
            } else if (action === 'sell') {
                if (tokenIn !== volatileToken || tokenOut !== stableToken) {
                    throw new Error(`For SELL: tokenIn must be volatile token and tokenOut must be stablecoin`);
                }
            }
        }

        // Validate amount for open positions
        if (decision.positionAction === 'open') {
            const amount = parseFloat(decision.amount?.toString() || "0");
            if (isNaN(amount) || amount <= 0) {
                throw new Error(`Invalid trade amount: ${decision.amount}`);
            }
        }

        // Apply Bayesian SL/TP as fallback
        let stopLoss = decision.stopLoss;
        let takeProfit = decision.takeProfit;
        
        if (typeof stopLoss !== 'number' || isNaN(stopLoss)) {
            stopLoss = analysis.stopLoss;
        }
        if (typeof takeProfit !== 'number' || isNaN(takeProfit)) {
            takeProfit = analysis.takeProfit;
        }

        // Enhanced risk management thresholds
        const MIN_DISTANCE_PERCENT = 0.001; // 0.1% minimum distance
        const MIN_DISTANCE = currentPrice * MIN_DISTANCE_PERCENT;
        const FALLBACK_THRESHOLD = 0.005; // 0.5%

        if (action === 'buy') {
            // Ensure SL is below current price
            if (stopLoss >= currentPrice - MIN_DISTANCE) {
                stopLoss = currentPrice * (1 - FALLBACK_THRESHOLD);
            }
            
            // Ensure TP is above current price
            if (takeProfit <= currentPrice + MIN_DISTANCE) {
                takeProfit = currentPrice * (1 + FALLBACK_THRESHOLD);
            }
        } else if (action === 'sell') {
            // Ensure SL is above current price
            if (stopLoss <= currentPrice + MIN_DISTANCE) {
                stopLoss = currentPrice * (1 + FALLBACK_THRESHOLD);
            }
            
            // Ensure TP is below current price
            if (takeProfit >= currentPrice - MIN_DISTANCE) {
                takeProfit = currentPrice * (1 - FALLBACK_THRESHOLD);
            }
        }

        // Final validation for SL/TP values
        if (action === 'buy') {
            if (stopLoss >= currentPrice || takeProfit <= currentPrice) {
                throw new Error(`Invalid SL/TP for BUY: SL ${stopLoss} >= ${currentPrice} or TP ${takeProfit} <= ${currentPrice}`);
            }
        } else if (action === 'sell') {
            if (stopLoss <= currentPrice || takeProfit >= currentPrice) {
                throw new Error(`Invalid SL/TP for SELL: SL ${stopLoss} <= ${currentPrice} or TP ${takeProfit} >= ${currentPrice}`);
            }
        }

        return {
            positionAction: decision.positionAction,
            decision: action as 'buy' | 'sell',
            tokenIn: decision.tokenIn || ZERO_ADDRESS,
            tokenOut: decision.tokenOut || ZERO_ADDRESS,
            amount: decision.amount || "0",
            slippage: decision.slippage || 0.5,
            reasoning: decision.reasoning || "Statistical trade execution",
            confidence: (decision.confidence || 'medium').toLowerCase() as 'high' | 'medium' | 'low',
            stopLoss,
            takeProfit,
            positionId: decision.positionId
        };
    }

    private getConfidenceLevel(probability: number): 'high' | 'medium' | 'low' {
        if (probability > 0.8) return 'high';
        if (probability > 0.6) return 'medium';
        return 'low';
    }

    private async handlePositionAction(
    decision: TradingDecision,
    logEntry: PriceDetectionLog,
    currentPrice: number,
    bayesianAnalysis: BayesianRegressionResult
) {
    // Set position action in log entry
    logEntry.positionAction = decision.positionAction as any;
    
    // Get existing position
    const existingPosition = await this.positionManager.getOpenPosition(logEntry.pairId);
    
    if (existingPosition) {
        // Extract position details with type safety
        const isLong = (existingPosition as any).isLong || 
                      (existingPosition as any).direction === 'long';
        
        const entryPrice = parseFloat(
            (existingPosition as any).entryPrice || 
            (existingPosition as any).openPrice || 
            "0"
        );
        
        const positionAmount = parseFloat(
            (existingPosition as any).amount || 
            (existingPosition as any).size || 
            "0"
        );
        
        // Fallback for position creation time
        let positionAge = 0;
        if ((existingPosition as any).createdAt) {
            positionAge = Date.now() - new Date((existingPosition as any).createdAt).getTime();
        } else if ((existingPosition as any).openedAt) {
            positionAge = Date.now() - new Date((existingPosition as any).openedAt).getTime();
        } else {
            // Default to "old enough" if we can't determine age
            positionAge = 600000; // 10 minutes
        }
        
        const decisionIsBuy = decision.decision === 'buy';
        const isCounterPosition = (isLong && !decisionIsBuy) || (!isLong && decisionIsBuy);
        
        // Calculate position profitability
        const positionProfit = isLong ? 
            (currentPrice - entryPrice) * positionAmount :
            (entryPrice - currentPrice) * positionAmount;
        
        const isProfitable = positionProfit > 0;
        const MIN_HOLD_DURATION = 120000; // 2 minutes
        
        // NEW: Confidence-based position handling
        const confidenceValue = {
            'high': 3,
            'medium': 2,
            'low': 1
        }[decision.confidence] || 1;
        
        this.log(`🛡️ Position Conflict: ${existingPosition.direction} | ` +
                `Age: ${(positionAge/1000).toFixed(1)}s | ` +
                `PnL: ${positionProfit.toFixed(4)} | ` +
                `Confidence: ${decision.confidence} (${confidenceValue})`);
        
        switch (decision.positionAction) {
            case 'open':
                if (isCounterPosition) {
                    // High confidence counter-trade
                    if (confidenceValue >= 2) {
                        this.log(`⚠️ HIGH-CONFIDENCE COUNTER-SIGNAL: Closing existing position`);
                        decision.positionAction = 'close';
                        decision.positionId = existingPosition.id;
                        decision.amount = "0";
                    } 
                    // Medium confidence with unprofitable position
                    else if (!isProfitable) {
                        this.log(`⚠️ MEDIUM-CONFIDENCE COUNTER-SIGNAL: Closing unprofitable position`);
                        decision.positionAction = 'close';
                        decision.positionId = existingPosition.id;
                        decision.amount = "0";
                    }
                    else {
                        this.log(`⏸️ Holding counter-signal (low confidence/profitable position)`);
                        decision.positionAction = 'hold';
                    }
                } else {
                    // Same direction - only open if strong signal
                    if (confidenceValue >= 3 && positionAge > MIN_HOLD_DURATION) {
                        this.log(`📈 Adding to position with high confidence`);
                        // Keep open action but reduce size
                        decision.amount = (parseFloat(decision.amount) * 0.5).toString();
                    } else {
                        this.log(`⏸️ Existing position in same direction - holding`);
                        decision.positionAction = 'hold';
                    }
                }
                break;
                
            case 'close':
                if (!decision.positionId) {
                    decision.positionId = existingPosition.id;
                }
                if (positionAge < MIN_HOLD_DURATION && isProfitable) {
                    this.log(`⏱️ Blocked close signal (position too new and profitable)`);
                    decision.positionAction = 'hold';
                }
                break;
                
            case 'adjust':
                if (!decision.positionId) {
                    decision.positionId = existingPosition.id;
                }
                // Add profit protection for adjustments
                await this.positionManager.applyProfitProtection(existingPosition, currentPrice);
                break;
        }
    }

    // Execute position actions
    switch (decision.positionAction) {
        case 'open':
            if (existingPosition && !decision.positionId) {
                // We already handled same-direction positions above
                const newPosition = await this.positionManager.openPosition(
                    logEntry.pairId,
                    CONFIG.TRADING_PAIR,
                    decision.decision === 'buy' ? 'long' : 'short',
                    parseFloat(decision.amount),
                    currentPrice,
                    decision.stopLoss || 0,
                    decision.takeProfit || 0,
                    logEntry.id
                );
                logEntry.positionId = newPosition.id;
                this.log(`📈 OPENED ${newPosition.direction.toUpperCase()} POSITION`);
            }
            break;
                        
        case 'close':
            if (decision.positionId) {
                await this.positionManager.closePosition(
                    decision.positionId,
                    currentPrice,
                    'signal_close',
                    logEntry.id
                );
                this.log(`📉 CLOSED POSITION`);
            } else {
                this.log(`⚠️ Close requested but no position ID found`);
                decision.positionAction = 'hold';
            }
            break;
                        
        case 'adjust':
            if (decision.positionId) {
                await this.positionManager.updatePosition(
                    decision.positionId,
                    {
                        stopLoss: decision.stopLoss,
                        takeProfit: decision.takeProfit
                    }
                );
                this.log(`⚙️ ADJUSTED POSITION`);
            } else {
                this.log(`⚠️ Adjust requested but no position ID found`);
                decision.positionAction = 'hold';
            }
            break;
                        
        case 'hold':
            this.log(`⏸️ HOLDING`);
            break;
    }
}

    private async fetchTradingSignal(
        prompt: string, 
        debugEntry: ApiDebugLog,
        analysis: BayesianRegressionResult
    ): Promise<string> {
        try {
            if (!CONFIG.VENICE_API_KEY) {
                throw new Error("VENICE_API_KEY not set");
            }
        
            return await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "API error";
            
            return JSON.stringify({
                reasoning: `Error: ${errorMsg}`,
                positionAction: "hold",
                decision: "hold",
                tokenIn: "STABLECOIN",
                tokenOut: "VOLATILE",
                amount: "0",
                slippage: 0.5,
                confidence: "medium",
                stopLoss: analysis.stopLoss,
                takeProfit: analysis.takeProfit
            });
        }
    }

    private log(message: string) {
        console.log(`[${new Date().toISOString()}] ${message}`);
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

    healthApp.get('/health', (_, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            status: 'ok',
            services: ['price-trigger'],
            database: AppDataSource.isInitialized ? 'connected' : 'disconnected'
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