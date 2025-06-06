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
        this.contract = new ethers.Contract(
            CONFIG.CONTRACT_ADDRESS,
            CONFIG.ABI,
            this.provider
        );

        if (CONFIG.PRIVATE_KEY) {
            this.wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, this.provider);
        }

        this.isProcessing = false;
    }

    async start() {
        this.log("🚀 Starting Venice Listener");
        this.log(`📝 Contract: ${CONFIG.CONTRACT_ADDRESS}`);
        this.log(`🌐 RPC: ${CONFIG.RPC_URL}`);

        try {
            const network = await this.provider.getNetwork();
            this.log(`⛓️ Chain: ${network.name} (ID: ${network.chainId})`);

            // Verify contract connection
            try {
                const interval = await this.contract.interval();
                const promptCount = await this.contract.promptCount();
                this.log(`⏱️ Contract interval: ${interval.toString()} seconds`);
                this.log(`📋 Total prompts: ${promptCount.toString()}`);
            } catch (err) {
                this.error("❌ Failed to access contract", err);
                process.exit(1);
            }

            this.log("\n👂 Listening for RequestAnalysis events...");
            this.setupEventListeners();

        } catch (error) {
            this.error("🚨 Initialization failed", error);
            process.exit(1);
        }
    }

    private setupEventListeners() {
        // Get the event signature hash
        const eventSignature = "RequestAnalysis(uint256,string)";
        const eventTopic = ethers.utils.id(eventSignature);

        // Create the filter with proper indexed parameter handling
        const filter = {
            address: CONFIG.CONTRACT_ADDRESS,
            topics: [eventTopic]
        };

        // Set up the event listener
        this.provider.on(filter, (log) => {
            // Parse the raw log
            const event = this.contract.interface.parseLog(log);

            // Extract parameters
            const timestamp = event.args.timestamp;
            const prompt = event.args.prompt;
            const blockNumber = log.blockNumber;

            this.log("\n🔔 RequestAnalysis event detected!");
            this.log(`📝 Block: ${blockNumber}`);
            this.log(`🕒 Timestamp: ${timestamp.toString()}`);
            this.log(`💬 Prompt: "${prompt}"`);

            this.processEvent(timestamp, prompt, blockNumber);
        });

        this.log("✅ Event listener registered. Waiting for events...");
    }

    private async processEvent(timestamp: ethers.BigNumber, prompt: string, blockNumber: number) {
        if (this.isProcessing) {
            this.log("⚠️ Already processing an event. Skipping...");
            return;
        }

        this.isProcessing = true;

        try {
            this.log("📡 Calling Venice API...");
            const startTime = Date.now();
            const signal = await fetchTradingSignal(prompt, CONFIG.VENICE_API_KEY);
            const timeTaken = Date.now() - startTime;
            this.log(`✅ Received API response in ${timeTaken}ms`);
            this.log(`📋 Response: ${signal.substring(0, 100)}${signal.length > 100 ? '...' : ''}`);

            if (this.wallet) {
                await this.submitDecision(signal);
            } else {
                this.log("👀 No private key configured - skipping contract submission");
            }
        } catch (error) {
            this.error("❌ Failed to process event", error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async submitDecision(decision: string) {
        try {
            if (!this.wallet) throw new Error("No wallet configured");

            this.log("⚙️ Preparing transaction...");
            const contractWithSigner = this.contract.connect(this.wallet);

            // Get current gas price
            const gasPrice = await this.provider.getGasPrice();
            this.log(`⛽ Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);

            // Estimate gas
            let estimatedGas;
            try {
                estimatedGas = await contractWithSigner.estimateGas.receiveDecision(decision);
            } catch (err) {
                this.error("⚠️ Gas estimation failed, using fallback", err);
                estimatedGas = ethers.BigNumber.from(300000);
            }

            // Add buffer
            const gasLimit = estimatedGas.add(estimatedGas.mul(CONFIG.GAS_BUFFER_PERCENT).div(100));
            this.log(`📏 Gas limit: ${gasLimit.toString()} (${CONFIG.GAS_BUFFER_PERCENT}% buffer)`);

            // Send transaction
            this.log("✍️ Sending transaction...");
            const tx = await contractWithSigner.receiveDecision(decision, {
                gasPrice: gasPrice,
                gasLimit: gasLimit
            });

            this.log(`🔄 Transaction sent: ${tx.hash}`);
            const receipt = await tx.wait();
            this.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
            this.log(`🪙 Gas used: ${receipt.gasUsed.toString()}`);
        } catch (error) {
            this.error("❌ Failed to submit decision", error);
        }
    }

    // Helper methods for consistent logging
    private log(message: string) {
        console.log(`[${new Date().toISOString()}] ${message}`);
    }

    private error(message: string, error: any) {
        console.error(`[${new Date().toISOString()}] ${message}:`, error instanceof Error ? error.message : error);
    }
}

// Start listener
new VeniceListener().start();