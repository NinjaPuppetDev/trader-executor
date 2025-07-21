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
import { DataSource } from "typeorm";
import { TradingDecision, BayesianRegressionResult } from "./types";
import ExchangeAbi from "../app/abis/Exchange.json";
import { MarketDataCollector } from "./utils/marketDataCollector";

dotenv.config();

// ======================
// Unified Configuration
// ======================
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DATABASE_PATH = process.env.DATABASE_PATH || "data/trading-system.db";

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    EXCHANGE_ADDRESS: process.env.EXCHANGE_ADDRESS || "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    DEBUG: false, // Disable debug logging by default
    GRAPHQL_ENDPOINT: process.env.GRAPHQL_ENDPOINT || "http://localhost:4000/graphql",
    EVENT_COOLDOWN: 30000, // 30 seconds
    PAIR_ID: process.env.PAIR_ID || "1",
    TRADING_PAIR: process.env.TRADING_PAIR || "ethusdt",
    DATABASE_PATH
};

// ======================
// Database Initialization
// ======================
export const AppDataSource = new DataSource({
    type: "sqlite",
    database: CONFIG.DATABASE_PATH,
    entities: [PriceDetectionLog, ApiDebugLog],
    synchronize: true,
    logging: false // Disable TypeORM logging
});

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
            CONFIG.TRADING_PAIR
        );
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
                    return; // Silent skip
                }

                // Check cooldown
                const now = Date.now();
                if (now - this.lastEventTime < CONFIG.EVENT_COOLDOWN) {
                    return; // Silent skip
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
        
        const debugEntry = new ApiDebugLog();
        debugEntry.id = eventId;
        debugEntry.timestamp = new Date().toISOString();
        
        const logEntry = new PriceDetectionLog();
        logEntry.id = eventId;
        logEntry.timestamp = new Date().toISOString();
        logEntry.createdAt = new Date().toISOString();
        logEntry.eventTxHash = event.transactionHash;
        logEntry.eventBlockNumber = event.blockNumber;
    
        try {
            // 1. Get pair ID
            let pairId: number;
            try {
                const pairIdBN = await this.priceTriggerContract.getPairId();
                pairId = pairIdBN.toNumber();
            } catch (error) {
                pairId = parseInt(CONFIG.PAIR_ID);
            }
            logEntry.pairId = pairId;
    
            // 2. Fetch token addresses
            const [stableAddr, volatileAddr] = await this.exchangeContract.getTokenAddresses(pairId);
            const stableToken = ethers.utils.getAddress(stableAddr);
            const volatileToken = ethers.utils.getAddress(volatileAddr);
    
            // 3. Convert prices
            const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
            const previousPriceNum = parseFloat(ethers.utils.formatUnits(previousPrice, 8));
            const changePercentNum = parseFloat(ethers.utils.formatUnits(changePercent, 2));
            logEntry.spikePercent = changePercentNum;
    
            // 🔽 ADDED: Price spike detection logging
            this.log(`📊 Price Spike Detected: ${changePercentNum.toFixed(2)}% | ` +
                    `Current: ${currentPriceNum.toFixed(4)} | ` +
                    `Previous: ${previousPriceNum.toFixed(4)}`);
    
            // 4. Fetch FGI data
            let fgiData = { value: 50, classification: "Neutral" };
            try {
                fgiData = await getFearAndGreedIndex();
            } catch (error) {
                // Silent fallback
            }
            logEntry.fgi = fgiData.value;
            logEntry.fgiClassification = fgiData.classification;
    
            // 5. Generate AI prompt
            const promptResult = await this.promptService.generatePromptConfig();
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
    
            // 6. Get trading decision
            const signal = await this.fetchTradingSignal(promptString, debugEntry);
            const tradingDecision = await this.parseTradingDecision(
                signal,
                debugEntry,
                stableToken,
                volatileToken,
                currentPriceNum,
                bayesianAnalysis
            );
    
            // 7. Update log with decision
            const decisionString = JSON.stringify(tradingDecision);
            logEntry.decision = decisionString;
            logEntry.decisionLength = decisionString.length;
            logEntry.tokenIn = tradingDecision.tokenIn;
            logEntry.tokenOut = tradingDecision.tokenOut;
            logEntry.confidence = tradingDecision.confidence;
            logEntry.amount = tradingDecision.amount;
            logEntry.stopLoss = tradingDecision.stopLoss;
            logEntry.takeProfit = tradingDecision.takeProfit;
            logEntry.status = "completed";
    
            // 🔽 ADDED: Trading decision and risk management logging
            this.log(`⚖️ Trading Decision: ${tradingDecision.decision.toUpperCase()} | ` +
                    `Confidence: ${tradingDecision.confidence} | ` +
                    `Amount: ${tradingDecision.amount}`);
            
            this.log(`🛡️ Risk Management: ` +
                    `SL: ${tradingDecision.stopLoss?.toFixed(4) || 'N/A'} | ` +
                    `TP: ${tradingDecision.takeProfit?.toFixed(4) || 'N/A'}`);
    
            // 8. Save detection log
            await AppDataSource.manager.save(logEntry);
            await this.logDetectionToGraphQL(logEntry, bayesianAnalysis);
            
            this.log(`✅ Spike processed in ${Date.now() - startTime}ms | ID: ${logEntry.id}`);
    
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            this.error("Price spike processing failed", errorMsg);
            
            // 🔽 ADDED: Fallback decision logging
            this.log(`⚠️ Fallback Decision: HOLD | Reason: ${errorMsg}`);
            
            // Create minimal decision for error case
            const errorDecision = {
                error: errorMsg,
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
            
            if (!logEntry.pairId) logEntry.pairId = parseInt(CONFIG.PAIR_ID);
            
            await AppDataSource.manager.save(logEntry);
            debugEntry.error = errorMsg;
            
        } finally {
            // Save debug log
            await this.saveDebugLog(debugEntry);
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
                }
            },
            instructions: `${basePrompt.instructions}\n\nPRICE EVENT: ${priceChange.toFixed(2)}% ${direction.toUpperCase()} SPIKE`
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
                    bayesianAnalysis: JSON.stringify(analysis)
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
        analysis: BayesianRegressionResult
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
            
            // Validate and adjust
            return this.validateDecisionStructure(
                parsed,
                stableToken,
                volatileToken,
                currentPrice,
                analysis
            );
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Parsing error";
            debugEntry.error = errorMsg;
            return fallbackDecision;
        }
    }

    private async saveDebugLog(entry: ApiDebugLog) {
        if (!CONFIG.DEBUG) return;
        try {
            await AppDataSource.manager.save(entry);
        } catch (error) {
            console.error('Failed to save debug log', error);
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

        const action = decision.decision?.toString().toLowerCase().trim() || 'hold';
        if (!['buy', 'sell', 'hold'].includes(action)) {
            throw new Error(`Invalid decision type: ${decision.decision}`);
        }

        if (action === "hold") {
            return {
                decision: 'hold',
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                reasoning: decision.reasoning || "Market conditions uncertain",
                confidence: "medium",
                stopLoss: analysis.stopLoss,
                takeProfit: analysis.takeProfit
            };
        }

        // Validate token addresses
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

        // Validate amount
        const amount = parseFloat(decision.amount?.toString() || "0");
        if (isNaN(amount) || amount <= 0) {
            throw new Error(`Invalid trade amount: ${decision.amount}`);
        }

        // Apply Bayesian SL/TP if missing
        let stopLoss = decision.stopLoss;
        let takeProfit = decision.takeProfit;
        
        if (typeof stopLoss !== 'number' || isNaN(stopLoss)) {
            stopLoss = analysis.stopLoss;
        }
        if (typeof takeProfit !== 'number' || isNaN(takeProfit)) {
            takeProfit = analysis.takeProfit;
        }

        // Adjust SL/TP to be realistic
        if (action === 'buy') {
            if (stopLoss >= currentPrice) stopLoss = currentPrice * 0.995;
            if (takeProfit <= currentPrice) takeProfit = currentPrice * 1.005;
        } else if (action === 'sell') {
            if (stopLoss <= currentPrice) stopLoss = currentPrice * 1.005;
            if (takeProfit >= currentPrice) takeProfit = currentPrice * 0.995;
        }

        return {
            decision: action as 'buy' | 'sell',
            tokenIn,
            tokenOut,
            amount: amount.toString(),
            slippage: decision.slippage || 0.5,
            reasoning: decision.reasoning || "Statistical trade execution",
            confidence: (decision.confidence || 'medium').toLowerCase() as 'high' | 'medium' | 'low',
            stopLoss,
            takeProfit
        };
    }

    private async fetchTradingSignal(prompt: string, debugEntry: ApiDebugLog): Promise<string> {
        try {
            if (!CONFIG.VENICE_API_KEY) {
                throw new Error("VENICE_API_KEY not set");
            }
    
            return await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "API error";
            
            // Return valid fallback
            return JSON.stringify({
                reasoning: `Error: ${errorMsg}`,
                decision: "hold",
                tokenIn: "STABLECOIN",
                tokenOut: "VOLATILE",
                amount: "0",
                slippage: 0.5,
                confidence: "medium",
                stopLoss: 0,
                takeProfit: 0
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