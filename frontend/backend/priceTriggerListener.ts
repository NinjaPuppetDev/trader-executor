import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import traderAbi from "../app/abis/TradeExecutor.json";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { lock } from 'proper-lockfile';
import { generatePromptConfig } from "./prompts/promptService";

dotenv.config();

// Configuration
const LOG_FILE = path.join(__dirname, "logs", "price-trigger-logs.json");
const MAX_LOG_ENTRIES = 100;
const MAX_CONTRACT_LENGTH = 3000;

interface TradingSignal {
    reasoning?: string;
    decision: string;
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
}

interface LogEntry {
    id: string;
    timestamp: string;
    priceContext: string;
    decision: string;
    decisionLength: number;
    status: "pending" | "completed" | "failed";
    txHash?: string;
    blockNumber?: number;
    eventTxHash?: string;
    eventBlockNumber?: number;
    error?: string;
    createdAt: string;
    fgi?: number;
    fgiClassification?: string;
    spikePercent?: number;
}

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    PRIVATE_KEY: process.env.PRIVATE_KEY || "",
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
    TRADER_CONTRACT_ADDRESS: process.env.TRADER_CONTRACT_ADDRESS || "",
    ABI: PriceTriggerAbi,
    GAS_BUFFER_PERCENT: 20,
    DEBUG: true
};

class PriceTriggerListener {
    private provider: ethers.providers.JsonRpcProvider;
    private priceTriggerContract: ethers.Contract;
    private traderContract?: ethers.Contract;
    private wallet?: ethers.Wallet;
    private isProcessing: boolean;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.priceTriggerContract = new ethers.Contract(
            CONFIG.PRICE_TRIGGER_ADDRESS,
            CONFIG.ABI,
            this.provider
        );
        this.isProcessing = false;

        if (CONFIG.PRIVATE_KEY) {
            this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);

            if (CONFIG.TRADER_CONTRACT_ADDRESS) {
                this.traderContract = new ethers.Contract(
                    CONFIG.TRADER_CONTRACT_ADDRESS,
                    traderAbi,
                    this.wallet
                );
            }
        }

        this.ensureLogsDirectory();
        this.validateLogFile();
    }

    private ensureLogsDirectory() {
        const logDir = path.dirname(LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    private validateLogFile() {
        if (!fs.existsSync(LOG_FILE)) {
            fs.writeFileSync(LOG_FILE, "[]");
            return;
        }

        try {
            const content = fs.readFileSync(LOG_FILE, "utf-8").trim();
            if (content && !content.startsWith("[")) {
                this.log("⚠️ Invalid log format, resetting file");
                fs.writeFileSync(LOG_FILE, "[]");
            }
        } catch (err) {
            this.error("Log validation error", err);
        }
    }

    async start() {
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
        const filter = this.priceTriggerContract.filters.PriceSpikeDetected();

        this.priceTriggerContract.on(filter, async (currentPrice, previousPrice, changePercent, event) => {
            if (this.isProcessing) {
                this.log("⚠️ Skipping event - processing in progress");
                return;
            }

            try {
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
    }

    private async processPriceSpike(
        currentPrice: ethers.BigNumber,
        previousPrice: ethers.BigNumber,
        changePercent: ethers.BigNumber,
        event: ethers.Event
    ) {
        this.isProcessing = true;
        const eventId = `spike-${Date.now()}`;

        // Convert prices from 8 decimals (Chainlink standard)
        const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
        const previousPriceNum = parseFloat(ethers.utils.formatUnits(previousPrice, 8));
        const changePercentNum = parseFloat(ethers.utils.formatUnits(changePercent, 2)); // Basis points

        const logEntry: LogEntry = {
            id: eventId,
            timestamp: new Date().toISOString(),
            priceContext: `Spike: ${changePercentNum.toFixed(2)}% | Current: $${currentPriceNum} | Previous: $${previousPriceNum}`,
            decision: "",
            decisionLength: 0,
            status: "pending",
            createdAt: new Date().toISOString(),
            spikePercent: changePercentNum,
            eventTxHash: event.transactionHash,
            eventBlockNumber: event.blockNumber
        };

        await this.appendLog(logEntry);
        this.log(`🔔 Price spike detected! ${changePercentNum.toFixed(2)}% change in tx ${event.transactionHash}`);

        try {
            const startTime = Date.now();

            // Generate prompt with price context
            const basePrompt = await generatePromptConfig();
            const enhancedPrompt = this.enhancePromptWithSpike(
                basePrompt,
                currentPriceNum,
                previousPriceNum,
                changePercentNum
            );

            // Get trading signal
            const signal = await this.fetchTradingSignal(JSON.stringify(enhancedPrompt));

            // Update log with context
            logEntry.fgi = basePrompt.market_context?.fgi;
            logEntry.fgiClassification = basePrompt.market_context?.fgi_classification;
            logEntry.decision = signal;
            logEntry.decisionLength = signal.length;

            // Execute trade if trader contract available
            if (this.traderContract) {
                const txHash = await this.executeTradeDecision(signal);
                logEntry.txHash = txHash;
                logEntry.blockNumber = await this.provider.getBlockNumber();
            }

            logEntry.status = "completed";
            await this.appendLog(logEntry);
            this.log(`✅ Trade executed in ${Date.now() - startTime}ms`);
        } catch (err) {
            logEntry.status = "failed";
            logEntry.error = err instanceof Error ? err.message : "Unknown error";
            await this.appendLog(logEntry);
            this.error("Processing failed", err);
        } finally {
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
        const volatilityLevel = this.getVolatilityLevel(changePercent);

        return {
            ...basePrompt,
            market_context: {
                ...(basePrompt.market_context || {}),
                price_event: {
                    type: "spike",
                    direction,
                    change_percent: changePercent,
                    current_price: currentPrice,
                    previous_price: previousPrice,
                    volatility_level: volatilityLevel
                }
            },
            instructions: `${basePrompt.instructions}\n\nIMPORTANT: This analysis was triggered by a ${changePercent.toFixed(2)}% price ${direction} movement (${volatilityLevel} volatility). 
Pay special attention to momentum indicators and potential reversal signals.`
        };
    }

    private getVolatilityLevel(changePercent: number): string {
        if (changePercent < 2) return "low";
        if (changePercent < 5) return "medium";
        if (changePercent < 10) return "high";
        return "extreme";
    }

    private async fetchTradingSignal(prompt: string): Promise<string> {
        this.log("📡 Calling Venice API with populated prompt...");
        this.log(`Prompt: ${prompt.substring(0, 200)}...`);

        try {
            const rawSignal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);

            if (typeof rawSignal !== "string") {
                throw new Error(`API returned non-string response: ${typeof rawSignal}`);
            }

            // Extract JSON from response
            let jsonResponse = this.extractJSONFromResponse(rawSignal);
            let isFallback = false;

            if (!jsonResponse) {
                jsonResponse = this.createFallbackResponse(rawSignal);
                isFallback = true;
                this.log("⚠️ Using fallback JSON wrapper for response");
            }

            // Parse and validate
            const parsed = this.parseAndValidateResponse(jsonResponse);

            if (!isFallback && !this.isValidSignal(parsed)) {
                throw new Error("Response missing required fields: decision or tokenIn");
            }

            return JSON.stringify(parsed);
        } catch (err) {
            this.error("API processing failed", err);
            return this.createErrorResponse(err);
        }
    }

    private extractJSONFromResponse(response: string): string | null {
        let openBraces = 0;
        let startIndex = -1;

        for (let i = 0; i < response.length; i++) {
            if (response[i] === '{') {
                if (openBraces === 0) startIndex = i;
                openBraces++;
            } else if (response[i] === '}') {
                openBraces--;
                if (openBraces === 0 && startIndex !== -1) {
                    const candidate = response.substring(startIndex, i + 1);
                    try {
                        JSON.parse(candidate);
                        return candidate;
                    } catch {
                        startIndex = -1;
                    }
                }
            }
        }

        const jsonMatch = response.match(/\{[\s\S]*?\}/);
        return jsonMatch ? jsonMatch[0] : null;
    }

    private parseAndValidateResponse(jsonString: string): any {
        try {
            return JSON.parse(jsonString);
        } catch (parseError) {
            try {
                // Attempt to repair common JSON issues
                const fixedJson = jsonString
                    .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
                    .replace(/'/g, '"')
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']');

                return JSON.parse(fixedJson);
            } catch {
                return {
                    reasoning: "Invalid JSON: " + jsonString.substring(0, 200),
                    decision: "hold",
                    tokenIn: "",
                    tokenOut: "",
                    amount: "0",
                    slippage: 1
                };
            }
        }
    }

    private isValidSignal(parsed: any): boolean {
        return parsed?.decision && parsed?.tokenIn &&
            ["buy", "sell", "hold", "wait"].includes(parsed.decision.toLowerCase());
    }

    private createFallbackResponse(rawResponse: string): string {
        const lowerResponse = rawResponse.toLowerCase();
        let decision = "hold";

        if (lowerResponse.includes("buy")) decision = "buy";
        if (lowerResponse.includes("sell")) decision = "sell";
        if (lowerResponse.includes("wait")) decision = "wait";

        const addressRegex = /0x[a-fA-F0-9]{40}/g;
        const addresses = rawResponse.match(addressRegex) || [];
        const tokenIn = addresses[0] || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH
        const tokenOut = addresses[1] || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC

        const truncated = rawResponse.length > 500
            ? rawResponse.substring(0, 500) + "..."
            : rawResponse;

        return JSON.stringify({
            reasoning: "Fallback: " + truncated,
            decision: decision,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amount: "0",
            slippage: 1
        });
    }

    private createErrorResponse(error: any): string {
        return JSON.stringify({
            reasoning: "Error: " + (error instanceof Error ? error.message : "Unknown error"),
            decision: "hold",
            tokenIn: "",
            tokenOut: "",
            amount: "0",
            slippage: 1
        });
    }

    private async executeTradeDecision(decision: string): Promise<string> {
        if (!this.wallet || !this.traderContract) {
            throw new Error("Trader configuration not available");
        }

        let decisionForContract = decision;
        if (decision.length > MAX_CONTRACT_LENGTH) {
            decisionForContract = decision.substring(0, MAX_CONTRACT_LENGTH) + "...[TRUNCATED]";
            this.log(`⚠️ Decision truncated to ${MAX_CONTRACT_LENGTH} characters`);
        }

        try {
            const gasPrice = await this.provider.getGasPrice();
            const estimatedGas = await this.traderContract.estimateGas.executeTrade(decisionForContract);
            const bufferedGas = estimatedGas.add(
                estimatedGas.mul(CONFIG.GAS_BUFFER_PERCENT).div(100)
            );

            const tx = await this.traderContract.executeTrade(decisionForContract, {
                gasPrice,
                gasLimit: bufferedGas
            });

            const receipt = await tx.wait();
            this.log(`📝 Trade executed in tx ${tx.hash} (Block: ${receipt.blockNumber})`);
            return tx.hash;
        } catch (err) {
            this.error("Trade execution failed", err);
            throw err;
        }
    }

    private async appendLog(entry: LogEntry) {
        let release;
        try {
            release = await lock(LOG_FILE, { retries: { retries: 5, minTimeout: 100 } });
            let logs: LogEntry[] = [];

            if (fs.existsSync(LOG_FILE)) {
                const content = fs.readFileSync(LOG_FILE, "utf-8").trim();
                logs = content ? JSON.parse(content) : [];
            }

            const index = logs.findIndex(log => log.id === entry.id);
            if (index >= 0) {
                logs[index] = entry;
            } else {
                if (logs.length >= MAX_LOG_ENTRIES) logs.shift();
                logs.push(entry);
            }

            fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
        } catch (err) {
            console.error("❌ Critical log failure:", err);
            console.error("FALLBACK LOG:", JSON.stringify(entry));
        } finally {
            if (release) await release();
        }
    }

    private log(message: string) {
        if (CONFIG.DEBUG) {
            console.log(`[${new Date().toISOString()}] ${message}`);
        }
    }

    private error(message: string, error: unknown) {
        console.error(`[${new Date().toISOString()}] ❌ ${message}`);
        if (error instanceof Error) {
            console.error(error.stack || error.message);
        } else {
            console.error(error);
        }
    }
}

// Start the listener
const listener = new PriceTriggerListener();
listener.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log("\n🛑 Stopping price trigger listener...");
    process.exit();
});