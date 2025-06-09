import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import contractAbi from "../app/abis/VeniceAutomation.json";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { lock } from 'proper-lockfile';

dotenv.config();

// Configuration
const LOG_FILE = path.join(__dirname, "logs", "venice-logs.json");
const MAX_LOG_ENTRIES = 100;
const MAX_CONTRACT_LENGTH = 3000;

const CONFIG = {
    VENICE_API_KEY: process.env.VENICE_API_KEY || "",
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ABI: contractAbi,
    GAS_BUFFER_PERCENT: 20,
    DEBUG: true
};

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
}

class VeniceListener {
    private provider: ethers.providers.JsonRpcProvider;
    private contract: ethers.Contract;
    private wallet?: ethers.Wallet;
    private isProcessing: boolean;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.ABI, this.provider);

        if (CONFIG.PRIVATE_KEY) {
            this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
        }

        this.isProcessing = false;
        this.ensureLogsDirectory();
        this.validateLogFile();
    }

    private validateLogFile() {
        if (fs.existsSync(LOG_FILE)) {
            try {
                const content = fs.readFileSync(LOG_FILE, "utf-8").trim();
                if (content && !content.startsWith("[")) {
                    this.log("⚠️ Invalid log file format, resetting");
                    fs.writeFileSync(LOG_FILE, "[]");
                }
            } catch (err) {
                this.error("Error validating log file", err);
                try {
                    fs.writeFileSync(LOG_FILE, "[]");
                } catch (writeErr) {
                    this.error("Failed to reset log file", writeErr);
                }
            }
        }
    }

    private ensureLogsDirectory() {
        const logDir = path.dirname(LOG_FILE);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    async start() {
        this.log("🚀 Starting Venice Listener");
        try {
            const network = await this.provider.getNetwork();
            this.log(`⛓️ Connected to: ${network.name} (ID: ${network.chainId})`);

            const interval = await this.contract.interval();
            const promptCount = await this.contract.promptCount();
            this.log(`⏱️ Interval: ${interval}s | 📊 Prompts: ${promptCount}`);

            this.setupEventListeners();
        } catch (error) {
            this.error("Initialization failed", error);
            process.exit(1);
        }
    }

    private setupEventListeners() {
        const eventTopic = ethers.utils.id("RequestAnalysis(uint256,string)");

        this.provider.on({
            address: CONFIG.CONTRACT_ADDRESS,
            topics: [eventTopic]
        }, async (log) => {
            try {
                const event = this.contract.interface.parseLog(log);
                const { timestamp, prompt } = event.args;
                await this.processEvent(timestamp, prompt, log.blockNumber);
            } catch (err) {
                this.error("Event parsing failed", err);
            }
        });
    }

    private async processEvent(timestamp: ethers.BigNumber, prompt: string, blockNumber?: number) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const eventId = Date.now().toString();
        const logEntry: LogEntry = {
            id: eventId,
            timestamp: timestamp.toString(),
            prompt,
            decision: "",
            decisionLength: 0,
            status: "pending",
            createdAt: new Date().toISOString()
        };

        await this.appendLog(logEntry);

        try {
            this.log("📡 Calling Venice API...");
            const startTime = Date.now();
            const signal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);

            logEntry.decision = signal;
            logEntry.decisionLength = signal.length;
            logEntry.status = "completed";

            if (this.wallet) {
                const txHash = await this.submitDecision(signal);
                logEntry.txHash = txHash;
                logEntry.blockNumber = blockNumber;
            }

            await this.appendLog(logEntry);
            this.log(`✅ Processed in ${Date.now() - startTime}ms`);
        } catch (err) {
            logEntry.status = "failed";
            logEntry.error = err instanceof Error ? err.message : "Unknown error";
            await this.appendLog(logEntry);
            this.error("Processing failed", err);
        } finally {
            this.isProcessing = false;
        }
    }

    private async appendLog(entry: LogEntry) {
        let release: (() => Promise<void>) | undefined;
        try {
            release = await lock(LOG_FILE, { retries: 3 });

            let logs: LogEntry[] = [];
            if (fs.existsSync(LOG_FILE)) {
                const content = fs.readFileSync(LOG_FILE, "utf-8").trim();
                if (content) logs = JSON.parse(content);
            }

            const index = logs.findIndex(log => log.id === entry.id);
            if (index >= 0) {
                logs[index] = entry;
            } else {
                if (logs.length >= MAX_LOG_ENTRIES) logs.shift();
                logs.push(entry);
            }

            const tempFile = LOG_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(logs, null, 2));
            fs.renameSync(tempFile, LOG_FILE);
        } catch (err: unknown) {
            this.error("Log append failed", err);
            console.error("FALLBACK LOG:", JSON.stringify(entry));
        } finally {
            if (release) {
                try {
                    await release();
                } catch (err: unknown) {
                    this.error("Lock release failed", err);
                }
            }
        }
    }

    private async submitDecision(decision: string): Promise<string> {
        if (!this.wallet) throw new Error("Wallet not configured");

        const signerContract = this.contract.connect(this.wallet);
        let decisionForContract = decision;

        if (decision.length > MAX_CONTRACT_LENGTH) {
            decisionForContract = decision.substring(0, MAX_CONTRACT_LENGTH) + "...[TRUNCATED]";
        }

        const gasPrice = await this.provider.getGasPrice();
        let estimatedGas = ethers.BigNumber.from(500000); // Default fallback

        try {
            estimatedGas = await signerContract.estimateGas.receiveDecision(decisionForContract);
            estimatedGas = estimatedGas.add(estimatedGas.mul(CONFIG.GAS_BUFFER_PERCENT).div(100));
        } catch (err) {
            this.error("Gas estimation failed", err);
        }

        const tx = await signerContract.receiveDecision(decisionForContract, {
            gasPrice,
            gasLimit: estimatedGas
        });

        await tx.wait();
        return tx.hash;
    }

    private log(message: string) {
        if (CONFIG.DEBUG) {
            console.log(`[${new Date().toISOString()}] ${message}`);
        }
    }

    private error(message: string, error: unknown) {
        console.error(`[${new Date().toISOString()}] ❌ ${message}`, error instanceof Error ? error.message : error);
    }
}

new VeniceListener().start();