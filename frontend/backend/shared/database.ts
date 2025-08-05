import "reflect-metadata";
import { DataSource } from "typeorm";
import {
    PriceDetectionLog,
    TradeExecutionLog,
    ProcessedTrigger,
    ApiDebugLog
} from "./entities";

export const AppDataSource = new DataSource({
    type: "sqlite",
    database: "data/trading-system.db",
    entities: [
        PriceDetectionLog,
        TradeExecutionLog,
        ProcessedTrigger,
        ApiDebugLog  // Add this
    ],
    synchronize: true,
    logging: false  // Reduce logging in production
});

export async function initializeDatabase() {
    try {
        await AppDataSource.initialize();
        console.log("✅ Database connected");
        return true;
    } catch (error) {
        console.error("❌ Database connection failed", error);
        return false;
    }
}