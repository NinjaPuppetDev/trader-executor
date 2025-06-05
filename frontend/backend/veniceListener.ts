import { ethers } from "ethers";
import { fetchTradingSignal } from "../app/utils/venice";
import contractAbi from "../app/abis/VeniceAutomation.json";

require('dotenv').config();

const CONFIG = {
    VENICE_API_KEY: "Kp1yp2V1-LUE02J1xARPvyVgaeSrlEd5kqbuLXNKhT",
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    ABI: contractAbi,
    POLLING_INTERVAL: 1000,
    GAS_BUFFER_PERCENT: 20
};

if (!CONFIG.VENICE_API_KEY) {
    console.error("❌ VENICE_API_KEY not defined in .env");
    process.exit(1);
}

console.log("🔑 Environment configuration verified");

class VeniceListener {
    private provider: ethers.providers.JsonRpcProvider;
    private contract: ethers.Contract;
    private lastProcessedBlock: number;
    private isProcessing: boolean;
    private eventQueue: { timestamp: ethers.BigNumber, prompt: string, blockNumber: number }[];

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.provider.pollingInterval = CONFIG.POLLING_INTERVAL;
        this.contract = new ethers.Contract(
            CONFIG.CONTRACT_ADDRESS,
            CONFIG.ABI,
            this.provider
        );
        this.lastProcessedBlock = 0;
        this.isProcessing = false;
        this.eventQueue = [];
    }

    async start() {
        console.log("\n🚀 Starting Venice Listener");
        console.log(`📝 Contract: ${CONFIG.CONTRACT_ADDRESS}`);
        console.log(`🌐 RPC: ${CONFIG.RPC_URL}`);

        try {
            const network = await this.provider.getNetwork();
            console.log(`⛓️ Chain: ${network.name} (ID: ${network.chainId})`);

            // Get initial block number
            const currentBlock = await this.provider.getBlockNumber();
            console.log(`⏩ Starting from block ${currentBlock}`);
            this.lastProcessedBlock = currentBlock;

            // Start listening
            this.listenForEvents();
        } catch (error) {
            console.error("🚨 Initialization failed:", error instanceof Error ? error.message : error);
            process.exit(1);
        }
    }

    private async listenForEvents() {
        console.log("\n🔍 Starting event polling...");

        // Use recursive timeout instead of setInterval to avoid overlapping executions
        const poll = async () => {
            try {
                await this.checkNewEvents();
            } catch (error) {
                console.error("⚠️ Polling error:", error instanceof Error ? error.message : error);
            } finally {
                // Schedule next poll even if errors occur
                setTimeout(poll, CONFIG.POLLING_INTERVAL);
            }
        };

        // Start the polling loop
        poll();
    }

    private async checkNewEvents() {
        try {
            const currentBlock = await this.provider.getBlockNumber();

            // Skip if no new blocks
            if (currentBlock <= this.lastProcessedBlock) {
                return;
            }

            console.log(`\n🔎 Checking blocks: ${this.lastProcessedBlock + 1} → ${currentBlock}`);

            // Create proper event filter
            const eventFilter = this.contract.filters.RequestAnalysis();

            const events = await this.contract.queryFilter(
                eventFilter,
                this.lastProcessedBlock,
                currentBlock
            );

            if (events.length > 0) {
                console.log(`📡 Found ${events.length} new event(s)`);
                for (const event of events) {
                    if (event.args && event.args.timestamp && event.args.prompt) {
                        // Add to queue instead of processing immediately
                        this.eventQueue.push({
                            timestamp: event.args.timestamp,
                            prompt: event.args.prompt,
                            blockNumber: event.blockNumber
                        });
                    } else {
                        console.warn("⚠️ Event missing arguments", event);
                    }
                }
            } else {
                console.log("🔎 No events found in block range");
            }

            this.lastProcessedBlock = currentBlock;

            // Process queue if not already processing
            if (!this.isProcessing && this.eventQueue.length > 0) {
                this.processQueue();
            }
        } catch (error) {
            console.error("❌ Event check failed:", error instanceof Error ? error.message : error);
        }
    }

    private async processQueue() {
        if (this.isProcessing || this.eventQueue.length === 0) return;

        this.isProcessing = true;
        try {
            while (this.eventQueue.length > 0) {
                const event = this.eventQueue.shift()!;
                await this.processRequest(
                    event.timestamp,
                    event.prompt,
                    event.blockNumber
                );
            }
        } catch (error) {
            console.error("❌ Queue processing failed:", error instanceof Error ? error.message : error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async processRequest(timestamp: ethers.BigNumber, prompt: string, blockNumber: number) {
        try {
            const eventTime = new Date(timestamp.toNumber() * 1000);
            console.log(`\n⏰ New event at block ${blockNumber} (${eventTime.toISOString()})`);
            console.log(`💬 Prompt: "${prompt.substring(0, 60)}${prompt.length > 60 ? '...' : ''}"`);

            console.log("📡 Calling Venice API...");
            const startTime = Date.now();

            // Call the actual API wrapper
            const signal = await fetchTradingSignal(prompt, process.env.VENICE_API_KEY!);
            const timeTaken = Date.now() - startTime;

            console.log(`✅ API response received in ${timeTaken}ms`);
            console.log(`📋 Response: ${signal.substring(0, 80)}${signal.length > 80 ? '...' : ''}`);

            if (CONFIG.PRIVATE_KEY) {
                console.log("⚙️ Preparing to submit to contract...");
                await this.submitDecision(signal);
            } else {
                console.log("👀 Read-only mode - skipping contract submission");
            }
        } catch (error) {
            console.error("❌ Processing failed:", error instanceof Error ? error.message : error);
        }
    }

    private async submitDecision(decision: string) {
        try {
            const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY!, this.provider);
            const contractWithSigner = this.contract.connect(wallet);

            // Estimate gas and add buffer
            const estimatedGas = await contractWithSigner.estimateGas.receiveDecision(decision);
            const buffer = estimatedGas.mul(CONFIG.GAS_BUFFER_PERCENT).div(100);
            const gasLimit = estimatedGas.add(buffer);

            console.log(`⛽ Gas estimate: ${estimatedGas.toString()} (+${CONFIG.GAS_BUFFER_PERCENT}% = ${gasLimit.toString()})`);

            const tx = await contractWithSigner.receiveDecision(decision, {
                gasLimit: gasLimit
            });

            console.log("✍️ Transaction submitted. Hash:", tx.hash);
            const receipt = await tx.wait();
            console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
        } catch (error) {
            console.error("❌ Failed to submit decision:", error instanceof Error ? error.message : error);
        }
    }
}

// Start listener
new VeniceListener().start();