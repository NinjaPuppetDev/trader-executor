// backend/riskPositionListener.ts
import { ethers } from "ethers";
import { AppDataSource } from "../backend/shared/database";
import { RiskPosition } from "../backend/shared/entities";
import dotenv from "dotenv";
import RiskManagerAbi from "../app/abis/RiskManager.json";
import express from 'express';
import cors from 'cors';

dotenv.config();

const CONFIG = {
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    RISK_MANAGER_ADDRESS: process.env.RISK_MANAGER_ADDRESS || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
};

class RiskPositionListener {
    private provider: ethers.providers.JsonRpcProvider;
    private riskManagerContract: ethers.Contract;

    constructor() {
        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.riskManagerContract = new ethers.Contract(
            CONFIG.RISK_MANAGER_ADDRESS,
            RiskManagerAbi,
            this.provider
        );
    }

    async start() {
        await this.initializeDatabase();
        this.log("🚀 Starting Risk Position Listener");
        this.setupEventListeners();
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

    private setupEventListeners() {
        // Listen to PositionOpened from RiskManager
        this.riskManagerContract.on("PositionOpened",
            (
                positionId: string,
                trader: string,
                isLong: boolean,
                amount: ethers.BigNumber,
                entryPrice: ethers.BigNumber
            ) => {
                this.handlePositionOpened(positionId, trader, isLong, amount, entryPrice);
            }
        );

        // Listen to PositionClosed from RiskManager
        this.riskManagerContract.on("PositionClosed",
            (positionId: string, reason: string, amountOut: ethers.BigNumber) => {
                this.handlePositionClosed(positionId, reason, amountOut);
            }
        );

        this.log("👂 Listening for PositionOpened and PositionClosed events...");
    }

    private async handlePositionOpened(
        positionId: string,
        trader: string,
        isLong: boolean,
        amount: ethers.BigNumber,
        entryPrice: ethers.BigNumber
    ) {
        try {
            // Fetch risk parameters directly from RiskManager
            const positionData = await this.riskManagerContract.positions(positionId);

            const riskPosition = new RiskPosition();
            riskPosition.id = positionId;
            riskPosition.trader = trader;
            riskPosition.isLong = isLong;
            riskPosition.amount = amount.toString();
            riskPosition.entryPrice = entryPrice.toString();
            riskPosition.stopLoss = positionData.stopLoss;
            riskPosition.takeProfit = positionData.takeProfit;
            riskPosition.status = "active";
            riskPosition.createdAt = new Date();
            riskPosition.lastUpdated = new Date();

            await AppDataSource.manager.save(riskPosition);
            this.log(`📝 Saved risk position: ${positionId}`);

        } catch (error) {
            this.error("Error handling PositionOpened", error);
        }
    }

    private async handlePositionClosed(
        positionId: string,
        reason: string,
        amountOut: ethers.BigNumber
    ) {
        try {
            const repo = AppDataSource.getRepository(RiskPosition);
            const position = await repo.findOneBy({ id: positionId });

            if (position) {
                position.status = "closed";
                position.closedAt = new Date();
                position.lastUpdated = new Date();
                position.closedAmount = amountOut.toString();
                position.closedReason = reason;

                await repo.save(position);
                this.log(`📝 Updated risk position (closed): ${positionId}`);
            }
        } catch (error) {
            this.error("Error handling PositionClosed", error);
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

// Health Server and Main Execution
function startHealthServer() {
    const app = express();
    app.use(cors());

    app.get('/health', (_, res) => {
        res.json({ status: 'ok', service: 'risk-position-listener' });
    });

    const PORT = 3003;
    const server = app.listen(PORT, () => {
        console.log(`✅ Risk health server on port ${PORT}`);
    });
    return server;
}

async function main() {
    const listener = new RiskPositionListener();
    const healthServer = startHealthServer();
    await listener.start();

    process.on('SIGINT', () => {
        healthServer.close(() => process.exit(0));
    });
}

main().catch(console.error);