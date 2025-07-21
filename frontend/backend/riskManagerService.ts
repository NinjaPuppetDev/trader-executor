// backend/riskManagerService.ts
import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { RiskPosition } from "../backend/shared/entities";
import dotenv from 'dotenv';
import RiskManagerAbi from "../app/abis/RiskManager.json";
import express from 'express';
import cors from 'cors';
import http from 'http';
import PriceTriggerAbi from "../app/abis/PriceTrigger.json";
import { getLogger } from "./shared/logger";

dotenv.config();

const logger = getLogger('risk-position-listener');

const CONFIG = {
    RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
    RISK_MANAGER_ADDRESS: process.env.RISK_MANAGER_ADDRESS || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
    PRICE_TRIGGER_ADDRESS: process.env.PRICE_TRIGGER_ADDRESS || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    TRADING_PAIR: process.env.TRADING_PAIR || "ethusdt",
    DYNAMIC_SL_INTERVAL: 30000,
    DB_PATH: "data/trading-db.sqlite"
};

class RiskPositionListener {
    private provider: ethers.providers.JsonRpcProvider;
    private riskManagerContract: ethers.Contract;
    private priceTriggerContract: ethers.Contract;
    private dynamicSlInterval: NodeJS.Timeout | null = null;
    private healthServer: http.Server | null = null;
    private dataSource: DataSource;

    constructor() {
        // Suppress debug logs
        ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR);
        
        this.dataSource = new DataSource({
            type: "sqlite",
            database: CONFIG.DB_PATH,
            entities: [RiskPosition],
            synchronize: true,
            logging: false
        });

        this.provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
        this.riskManagerContract = new ethers.Contract(
            CONFIG.RISK_MANAGER_ADDRESS,
            RiskManagerAbi,
            this.provider
        );
        
        this.priceTriggerContract = new ethers.Contract(
            CONFIG.PRICE_TRIGGER_ADDRESS,
            PriceTriggerAbi,
            this.provider
        );
    }

    async start() {
        await this.initializeDatabase();
        logger.info("🚀 Starting Risk Position Listener");
        this.setupEventListeners();
        this.startDynamicStopLossMonitor();
        this.startHealthServer();
    }

    private async initializeDatabase() {
        try {
            await this.dataSource.initialize();
            logger.info("✅ Database connected");
        } catch (error) {
            logger.error("Database initialization failed", error);
            process.exit(1);
        }
    }

    private setupEventListeners() {
        const eventNames = Object.keys(this.riskManagerContract.interface.events);
        
        if (eventNames.includes("PositionOpened")) {
            this.riskManagerContract.on("PositionOpened",
                async (
                    positionId: string,
                    trader: string,
                    isLong: boolean,
                    amount: ethers.BigNumber,
                    entryPrice: ethers.BigNumber,
                    event: ethers.Event
                ) => {
                    await this.handlePositionOpened(
                        positionId, 
                        trader, 
                        isLong, 
                        amount, 
                        entryPrice,
                        event
                    );
                }
            );
            logger.info("👂 Listening for PositionOpened events...");
        }
    
        if (eventNames.includes("PositionClosed")) {
            this.riskManagerContract.on("PositionClosed",
                async (positionId: string, reason: string, amountOut: ethers.BigNumber, event: ethers.Event) => {
                    await this.handlePositionClosed(positionId, reason, amountOut, event);
                }
            );
            logger.info("👂 Listening for PositionClosed events...");
        }
    
        if (eventNames.includes("StopLossUpdated")) {
            this.riskManagerContract.on("StopLossUpdated",
                async (positionId: string, newStopLoss: ethers.BigNumber, event: ethers.Event) => {
                    await this.handleStopLossUpdated(positionId, newStopLoss, event);
                }
            );
            logger.info("👂 Listening for StopLossUpdated events...");
        } else {
            logger.warn("⚠️ StopLossUpdated event not found in ABI. Stop-loss updates will not be tracked");
        }
    }

    private async handlePositionOpened(
        positionId: string,
        trader: string,
        isLong: boolean,
        amount: ethers.BigNumber,
        entryPrice: ethers.BigNumber,
        event: ethers.Event
    ) {
        try {
            const positionData = await this.riskManagerContract.positions(positionId);
            
            const riskPosition = new RiskPosition();
            riskPosition.id = positionId;
            riskPosition.trader = trader;
            riskPosition.isLong = isLong;
            riskPosition.amount = amount.toString();
            riskPosition.entryPrice = ethers.utils.formatUnits(entryPrice, 8);
            riskPosition.stopLoss = parseFloat(ethers.utils.formatUnits(positionData.stopLoss, 8));
            riskPosition.takeProfit = parseFloat(ethers.utils.formatUnits(positionData.takeProfit, 8));
            riskPosition.status = "active";
            riskPosition.createdAt = new Date();
            riskPosition.lastUpdated = new Date();

            riskPosition.metadata = JSON.stringify({
                eventTxHash: event.transactionHash,
                eventBlockNumber: event.blockNumber,
                dynamicSlEnabled: true,
                dynamicSlOffset: "0.5",
                dynamicSlType: isLong ? "trailing" : "break-even"
            });

            await this.dataSource.manager.save(riskPosition);
            
            logger.info(`📝 Opened position: ${positionId} | ` +
                        `Type: ${isLong ? 'LONG' : 'SHORT'} | ` +
                        `Entry: ${riskPosition.entryPrice} | ` +
                        `SL: ${riskPosition.stopLoss} | ` +
                        `TP: ${riskPosition.takeProfit}`);

        } catch (error) {
            logger.error("Error handling PositionOpened", error);
        }
    }

    private async handlePositionClosed(
        positionId: string,
        reason: string,
        amountOut: ethers.BigNumber,
        event: ethers.Event
    ) {
        try {
            const repo = this.dataSource.getRepository(RiskPosition);
            const position = await repo.findOneBy({ id: positionId });

            if (position) {
                position.status = "closed";
                position.closedAt = new Date();
                position.lastUpdated = new Date();
                position.closedAmount = ethers.utils.formatUnits(amountOut, 8);
                position.closedReason = reason;

                const metadata = position.metadata ? JSON.parse(position.metadata) : {};
                metadata.closeTxHash = event.transactionHash;
                metadata.closeBlockNumber = event.blockNumber;
                position.metadata = JSON.stringify(metadata);

                await repo.save(position);
                logger.info(`📝 Closed position: ${positionId} | Reason: ${reason} | ` +
                            `Out: ${position.closedAmount}`);
            }
        } catch (error) {
            logger.error("Error handling PositionClosed", error);
        }
    }

    private async handleStopLossUpdated(
        positionId: string,
        newStopLoss: ethers.BigNumber,
        event: ethers.Event
    ) {
        try {
            const repo = this.dataSource.getRepository(RiskPosition);
            const position = await repo.findOneBy({ id: positionId });
            
            if (position) {
                const newSl = parseFloat(ethers.utils.formatUnits(newStopLoss, 8));
                position.stopLoss = newSl;
                position.lastUpdated = new Date();
                
                const metadata = position.metadata ? JSON.parse(position.metadata) : {};
                metadata.slUpdateTxHash = event.transactionHash;
                metadata.slUpdateBlockNumber = event.blockNumber;
                position.metadata = JSON.stringify(metadata);
                
                await repo.save(position);
                logger.info(`📝 Updated SL for position ${positionId}: ${newSl}`);
            }
        } catch (error) {
            logger.error(`Error updating stop loss for position ${positionId}`, error);
        }
    }

    private startDynamicStopLossMonitor() {
        this.dynamicSlInterval = setInterval(async () => {
            try {
                await this.adjustDynamicStopLosses();
            } catch (error) {
                logger.error("Error in dynamic SL monitor", error);
            }
        }, CONFIG.DYNAMIC_SL_INTERVAL);
        
        logger.info("🔄 Started dynamic stop loss monitor");
    }

    private async adjustDynamicStopLosses() {
        try {
            const repo = this.dataSource.getRepository(RiskPosition);
            const activePositions = await repo.find({ where: { status: "active" } });
            
            if (activePositions.length === 0) return;
            
            const currentPrice = await this.priceTriggerContract.getLatestPrice();
            const currentPriceNum = parseFloat(ethers.utils.formatUnits(currentPrice, 8));
            
            for (const position of activePositions) {
                try {
                    if (!position.metadata) continue;
                    
                    const metadata = JSON.parse(position.metadata);
                    if (!metadata.dynamicSlEnabled) continue;
                    
                    const entryPrice = parseFloat(position.entryPrice);
                    const currentSl = position.stopLoss;
                    const offset = parseFloat(metadata.dynamicSlOffset || "0.5");
                    const slType = metadata.dynamicSlType || "trailing";
                    
                    let newSl = currentSl;
                    
                    if (slType === "trailing") {
                        if (position.isLong) {
                            newSl = Math.max(
                                currentSl, 
                                currentPriceNum * (1 - offset/100)
                            );
                        } else {
                            newSl = Math.min(
                                currentSl, 
                                currentPriceNum * (1 + offset/100)
                            );
                        }
                    } else if (slType === "break-even") {
                        if (position.isLong && currentPriceNum > entryPrice) {
                            newSl = entryPrice * (1 + offset/100);
                        } else if (!position.isLong && currentPriceNum < entryPrice) {
                            newSl = entryPrice * (1 - offset/100);
                        }
                    }
                    
                    if (newSl !== currentSl) {
                        const newSlBN = ethers.utils.parseUnits(newSl.toFixed(8), 8);
                        
                        const tx = await this.riskManagerContract.updateStopLoss(
                            position.id, 
                            newSlBN
                        );
                        await tx.wait();
                        
                        logger.info(`🔄 Adjusted SL for ${position.id}: ${currentSl} → ${newSl}`);
                    }
                } catch (error) {
                    logger.error(`Error adjusting SL for position ${position.id}`, error);
                }
            }
        } catch (error) {
            logger.error("Error adjusting dynamic stop losses", error);
        }
    }

    private startHealthServer() {
        const app = express();
        app.use(cors());

        app.get('/health', (_, res) => {
            res.json({ 
                status: 'ok', 
                service: 'risk-position-listener',
                features: ['position-tracking', 'dynamic-sl']
            });
        });

        app.get('/positions', async (_, res) => {
            try {
                const repo = this.dataSource.getRepository(RiskPosition);
                const positions = await repo.find();
                res.json(positions.map(p => ({
                    ...p,
                    metadata: p.metadata ? JSON.parse(p.metadata) : {}
                })));
            } catch (error) {
                res.status(500).json({ error: 'Database query failed' });
            }
        });

        const PORT = 3003;
        this.healthServer = app.listen(PORT, () => {
            logger.info(`✅ Risk health server on port ${PORT}`);
        });
    }

    public stop() {
        if (this.dynamicSlInterval) {
            clearInterval(this.dynamicSlInterval);
            logger.info("🛑 Dynamic stop loss monitor stopped");
        }
        
        if (this.healthServer) {
            this.healthServer.close(() => {
                logger.info("🛑 Health server stopped");
            });
        }
        
        if (this.dataSource.isInitialized) {
            this.dataSource.destroy();
            logger.info("🛑 Database connection closed");
        }
    }
}

async function main() {
    const listener = new RiskPositionListener();
    await listener.start();

    const shutdown = () => {
        logger.info("🛑 Shutting down...");
        listener.stop();
        setTimeout(() => process.exit(0), 1000);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(error => {
    logger.error("Fatal error in risk position listener", error);
    process.exit(1);
});