import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import contractAbi from "../app/abis/VeniceUpkeep.json";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { lock } from 'proper-lockfile';
import { generatePromptConfig } from "./prompts/promptService";

dotenv.config();

// Configuration
const LOG_FILE = path.join(__dirname, "logs", "venice-logs.json");
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
    prompt: string;
    decision: string;
    decisionLength: number;
    status: "pending" | "completed" | "failed";
    txHash?: string;
    blockNumber?: number;
    error?: string;
    createdAt: string;
    fgi?: number;
    fgiClassification?: string;
}

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    PRIVATE_KEY: process.env.PRIVATE_KEY || "",
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ABI: contractAbi,
    GAS_BUFFER_PERCENT: 20,
    DEBUG: true
};

class VeniceListener {
    private provider: ethers.providers.JsonRpcProvider;
    private contract: ethers.Contract;
    private wallet?: ethers.Wallet;
    private isProcessing: boolean;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, this.provider);
        this.isProcessing = false;

        if (CONFIG.PRIVATE_KEY) {
            this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
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
        this.log("🚀 Starting Venice Listener");
        this.log("💡 Using dynamic prompt generation with Fear & Greed Index");

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
        // Create event filter
        const filter = this.contract.filters.RequestAnalysis();

        // Listen for RequestAnalysis events
        this.contract.on(filter, async (timestamp, prompt, event) => {
            if (this.isProcessing) {
                this.log("⚠️ Skipping event - processing in progress");
                return;
            }

            try {
                await this.processEvent(
                    timestamp.toString(),
                    prompt,
                    event.blockNumber
                );
            } catch (err) {
                this.error("Event processing error", err);
            }
        });

        this.log("👂 Listening for RequestAnalysis events...");
    }

    private async processEvent(timestamp: string, contractPrompt: string, blockNumber?: number) {
        this.isProcessing = true;
        const eventId = `${timestamp}-${Date.now()}`;

        const logEntry: LogEntry = {
            id: eventId,
            timestamp,
            prompt: contractPrompt,
            decision: "",
            decisionLength: 0,
            status: "pending",
            createdAt: new Date().toISOString()
        };

        await this.appendLog(logEntry);
        this.log(`🔔 New analysis request (ID: ${eventId})`);

        try {
            const startTime = Date.now();

            // 1. Generate base prompt with real-time FGI data
            const basePrompt = await generatePromptConfig();

            // 2. Parse contract prompt
            const contractConfig = this.parseContractPrompt(contractPrompt);

            // 3. Merge prompts
            const mergedPrompt = this.mergePrompts(basePrompt, contractConfig);

            // 4. Fetch trading signal
            const signal = await this.fetchTradingSignal(mergedPrompt);

            // 5. Update log with FGI context
            logEntry.fgi = basePrompt.market_context?.fgi;
            logEntry.fgiClassification = basePrompt.market_context?.fgi_classification;
            logEntry.decision = signal;
            logEntry.decisionLength = signal.length;

            // 6. Submit decision
            if (this.wallet) {
                const txHash = await this.submitDecision(signal);
                logEntry.txHash = txHash;
                logEntry.blockNumber = blockNumber;
            }

            logEntry.status = "completed";
            await this.appendLog(logEntry);
            this.log(`✅ Processed in ${Date.now() - startTime}ms | FGI: ${basePrompt.market_context?.fgi} (${basePrompt.market_context?.fgi_classification})`);
        } catch (err) {
            logEntry.status = "failed";
            logEntry.error = err instanceof Error ? err.message : "Unknown error";
            await this.appendLog(logEntry);
            this.error("Processing failed", err);
        } finally {
            this.isProcessing = false;
        }
    }

    private parseContractPrompt(prompt: string): any {
        try {
            if (!prompt.trim()) return {};
            return JSON.parse(prompt);
        } catch (err) {
            this.error("Failed to parse contract prompt", err);
            return {};
        }
    }

    private mergePrompts(basePrompt: any, contractConfig: any): string {
        // Merge token mappings
        const token_mapping = {
            ...(basePrompt.token_mapping || {}),
            ...(contractConfig.token_mapping || {})
        };

        // Validate token addresses
        for (const [symbol, address] of Object.entries(token_mapping)) {
            if (!ethers.utils.isAddress(address as string)) {
                throw new Error(`Invalid token address for ${symbol}: ${address}`);
            }
        }

        // Create merged prompt
        const merged = {
            ...basePrompt,
            ...contractConfig,
            token_mapping,
            market_context: {
                ...(basePrompt.market_context || {}),
                ...(contractConfig.market_context || {})
            }
        };

        return JSON.stringify(merged);
    }

    private async fetchTradingSignal(prompt: string): Promise<string> {
        this.log("📡 Calling Venice API with populated prompt...");
        this.log(`Prompt: ${prompt.substring(0, 200)}...`);

        try {
            const rawSignal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);

            // Validate response is a string
            if (typeof rawSignal !== "string") {
                throw new Error(`API returned non-string response: ${typeof rawSignal}`);
            }

            // Enhanced JSON extraction
            let jsonResponse = this.extractJSONFromResponse(rawSignal);
            let isFallback = false;

            if (!jsonResponse) {
                // Create fallback response if no JSON found
                jsonResponse = this.createFallbackResponse(rawSignal);
                isFallback = true;
                this.log("⚠️ Using fallback JSON wrapper for response");
            }

            // Parse and validate the JSON
            const parsed = this.parseAndValidateResponse(jsonResponse);

            // For fallback responses, don't validate structure
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
        // Find the first complete JSON object
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
                        // Not valid JSON, continue searching
                        startIndex = -1;
                    }
                }
            }
        }

        // Regex fallback for JSON-like structures
        const jsonMatch = response.match(/\{[\s\S]*?\}/);
        return jsonMatch ? jsonMatch[0] : null;
    }

    private parseAndValidateResponse(jsonString: string): any {
        try {
            return JSON.parse(jsonString);
        } catch (parseError) {
            // Attempt to fix common JSON issues
            const fixedJson = jsonString
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
                .replace(/'/g, '"')
                .replace(/,\s*}/g, '}');

            try {
                return JSON.parse(fixedJson);
            } catch {
                // Final fallback
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
        return parsed &&
            parsed.decision &&
            parsed.tokenIn &&
            ["buy", "sell", "hold", "wait"].includes(parsed.decision.toLowerCase());
    }

    private createFallbackResponse(rawResponse: string): string {
        // Try to infer decision from raw response
        const lowerResponse = rawResponse.toLowerCase();
        let decision = "hold";

        if (lowerResponse.includes("buy")) decision = "buy";
        if (lowerResponse.includes("sell")) decision = "sell";
        if (lowerResponse.includes("wait")) decision = "wait";

        // Try to extract token addresses
        const addressRegex = /0x[a-fA-F0-9]{40}/g;
        const addresses = rawResponse.match(addressRegex) || [];

        // Use example token mapping as fallback
        const tokenIn = addresses[0] || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const tokenOut = addresses[1] || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

        // Truncate if too long
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

    private async submitDecision(decision: string): Promise<string> {
        if (!this.wallet) throw new Error("Wallet not configured");

        const signerContract = this.contract.connect(this.wallet);
        let decisionForContract = decision;

        if (decision.length > MAX_CONTRACT_LENGTH) {
            decisionForContract = decision.substring(0, MAX_CONTRACT_LENGTH) + "...[TRUNCATED]";
            this.log(`⚠️ Decision truncated to ${MAX_CONTRACT_LENGTH} characters`);
        }

        try {
            // Get gas price
            const gasPrice = await this.provider.getGasPrice();

            // Estimate gas with buffer
            const estimatedGas = await signerContract.estimateGas.receiveDecision(decisionForContract);
            const bufferedGas = estimatedGas.add(
                estimatedGas.mul(CONFIG.GAS_BUFFER_PERCENT).div(100)
            );

            // Send transaction
            const tx = await signerContract.receiveDecision(decisionForContract, {
                gasPrice,
                gasLimit: bufferedGas
            });

            // Wait for confirmation
            const receipt = await tx.wait();
            this.log(`📝 Decision submitted in tx ${tx.hash} (Block: ${receipt.blockNumber})`);
            return tx.hash;
        } catch (err) {
            this.error("Transaction failed", err);
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

            // Update existing entry or add new
            const index = logs.findIndex(log => log.id === entry.id);
            if (index >= 0) {
                logs[index] = entry;
            } else {
                // Maintain log size limit
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
const listener = new VeniceListener();
listener.start();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log("\n🛑 Stopping listener...");
    process.exit();
});