import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import dotenv from "dotenv";
import { generatePromptConfig } from "./prompts/promptService";
import { getFearAndGreedIndex } from "./utils/fgiService";
import { GraphQLClient, gql } from 'graphql-request';
import express from "express";
import cors from 'cors';
import "reflect-metadata";
import { DataSource } from "typeorm";
import {
    PriceDetectionLog,
    ProcessedTrigger,
    ApiDebugLog
} from "../backend/shared/entities";
import { AppDataSource } from "../backend/shared/database";

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
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    DEBUG: true,
    GRAPHQL_ENDPOINT: process.env.GRAPHQL_ENDPOINT || "http://localhost:4000/graphql",
    EVENT_COOLDOWN: 30000 // 30 seconds
};

// ======================
// Price Trigger Listener
// ======================
class PriceTriggerListener {
    private provider: ethers.providers.JsonRpcProvider;
    private priceTriggerContract: ethers.Contract;
    private graphQLClient: GraphQLClient;
    private isProcessing: boolean = false;
    private lastEventTime: number = 0;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.priceTriggerContract = new ethers.Contract(
            CONFIG.PRICE_TRIGGER_ADDRESS,
            PriceTriggerAbi,
            this.provider
        );
        this.graphQLClient = new GraphQLClient(CONFIG.GRAPHQL_ENDPOINT);
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
        this.log("🚀 Starting Price Trigger Listener");
        this.log("🔔 Listening for price spikes to trigger AI analysis");
        this.log(`🔑 Stable Token: ${STABLE_TOKEN_CHECKSUM}`);
        this.log(`🔑 Volatile Token: ${VOLATILE_TOKEN_CHECKSUM}`);

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
        const eventId = `spike-${Date.now()}`;
        const startTime = Date.now();

        // Check if event already processed
        const processedExists = await AppDataSource.getRepository(ProcessedTrigger).findOneBy({ id: eventId });
        if (processedExists) {
            this.log(`⏭️ Event already processed: ${eventId}`);
            this.isProcessing = false;
            return;
        }

        // Convert prices
        const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
        const previousPriceNum = parseFloat(ethers.utils.formatUnits(previousPrice, 8));
        const changePercentNum = parseFloat(ethers.utils.formatUnits(changePercent, 2));

        this.log(`🔔 Price spike detected! ${changePercentNum.toFixed(2)}% change`);

        try {
            // Fetch FGI data
            let fgiData: { value: number; classification: string };
            try {
                fgiData = await getFearAndGreedIndex();
                this.log(`📊 FGI fetched: ${fgiData.value} (${fgiData.classification})`);
            } catch (fgiError) {
                this.error("FGI fetch failed, using fallback", fgiError);
                fgiData = { value: 50, classification: "Neutral" };
            }

            // Generate and clean prompt
            const basePrompt = await generatePromptConfig();
            const enhancedPrompt = this.enhancePromptWithSpike(
                basePrompt,
                currentPriceNum,
                previousPriceNum,
                changePercentNum
            );

            // Clean transient data
            const cleanedPrompt = JSON.parse(JSON.stringify(enhancedPrompt));
            if (cleanedPrompt.market_context) {
                delete cleanedPrompt.market_context.rl_insights;
                delete cleanedPrompt.market_context.timestamp;
            }

            const promptString = JSON.stringify(cleanedPrompt);

            // Get trading signal
            const signal = await this.fetchTradingSignal(promptString, eventId);
            const tradingDecision = this.parseTradingDecision(signal, eventId);

            // Create and save log entry
            const logEntry = new PriceDetectionLog();
            logEntry.id = eventId;
            logEntry.timestamp = new Date().toISOString();
            logEntry.priceContext = `Spike: ${changePercentNum.toFixed(2)}% | Current: $${currentPriceNum} | Previous: $${previousPriceNum}`;
            logEntry.decision = JSON.stringify(tradingDecision);
            logEntry.decisionLength = JSON.stringify(tradingDecision).length;
            logEntry.status = "completed";
            logEntry.createdAt = new Date().toISOString();
            logEntry.spikePercent = changePercentNum;
            logEntry.eventTxHash = event.transactionHash;
            logEntry.eventBlockNumber = event.blockNumber;
            logEntry.fgi = fgiData.value;
            logEntry.fgiClassification = fgiData.classification;
            logEntry.tokenIn = tradingDecision.tokenIn;
            logEntry.tokenOut = tradingDecision.tokenOut;
            logEntry.confidence = tradingDecision.confidence;
            logEntry.amount = tradingDecision.amount;

            await AppDataSource.manager.save(logEntry);
            await this.logDetectionToGraphQL(logEntry);

            // Mark as processed
            const processed = new ProcessedTrigger();
            processed.id = eventId;
            await AppDataSource.manager.save(processed);

            this.log(`✅ Processing completed in ${Date.now() - startTime}ms`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            this.error("Processing failed", errorMsg);

            // Create and save error log entry
            const logEntry = new PriceDetectionLog();
            logEntry.id = eventId;
            logEntry.timestamp = new Date().toISOString();
            logEntry.priceContext = `Spike: ${changePercentNum.toFixed(2)}% | Current: $${currentPriceNum} | Previous: $${previousPriceNum}`;
            logEntry.decision = "";
            logEntry.decisionLength = 0;
            logEntry.status = "failed";
            logEntry.createdAt = new Date().toISOString();
            logEntry.error = errorMsg;
            logEntry.spikePercent = changePercentNum;
            logEntry.eventTxHash = event.transactionHash;
            logEntry.eventBlockNumber = event.blockNumber;
            logEntry.tokenIn = ZERO_ADDRESS;
            logEntry.tokenOut = ZERO_ADDRESS;
            logEntry.amount = '0';

            await AppDataSource.manager.save(logEntry);
        } finally {
            this.isProcessing = false;
        }
    }

    private async logDetectionToGraphQL(log: PriceDetectionLog) {
        const mutation = gql`
        mutation LogDetection($entry: DetectionInput!) {
            logDetection(entry: $entry)
        }
    `;

        try {
            await this.graphQLClient.request(mutation, {
                entry: {
                    id: log.id,
                    spikePercent: log.spikePercent,
                    tokenIn: log.tokenIn,
                    tokenOut: log.tokenOut,
                    confidence: log.confidence || 'medium',
                    amount: log.amount || '0',
                    eventTxHash: log.eventTxHash,
                    eventBlockNumber: log.eventBlockNumber,
                    createdAt: log.createdAt,
                    status: log.status,
                    decision: log.decision || '',
                    fgi: log.fgi,           // Add this
                    fgiClassification: log.fgiClassification // Add this
                }
            });
            this.log(`📤 Logged detection to GraphQL: ${log.id}`);
        } catch (error) {
            this.error('GraphQL detection log error:', error);
        }
    }

    private parseTradingDecision(signal: string, eventId: string) {
        this.debugLog(`Raw signal (${signal.length} chars): ${signal.substring(0, 300)}${signal.length > 300 ? '...' : ''}`);

        const debugEntry = new ApiDebugLog();
        debugEntry.id = eventId;
        debugEntry.timestamp = new Date().toISOString();
        debugEntry.prompt = "";
        debugEntry.rawResponse = signal;

        // FIX: Always store parsedDecision as string
        debugEntry.parsedDecision = JSON.stringify({
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "Initial placeholder"
        });

        try {
            const decision = JSON.parse(signal);
            this.debugLog("✅ Successfully parsed JSON");
            const validated = this.validateDecisionStructure(decision);

            // FIX: Stringify before saving to debugEntry
            debugEntry.parsedDecision = JSON.stringify(validated);
            this.saveDebugLog(debugEntry);
            return validated;
        } catch (primaryError) {
            debugEntry.error = primaryError instanceof Error ? primaryError.message : 'JSON parse failed';
            this.debugLog(`❌ JSON parse failed: ${debugEntry.error}`);
        }

        try {
            const startIndex = signal.indexOf('{');
            const endIndex = signal.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                const candidate = signal.substring(startIndex, endIndex + 1);
                const parsed = JSON.parse(candidate);
                this.debugLog(`✅ Extracted JSON with bracket matching`);
                const validated = this.validateDecisionStructure(parsed);

                // FIX: Stringify before saving to debugEntry
                debugEntry.parsedDecision = JSON.stringify(validated);
                this.saveDebugLog(debugEntry);
                return validated;
            }
        } catch (bracketError) {
            debugEntry.error = bracketError instanceof Error ? bracketError.message : 'Bracket matching failed';
            this.debugLog(`Bracket matching failed`);
        }

        this.debugLog("❌ All parsing methods failed");
        const fallbackDecision = {
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "FALLBACK: Could not parse decision",
            confidence: "medium"
        };

        // FIX: Stringify fallback before saving
        debugEntry.parsedDecision = JSON.stringify(fallbackDecision);
        debugEntry.error = "All parsing methods failed";
        this.saveDebugLog(debugEntry);
        return fallbackDecision;
    }

    private async saveDebugLog(entry: ApiDebugLog) {
        if (!CONFIG.DEBUG) return;

        try {
            const debugLogRepo = AppDataSource.getRepository(ApiDebugLog);
            await debugLogRepo.save(entry);
            this.debugLog(`📝 Debug log saved: ${entry.id}`);
        } catch (error) {
            this.debugLog(`❌ Failed to save debug log to DB: ${error}`);
            this.debugLog(`[DebugLog] ${JSON.stringify(entry)}`);
        }
    }

    private validateDecisionStructure(decision: any) {
        if (!decision || typeof decision !== 'object') {
            throw new Error("Decision must be a valid object");
        }

        const normalizeAddress = (addr: string): string => {
            try {
                return ethers.utils.getAddress(addr);
            } catch {
                return addr;
            }
        };

        const action = decision.decision?.toString().toLowerCase().trim();
        if (!action || !['buy', 'sell', 'hold'].includes(action)) {
            throw new Error(`Invalid decision type: ${decision.decision}`);
        }

        if (action === "hold") {
            return {
                decision: "hold",
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                reasoning: decision.reasoning || "Market conditions uncertain",
                confidence: decision.confidence
            };
        }

        let tokenIn = decision.tokenIn ? normalizeAddress(decision.tokenIn) : '';
        let tokenOut = decision.tokenOut ? normalizeAddress(decision.tokenOut) : '';

        if (action === 'buy') {
            if (tokenIn === VOLATILE_TOKEN_CHECKSUM && tokenOut === STABLE_TOKEN_CHECKSUM) {
                [tokenIn, tokenOut] = [tokenOut, tokenIn];
            }
        } else if (action === 'sell') {
            if (tokenIn === STABLE_TOKEN_CHECKSUM && tokenOut === VOLATILE_TOKEN_CHECKSUM) {
                [tokenIn, tokenOut] = [tokenOut, tokenIn];
            }
        }

        if (action === 'buy') {
            if (tokenIn !== STABLE_TOKEN_CHECKSUM || tokenOut !== VOLATILE_TOKEN_CHECKSUM) {
                throw new Error(
                    `For BUY, tokenIn must be stablecoin and tokenOut must be volatile token`
                );
            }
        } else if (action === 'sell') {
            if (tokenIn !== VOLATILE_TOKEN_CHECKSUM || tokenOut !== STABLE_TOKEN_CHECKSUM) {
                throw new Error(
                    `For SELL, tokenIn must be volatile token and tokenOut must be stablecoin`
                );
            }
        }

        const amountStr = decision.amount?.toString() || "0";
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) {
            throw new Error(`Invalid trade amount: ${amountStr}`);
        }
        if (amount <= 0) {
            throw new Error(`Trade amount must be positive: ${amount}`);
        }

        const confidence = decision.confidence || 'medium';
        let maxAmount = 0.025;

        if (confidence === 'high') maxAmount = 0.04;
        if (confidence === 'low') maxAmount = 0.01;

        if (amount > maxAmount) {
            throw new Error(
                `Amount ${amount} exceeds ${maxAmount} limit for ${confidence} confidence`
            );
        }

        let slippage = parseFloat(decision.slippage?.toString() || "1");
        if (isNaN(slippage)) {
            slippage = 1;
        }
        slippage = Math.min(Math.max(slippage, 0.1), 5);
        slippage = parseFloat(slippage.toFixed(2));

        return {
            decision: action as 'buy' | 'sell',
            tokenIn,
            tokenOut,
            amount: amount.toString(),
            slippage,
            reasoning: decision.reasoning || "Trade execution",
            confidence
        };
    }

    private enhancePromptWithSpike(
        basePrompt: any,
        currentPrice: number,
        previousPrice: number,
        changePercent: number
    ): any {
        const direction = currentPrice > previousPrice ? "up" : "down";
        const volatilityLevel = this.getVolatilityLevel(changePercent);
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
                    volatility_level: volatilityLevel
                }
            },
            instructions: `${basePrompt.instructions}\n\nIMPORTANT: Price spike detected (${priceChange.toFixed(2)}% ${direction})`
        };
    }

    private getVolatilityLevel(changePercent: number): string {
        const priceChange = Math.abs(changePercent);
        if (priceChange < 2) return "low";
        if (priceChange < 5) return "medium";
        if (priceChange < 10) return "high";
        return "extreme";
    }

    private async fetchTradingSignal(prompt: string, eventId: string): Promise<string> {
        this.log("📡 Calling Venice API with populated prompt...");
        this.debugLog(`Prompt: ${prompt.substring(0, 200)}...`);

        const debugEntry = new ApiDebugLog();
        debugEntry.id = eventId;
        debugEntry.timestamp = new Date().toISOString();
        debugEntry.prompt = prompt;

        // FIX: Store parsedDecision as string
        debugEntry.parsedDecision = JSON.stringify({
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "Initial placeholder"
        });

        try {
            if (!CONFIG.VENICE_API_KEY) {
                throw new Error("VENICE_API_KEY not set in environment variables");
            }

            const rawSignal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
            debugEntry.rawResponse = rawSignal;

            if (typeof rawSignal !== "string") {
                throw new Error(`API returned non-string response: ${typeof rawSignal}`);
            }

            this.debugLog(`Full API response: ${rawSignal}`);
            const hasDecision = /"decision"\s*:\s*["']?(buy|sell|hold)["']?/i.test(rawSignal);
            const hasTokenIn = /"tokenIn"\s*:\s*["']?0x[a-fA-F0-9]{40}["']?/i.test(rawSignal);

            if (!hasDecision || !hasTokenIn) {
                this.debugLog(`⚠️ Validation failed - decision: ${hasDecision}, tokenIn: ${hasTokenIn}`);
                throw new Error("API response missing required fields");
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

            const fallbackString = JSON.stringify(fallback);
            debugEntry.error = err instanceof Error ? err.message : "Unknown error";

            // FIX: Stringify fallback before storing
            debugEntry.parsedDecision = JSON.stringify(fallback);
            await this.saveDebugLog(debugEntry);
            this.error("API processing failed", err);
            return fallbackString;
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
async function startHealthServer() {
    const healthApp = express();
    healthApp.use(cors());

    healthApp.get('/health', async (_, res) => {
        const dbStatus = AppDataSource.isInitialized ? "connected" : "disconnected";
        const status = dbStatus === "connected" ? "ok" : "degraded";

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            status,
            services: ['price-trigger'],
            database: dbStatus
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
    const healthServer = await startHealthServer();

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