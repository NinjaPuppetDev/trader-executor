import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { lock } from 'proper-lockfile';
import { generatePromptConfig } from "./prompts/promptService";
import { getFearAndGreedIndex } from "./utils/fgiService";
import WebSocket from 'isomorphic-ws';
import http from 'http';
import { getWsServerPort } from './priceTriggerWsServer';

import {
    PriceDetectionLogEntry,
    TradingDecision as TradingDecisionType,
    ApiDebugEntry
} from './types';
import { allocatePort } from "./shared/portManager";

dotenv.config();

// Configuration
const DETECTION_LOG_FILE = path.join(__dirname, "logs", "price-detections.json");
const DEBUG_LOG_FILE = path.join(__dirname, "logs", "api-debug.json");
const PROCESSED_LOG_FILE = path.join(__dirname, "logs", "processed-triggers.json");
const MAX_LOG_ENTRIES = 100;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";


// WebSocket configuration

const WS_RECONNECT_INTERVAL = 5000;  // 5 seconds
const WS_MAX_RETRIES = 5;

// Token addresses from deployment
const STABLE_TOKEN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const VOLATILE_TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const STABLE_TOKEN_CHECKSUM = ethers.utils.getAddress(STABLE_TOKEN);
const VOLATILE_TOKEN_CHECKSUM = ethers.utils.getAddress(VOLATILE_TOKEN);

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    DEBUG: true
};

class PriceTriggerListener {
    private healthServer: http.Server | undefined;
    private isHealthy: boolean;
    private lastHeartbeat: number;
    private heartbeatInterval: NodeJS.Timeout | undefined;
    private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
    private provider: ethers.providers.JsonRpcProvider;
    private priceTriggerContract: ethers.Contract;
    private isProcessing: boolean;
    private lastEventTime: number = 0;
    private readonly EVENT_COOLDOWN = 30000; // 30 seconds
    private wsClient: WebSocket | null = null;
    private wsConnectionAttempts = 0;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.priceTriggerContract = new ethers.Contract(
            CONFIG.PRICE_TRIGGER_ADDRESS,
            PriceTriggerAbi,
            this.provider
        );
        this.isProcessing = false;

        this.isHealthy = true;
        this.lastHeartbeat = Date.now();
        this.setupHealthServer();
        this.startHeartbeatMonitor();

        this.ensureLogsDirectory();
        this.validateLogFiles();
        this.cleanupStaleLocks();
        this.connectToWebSocketServer();
    }

    private async setupHealthServer() {
        try {
            // Use a unique service name for health port
            const healthPort = await allocatePort('priceTriggerListenerHealth');
            this.healthServer = http.createServer((req, res) => {
                if (req.url === '/health') {
                    res.writeHead(this.isHealthy ? 200 : 500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        healthy: this.isHealthy,
                        wsConnected: this.wsClient?.readyState === WebSocket.OPEN
                    }));
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            this.healthServer.listen(healthPort, () => {
                this.log(`🩺 Health server listening on port ${healthPort}`);
            });
        } catch (err) {
            this.error("Failed to start health server", err);
        }
    }

    private startHeartbeatMonitor() {
        this.heartbeatInterval = setInterval(() => {
            // Check WebSocket connection health
            const now = Date.now();
            const timeSinceLastHeartbeat = now - this.lastHeartbeat;

            if (timeSinceLastHeartbeat > this.HEARTBEAT_INTERVAL * 2) {
                this.isHealthy = false;
                this.error("Heartbeat failure",
                    `No heartbeat for ${Math.floor(timeSinceLastHeartbeat / 1000)} seconds`);

                // Attempt to restart WebSocket connection
                if (this.wsClient && this.wsClient.readyState !== WebSocket.OPEN) {
                    this.log("♻️ Restarting WebSocket connection due to heartbeat failure");
                    this.connectToWebSocketServer();
                }
            } else {
                this.isHealthy = true;
            }

            // Send heartbeat to WebSocket server
            if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
                try {
                    this.wsClient.send(JSON.stringify({ type: 'heartbeat', timestamp: now }));
                    this.debugLog(`❤️ Sent heartbeat to WebSocket server`);
                } catch (err) {
                    this.error("Heartbeat send failed", err);
                }
            }

            this.lastHeartbeat = now;
        }, this.HEARTBEAT_INTERVAL);
    }

    private async connectToWebSocketServer() {
        const getPortWithRetry = async (attempt = 1): Promise<number> => {
            const maxAttempts = 10;
            const port = getWsServerPort();

            if (port) {
                this.debugLog(`Discovered WebSocket server port: ${port}`);
                return port;
            }

            if (attempt > maxAttempts) {
                throw new Error("Could not discover WebSocket server port");
            }

            const delay = Math.min(attempt * 2000, 10000);
            this.log(`⌛ Waiting for WebSocket server (attempt ${attempt}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return getPortWithRetry(attempt + 1);
        };

        try {
            const port = await getPortWithRetry();
            this.wsClient = new WebSocket(`ws://localhost:${port}/`); // Add trailing slash

            this.wsClient.on('open', () => {
                this.wsConnectionAttempts = 0;
                this.log(`🔌 Connected to WebSocket server on port ${port}`);
            });

            this.wsClient.on('error', (err: any) => {
                this.error("WebSocket connection error", err);
                this.handleWsReconnect();
            });

            this.wsClient.on('close', () => {
                this.log("WebSocket connection closed");
                this.handleWsReconnect();
            });

            this.wsClient.on('message', (data: WebSocket.Data) => {
                try {
                    if (typeof data === 'string') {
                        const message = JSON.parse(data);
                        if (message.type === 'heartbeat') {
                            this.lastHeartbeat = Date.now();
                            return;
                        }
                    }
                } catch (err) {
                    this.debugLog("Non-JSON message received");
                }
            });
        } catch (err) {
            this.error("Failed to connect to WebSocket server", err);
            this.handleWsReconnect();
        }
    }

    private handleWsReconnect() {
        this.wsConnectionAttempts++;
        if (this.wsConnectionAttempts <= WS_MAX_RETRIES) {
            const delay = Math.min(WS_RECONNECT_INTERVAL * this.wsConnectionAttempts, 30000);
            this.log(`♻️ Reconnecting in ${delay / 1000} seconds (attempt ${this.wsConnectionAttempts}/${WS_MAX_RETRIES})`);
            setTimeout(() => this.connectToWebSocketServer(), delay);
        } else {
            this.error("❌ Maximum WebSocket connection attempts reached", "");
        }
    }

    private cleanup() {
        clearInterval(this.heartbeatInterval);
        if (this.healthServer) {
            this.healthServer.close();
        }
    }

    private ensureLogsDirectory() {
        const logDir = path.dirname(DETECTION_LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }




    private validateLogFiles() {
        // Validate detections log
        if (!fs.existsSync(DETECTION_LOG_FILE)) {
            fs.writeFileSync(DETECTION_LOG_FILE, "[]");
        } else {
            this.validateJsonFile(DETECTION_LOG_FILE);
        }

        // Initialize processed triggers log
        if (!fs.existsSync(PROCESSED_LOG_FILE)) {
            fs.writeFileSync(PROCESSED_LOG_FILE, JSON.stringify({ ids: [] }));
        }

        // Initialize API debug log
        if (!fs.existsSync(DEBUG_LOG_FILE)) {
            fs.writeFileSync(DEBUG_LOG_FILE, "[]");
        }
    }

    private validateJsonFile(filePath: string) {
        try {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            if (content && !content.startsWith("[") && !content.startsWith("{")) {
                this.log(`⚠️ Invalid format in ${path.basename(filePath)}, resetting file`);
                fs.writeFileSync(filePath, filePath === DETECTION_LOG_FILE ? "[]" : "{}");
            }
        } catch (err) {
            this.error("Log validation error", err);
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

        await this.connectToWebSocketServer();
    }

    private setupEventListeners() {
        try {
            const filter = this.priceTriggerContract.filters.PriceSpikeDetected();

            this.priceTriggerContract.on(filter, async (...args: any[]) => {
                // Check processing status
                if (this.isProcessing) {
                    this.log("⚠️ Skipping event - processing in progress");
                    return;
                }

                // Check cooldown
                const now = Date.now();
                if (now - this.lastEventTime < this.EVENT_COOLDOWN) {
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

            // Create log entry AFTER getting decision
            const logEntry: PriceDetectionLogEntry = {
                id: eventId,
                type: 'price-detections',
                timestamp: new Date().toISOString(),
                priceContext: `Spike: ${changePercentNum.toFixed(2)}% | Current: $${currentPriceNum} | Previous: $${previousPriceNum}`,
                decision: JSON.stringify(tradingDecision),
                decisionLength: JSON.stringify(tradingDecision).length,
                status: "completed",
                createdAt: new Date().toISOString(),
                spikePercent: changePercentNum,
                eventTxHash: event.transactionHash,
                eventBlockNumber: event.blockNumber,
                fgi: fgiData.value,
                fgiClassification: fgiData.classification,
                tokenIn: tradingDecision.tokenIn,
                tokenOut: tradingDecision.tokenOut,
                confidence: tradingDecision.confidence
            };

            await this.appendLog(logEntry);
            this.broadcastPriceUpdate(logEntry);
            await this.markAsProcessed(eventId);
            this.log(`✅ Processing completed in ${Date.now() - startTime}ms`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";

            // Create error log entry
            const logEntry: PriceDetectionLogEntry = {
                id: eventId,
                type: 'price-detections',
                timestamp: new Date().toISOString(),
                priceContext: `Spike: ${changePercentNum.toFixed(2)}% | Current: $${currentPriceNum} | Previous: $${previousPriceNum}`,
                decision: "",
                decisionLength: 0,
                status: "failed",
                createdAt: new Date().toISOString(),
                error: errorMsg,
                spikePercent: changePercentNum,
                eventTxHash: event.transactionHash,
                eventBlockNumber: event.blockNumber,
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS
            };

            await this.appendLog(logEntry);
            this.error("Processing failed", errorMsg);
        } finally {
            this.isProcessing = false;
        }
    }


    private broadcastPriceUpdate(log: PriceDetectionLogEntry) {
        if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
            this.log("⚠️ WebSocket not connected, skipping broadcast");
            return;
        }

        try {
            const message = JSON.stringify({
                type: 'logUpdate',
                data: log
            });
            this.wsClient.send(message);
            this.debugLog(`📤 Broadcasted update for ${log.id}`);
        } catch (err) {
            this.error("WebSocket send error", err);
        }
    }

    private async markAsProcessed(id: string) {
        try {
            const release = await lock(PROCESSED_LOG_FILE, { retries: 5 });
            let processed: { ids: string[] } = { ids: [] };

            if (fs.existsSync(PROCESSED_LOG_FILE)) {
                const content = fs.readFileSync(PROCESSED_LOG_FILE, "utf-8").trim();
                processed = content ? JSON.parse(content) : { ids: [] };

                // Ensure we have an array
                if (!Array.isArray(processed.ids)) {
                    processed.ids = [];
                }
            }

            if (!processed.ids.includes(id)) {
                processed.ids.push(id);
                fs.writeFileSync(PROCESSED_LOG_FILE, JSON.stringify(processed, null, 2));
            }
            if (release) await release();
        } catch (error) {
            this.error("Failed to mark as processed", error);
        }
    }

    private parseTradingDecision(signal: string, eventId: string): TradingDecisionType {
        this.debugLog(`Raw signal (${signal.length} chars): ${signal.substring(0, 300)}${signal.length > 300 ? '...' : ''}`);

        // Create debug entry
        const debugEntry: ApiDebugEntry = {
            id: eventId,
            timestamp: new Date().toISOString(),
            prompt: "",
            rawResponse: signal,
            parsedDecision: {
                decision: 'hold',
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                reasoning: "Initial placeholder"
            }
        };

        try {
            // 1. Try to parse as JSON
            const decision = JSON.parse(signal);
            this.debugLog("✅ Successfully parsed JSON");

            // Validate and normalize
            const validated = this.validateDecisionStructure(decision);

            // Update debug entry
            debugEntry.parsedDecision = validated;
            this.appendDebugLog(debugEntry);

            return validated;
        } catch (primaryError) {
            debugEntry.error = primaryError instanceof Error ? primaryError.message : 'JSON parse failed';
            this.debugLog(`❌ JSON parse failed: ${debugEntry.error}`);
        }

        try {
            // 2. Try bracket matching
            const startIndex = signal.indexOf('{');
            const endIndex = signal.lastIndexOf('}');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                const candidate = signal.substring(startIndex, endIndex + 1);
                const parsed = JSON.parse(candidate);
                this.debugLog(`✅ Extracted JSON with bracket matching`);

                // Validate and normalize
                const validated = this.validateDecisionStructure(parsed);

                // Update debug entry
                debugEntry.parsedDecision = validated;
                this.appendDebugLog(debugEntry);

                return validated;
            }
        } catch (bracketError) {
            debugEntry.error = bracketError instanceof Error ? bracketError.message : 'Bracket matching failed';
            this.debugLog(`Bracket matching failed`);
        }

        // 3. Final fallback
        this.debugLog("❌ All parsing methods failed");
        const fallbackDecision: TradingDecisionType = {
            decision: 'hold',
            tokenIn: ZERO_ADDRESS,
            tokenOut: ZERO_ADDRESS,
            amount: "0",
            slippage: 0,
            reasoning: "FALLBACK: Could not parse decision"
        };

        // Update debug entry
        debugEntry.parsedDecision = fallbackDecision;
        debugEntry.error = "All parsing methods failed";
        this.appendDebugLog(debugEntry);

        return fallbackDecision;
    }

    private validateDecisionStructure(decision: any): TradingDecisionType {
        if (!decision || typeof decision !== 'object') {
            throw new Error("Decision must be a valid object");
        }

        // Helper function to validate and normalize addresses
        const normalizeAddress = (addr: string): string => {
            try {
                return ethers.utils.getAddress(addr);
            } catch {
                return addr; // Return original for better error messages
            }
        };

        // Normalize decision field
        const action = decision.decision?.toString().toLowerCase().trim();
        if (!action || !['buy', 'sell', 'hold'].includes(action)) {
            throw new Error(`Invalid decision type: ${decision.decision}`);
        }

        // Handle HOLD decisions
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

        // Validate token addresses
        let tokenIn = decision.tokenIn ? normalizeAddress(decision.tokenIn) : '';
        let tokenOut = decision.tokenOut ? normalizeAddress(decision.tokenOut) : '';

        // Validate token pair
        const validTokens = [STABLE_TOKEN_CHECKSUM, VOLATILE_TOKEN_CHECKSUM];
        if (!validTokens.includes(tokenIn) || !validTokens.includes(tokenOut)) {
            throw new Error(
                `Invalid token pair. Valid tokens: ${STABLE_TOKEN_CHECKSUM}, ${VOLATILE_TOKEN_CHECKSUM}`
            );
        }

        // Auto-correct token direction
        if (action === 'buy') {
            if (tokenIn === VOLATILE_TOKEN_CHECKSUM && tokenOut === STABLE_TOKEN_CHECKSUM) {
                [tokenIn, tokenOut] = [tokenOut, tokenIn];
            }
        } else if (action === 'sell') {
            if (tokenIn === STABLE_TOKEN_CHECKSUM && tokenOut === VOLATILE_TOKEN_CHECKSUM) {
                [tokenIn, tokenOut] = [tokenOut, tokenIn];
            }
        }

        // Validate token pair direction
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

        // Validate amount
        const amountStr = decision.amount?.toString() || "0";
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) {
            throw new Error(`Invalid trade amount: ${amountStr}`);
        }
        if (amount <= 0) {
            throw new Error(`Trade amount must be positive: ${amount}`);
        }

        // Amount validation based on confidence level
        const confidence = decision.confidence || 'medium';
        let maxAmount = 0.025;

        if (confidence === 'high') maxAmount = 0.04;
        if (confidence === 'low') maxAmount = 0.01;

        if (amount > maxAmount) {
            throw new Error(
                `Amount ${amount} exceeds ${maxAmount} limit for ${confidence} confidence`
            );
        }

        // Validate and normalize slippage
        let slippage = parseFloat(decision.slippage?.toString() || "1");
        if (isNaN(slippage)) {
            slippage = 1;
        }

        // Clamp between 0.1% and 5%
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

        // Create debug entry
        const debugEntry: ApiDebugEntry = {
            id: eventId,
            timestamp: new Date().toISOString(),
            prompt: prompt,
            rawResponse: "",
            parsedDecision: {
                decision: 'hold',
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                reasoning: "Initial placeholder"
            }
        };

        try {
            if (!CONFIG.VENICE_API_KEY) {
                throw new Error("VENICE_API_KEY not set in environment variables");
            }

            const rawSignal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
            debugEntry.rawResponse = rawSignal;

            if (typeof rawSignal !== "string") {
                throw new Error(`API returned non-string response: ${typeof rawSignal}`);
            }

            // Full response logging for debugging
            this.debugLog(`Full API response: ${rawSignal}`);

            // Basic validation
            const hasDecision = /"decision"\s*:\s*["']?(buy|sell|hold)["']?/i.test(rawSignal);
            const hasTokenIn = /"tokenIn"\s*:\s*["']?0x[a-fA-F0-9]{40}["']?/i.test(rawSignal);

            if (!hasDecision || !hasTokenIn) {
                this.debugLog(`⚠️ Validation failed - decision: ${hasDecision}, tokenIn: ${hasTokenIn}`);
                throw new Error("API response missing required fields");
            }

            return rawSignal;
        } catch (err) {
            // Create fallback
            const fallback: TradingDecisionType = {
                reasoning: "Error: Failed to fetch valid signal",
                decision: "hold",
                tokenIn: ZERO_ADDRESS,
                tokenOut: ZERO_ADDRESS,
                amount: "0",
                slippage: 0,
                confidence: "medium"
            };

            const fallbackString = JSON.stringify(fallback);

            // Update debug entry with error
            debugEntry.error = err instanceof Error ? err.message : "Unknown error";
            debugEntry.parsedDecision = fallback;
            this.appendDebugLog(debugEntry);

            this.error("API processing failed", err);
            return fallbackString;
        } finally {
            // Always save debug entry
            this.appendDebugLog(debugEntry);
        }
    }

    private async appendLog(entry: PriceDetectionLogEntry) {
        const lockFile = `${DETECTION_LOG_FILE}.lock`;
        const MAX_WAIT_TIME = 5000; // 5 seconds max wait
        const startTime = Date.now();

        // Wait for lock to be released
        while (fs.existsSync(lockFile)) {
            if (Date.now() - startTime > MAX_WAIT_TIME) {
                console.error("❌ Lock timeout exceeded for appendLog");
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        try {
            // Create lock file
            fs.writeFileSync(lockFile, process.pid.toString(), { flag: 'wx' });

            let logs: PriceDetectionLogEntry[] = [];
            const logExists = fs.existsSync(DETECTION_LOG_FILE);

            if (logExists) {
                try {
                    const content = fs.readFileSync(DETECTION_LOG_FILE, 'utf-8').trim();
                    logs = content ? JSON.parse(content) : [];
                } catch (err) {
                    console.error("Log read error, resetting file", err);
                    logs = [];
                }
            }

            // Find existing entry index
            const existingIndex = logs.findIndex(log => log.id === entry.id);

            if (existingIndex >= 0) {
                // Update existing entry
                logs[existingIndex] = entry;
            } else {
                // Prune oldest entries if needed
                if (logs.length >= MAX_LOG_ENTRIES) {
                    const excess = logs.length - MAX_LOG_ENTRIES + 1;
                    logs = logs.slice(excess);
                }
                logs.push(entry);
            }

            // Write to file with error handling
            try {
                fs.writeFileSync(
                    DETECTION_LOG_FILE,
                    JSON.stringify(logs, null, 2),
                    'utf-8'
                );
            } catch (writeErr) {
                console.error("❌ Critical write failure", writeErr);
            }
        } catch (lockErr) {
            console.error("Lock acquisition failed", lockErr);
        } finally {
            // Release lock
            if (fs.existsSync(lockFile)) {
                try {
                    fs.unlinkSync(lockFile);
                } catch (unlinkErr) {
                    console.error("⚠️ Lock release failed", unlinkErr);
                }
            }
        }
    }

    private async appendDebugLog(entry: ApiDebugEntry) {
        if (!CONFIG.DEBUG) return;

        const lockFile = `${DEBUG_LOG_FILE}.lock`;
        const startTime = Date.now();

        // Wait for lock
        while (fs.existsSync(lockFile)) {
            if (Date.now() - startTime > 3000) return; // 3s timeout
            await new Promise(resolve => setTimeout(resolve, 30));
        }

        try {
            // Create lock
            fs.writeFileSync(lockFile, process.pid.toString(), { flag: 'wx' });

            let logs: ApiDebugEntry[] = [];
            if (fs.existsSync(DEBUG_LOG_FILE)) {
                try {
                    logs = JSON.parse(fs.readFileSync(DEBUG_LOG_FILE, 'utf-8'));
                } catch (err) {
                    console.error("Debug log reset", err);
                }
            }

            // Update or add entry
            const index = logs.findIndex(log => log.id === entry.id);
            if (index >= 0) {
                logs[index] = entry;
            } else {
                if (logs.length >= MAX_LOG_ENTRIES) {
                    logs.shift(); // Remove oldest
                }
                logs.push(entry);
            }

            // Write to file
            fs.writeFileSync(DEBUG_LOG_FILE, JSON.stringify(logs, null, 2));
        } finally {
            // Release lock
            if (fs.existsSync(lockFile)) {
                try {
                    fs.unlinkSync(lockFile);
                } catch (err) {
                    console.error("Debug lock release error", err);
                }
            }
        }
    }

    private cleanupStaleLocks() {
        const lockFiles = [
            `${DETECTION_LOG_FILE}.lock`,
            `${DEBUG_LOG_FILE}.lock`,
            `${PROCESSED_LOG_FILE}.lock`
        ];

        lockFiles.forEach(lockPath => {
            if (fs.existsSync(lockPath)) {
                try {
                    const pid = parseInt(fs.readFileSync(lockPath, 'utf-8'));

                    // Check if process is still running
                    try {
                        process.kill(pid, 0); // Test if process exists
                    } catch (e) {
                        // Process doesn't exist - remove stale lock
                        fs.unlinkSync(lockPath);
                        this.log(`♻️ Removed stale lock: ${lockPath}`);
                    }
                } catch (err) {
                    console.error("Lock cleanup failed", err);
                }
            }
        });
    }

    private log(message: string) {
        if (CONFIG.DEBUG) {
            console.log(`[${new Date().toISOString()}] ${message}`);
        }
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


// Start the listener
const listener = new PriceTriggerListener();
listener.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log("\n🛑 Price trigger listener stopped");
    process.exit(0);
});