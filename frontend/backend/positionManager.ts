import { AppDataSource } from "./priceTriggerListener";
import { Position } from "./shared/entities";
import { Repository } from "typeorm";

export class PositionManager {
    private positionRepo: Repository<Position>;
    
    constructor() {
        this.positionRepo = AppDataSource.getRepository(Position);
    }

    // ======================
    // Core Position Operations (Backward Compatible)
    // ======================

    async openPosition(
        pairId: number,
        symbol: string,
        direction: 'long' | 'short',
        amount: number,
        openPrice: number,
        stopLoss: number,
        takeProfit: number,
        detectionId: string
    ): Promise<Position> {
        if (await this.hasOpenPosition(pairId)) {
            throw new Error(`Cannot open position: Existing open position for pair ${pairId}`);
        }

        // Maintain backward compatibility while adding validation
        if (direction === 'long') {
            if (stopLoss >= openPrice) {
                console.warn(`⚠️ Stop loss adjustment: Was ${stopLoss} (above open price)`);
                stopLoss = openPrice * 0.995;
            }
            if (takeProfit <= openPrice) {
                console.warn(`⚠️ Take profit adjustment: Was ${takeProfit} (below open price)`);
                takeProfit = openPrice * 1.005;
            }
        } else {
            if (stopLoss <= openPrice) {
                console.warn(`⚠️ Stop loss adjustment: Was ${stopLoss} (below open price)`);
                stopLoss = openPrice * 1.005;
            }
            if (takeProfit >= openPrice) {
                console.warn(`⚠️ Take profit adjustment: Was ${takeProfit} (above open price)`);
                takeProfit = openPrice * 0.995;
            }
        }

        const position = this.positionRepo.create({
            pairId,
            symbol,
            direction,
            amount,
            openPrice,
            currentPriceAtOpen: openPrice,
            stopLoss,
            takeProfit,
            openedAt: new Date().toISOString(),
            status: 'open',
            openDetectionId: detectionId,
            sizeMultiplier: 1.0
        });
        
        return await this.positionRepo.save(position);
    }

    async closePosition(
        positionId: string,
        closePrice: number,
        closeReason: 'signal_close' | 'stop_loss' | 'take_profit' | 'liquidated' | 'manual',
        detectionId?: string
    ): Promise<Position> {
        const position = await this.getPosition(positionId);
        
        if (!position) {
            throw new Error(`Position ${positionId} not found`);
        }
        if (position.status !== 'open') {
            throw new Error(`Position ${positionId} is not open`);
        }

        // Calculate PnL (backward compatible)
        let pnl = 0;
        if (position.direction === 'long') {
            pnl = (closePrice - position.openPrice) * position.amount;
        } else {
            pnl = (position.openPrice - closePrice) * position.amount;
        }

        // Maintain existing fields while adding new calculations
        return await this.positionRepo.save({
            ...position,
            closedAt: new Date().toISOString(),
            closePrice,
            status: 'closed',
            closeReason,
            closeDetectionId: detectionId,
            pnl
        });
    }

    async updatePosition(
        positionId: string,
        update: { stopLoss?: number; takeProfit?: number }
    ): Promise<Position> {
        const position = await this.getPosition(positionId);
        
        if (!position) {
            throw new Error(`Position ${positionId} not found`);
        }
        if (position.status !== 'open') {
            throw new Error(`Cannot update closed position ${positionId}`);
        }

        // Add validation without changing types
        if (update.stopLoss !== undefined) {
            if (position.direction === 'long' && update.stopLoss >= position.openPrice) {
                console.warn(`⚠️ Stop loss adjustment: Was ${update.stopLoss} (above open price)`);
                update.stopLoss = position.openPrice * 0.995;
            }
            if (position.direction === 'short' && update.stopLoss <= position.openPrice) {
                console.warn(`⚠️ Stop loss adjustment: Was ${update.stopLoss} (below open price)`);
                update.stopLoss = position.openPrice * 1.005;
            }
        }

        return await this.positionRepo.save({
            ...position,
            ...update
        });
    }

    // ======================
    // New Features (Backward Compatible)
    // ======================

    async applyProfitProtection(
        position: Position,
        currentPrice: number
    ): Promise<Position | null> {
        const PROFIT_LOCK_THRESHOLD = 0.5;
        const TRAILING_STOP_RATIO = 0.3;
        
        let newStopLoss = position.stopLoss;
        let shouldUpdate = false;

        if (position.direction === 'long') {
            const maxProfit = position.takeProfit - position.openPrice;
            const currentProfit = currentPrice - position.openPrice;
            
            if (currentProfit > maxProfit * PROFIT_LOCK_THRESHOLD) {
                newStopLoss = position.openPrice + currentProfit * TRAILING_STOP_RATIO;
                shouldUpdate = newStopLoss > position.stopLoss;
            }
        } else {
            const maxProfit = position.openPrice - position.takeProfit;
            const currentProfit = position.openPrice - currentPrice;
            
            if (currentProfit > maxProfit * PROFIT_LOCK_THRESHOLD) {
                newStopLoss = position.openPrice - currentProfit * TRAILING_STOP_RATIO;
                shouldUpdate = newStopLoss < position.stopLoss;
            }
        }

        if (shouldUpdate) {
            return this.updatePosition(position.id, {
                stopLoss: newStopLoss
            });
        }
        
        return null;
    }

    // ======================
    // Position Queries (Unchanged)
    // ======================

    async hasOpenPosition(pairId: number): Promise<boolean> {
        const count = await this.positionRepo.count({ 
            where: { 
                pairId, 
                status: 'open' 
            } 
        });
        return count > 0;
    }

    async getOpenPosition(pairId: number): Promise<Position | null> {
        return this.positionRepo.findOne({ 
            where: { 
                pairId, 
                status: 'open' 
            },
            order: { openedAt: 'DESC' }
        });
    }

    async getOpenPositions(): Promise<Position[]> {
        return this.positionRepo.find({ 
            where: { 
                status: 'open' 
            } 
        });
    }

    async getPosition(positionId: string): Promise<Position | null> {
        return this.positionRepo.findOne({ 
            where: { id: positionId } 
        });
    }

    async getPositionHistory(pairId: number, limit = 10): Promise<Position[]> {
        return this.positionRepo.find({
            where: { pairId },
            order: { openedAt: 'DESC' },
            take: limit
        });
    }

    // ======================
    // Utility Methods (New but backward compatible)
    // ======================

    async calculateCurrentPnL(positionId: string, currentPrice: number): Promise<number> {
        const position = await this.getPosition(positionId);
        if (!position) throw new Error(`Position ${positionId} not found`);
        
        if (position.direction === 'long') {
            return (currentPrice - position.openPrice) * position.amount;
        } else {
            return (position.openPrice - currentPrice) * position.amount;
        }
    }
}