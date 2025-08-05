import { AppDataSource } from "./priceTriggerListener";
import { PriceDetectionLog } from "../backend/shared/entities";
import { BayesianRegressionResult, MarketRegime } from "./types";

export class HistoricalDataService {
    private static MAX_HISTORY_ITEMS = 5;

    async getRecentPriceHistory(pairId: number): Promise<PriceDetectionLog[]> {
        try {
            const repo = AppDataSource.getRepository(PriceDetectionLog);
            return await repo.find({
                where: { pairId },
                order: { timestamp: "DESC" },
                take: HistoricalDataService.MAX_HISTORY_ITEMS
            });
        } catch (error) {
            console.error('Failed to fetch price history', error);
            return [];
        }
    }

    formatHistoryForPrompt(history: PriceDetectionLog[]): string {
        if (history.length === 0) return "No recent price history available";
        
        return history.map((log, index) => {
            try {
                const decision = log.decision ? JSON.parse(log.decision) : null;
                const action = decision?.positionAction || 'hold';
                const symbol = decision?.tokenOut === log.tokenIn ? '⬆️' : '⬇️';
                
                // Safely handle nullable currentPrice
                const priceDisplay = log.currentPrice !== null ? 
                    log.currentPrice.toFixed(4) : 'N/A';
                
                return `[${index+1}]: ${new Date(log.timestamp).toLocaleTimeString()} | ` +
                       `Price: ${priceDisplay} | ` +
                       `Spike: ${log.spikePercent.toFixed(2)}% | ` +
                       `Action: ${action.toUpperCase()} ${symbol} | ` +
                       `Decision: ${decision?.decision || 'hold'} | ` +
                       `Confidence: ${decision?.confidence || 'N/A'}`;
            } catch {
                // Safely handle nullable currentPrice
                const priceDisplay = log.currentPrice !== null ? 
                    log.currentPrice.toFixed(4) : 'N/A';
                
                return `[${index+1}]: ${new Date(log.timestamp).toLocaleTimeString()} | ` +
                       `Price: ${priceDisplay} | ` +
                       `Spike: ${log.spikePercent.toFixed(2)}% | ` +
                       `Status: ${log.status}`;
            }
        }).join('\n');
    }

    analyzeTrend(history: PriceDetectionLog[], currentPrice: number | null): string {
        if (history.length < 2) return "Insufficient data for trend analysis";
        
        // Extract prices safely, filtering out null values
        const prices = history
            .map(log => log.currentPrice)
            .filter(p => p !== null) as number[];
            
        if (prices.length < 2) return "Invalid price data for trend analysis";
        
        // Extract decisions safely
        const decisions: number[] = history.map(log => {
            try {
                const decision = log.decision ? JSON.parse(log.decision) : null;
                if (decision?.decision === 'buy') return 1;
                if (decision?.decision === 'sell') return -1;
                return 0;
            } catch {
                return 0;
            }
        });
        
        // Calculate price changes
        const priceChanges: number[] = [];
        for (let i = 0; i < prices.length - 1; i++) {
            priceChanges.push(prices[i] - prices[i+1]);
        }
        const avgChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
        
        // Calculate decision consistency
        const decisionConsistency = decisions.reduce((sum, val) => sum + val, 0);
        const consistencyRatio = Math.abs(decisionConsistency) / history.length;
        
        let analysis = `- Price Trend: ${avgChange > 0 ? 'Upward ↗️' : 'Downward ↘️'} ` +
                       `(Avg Δ: ${avgChange.toFixed(4)})\n`;
        analysis += `- Decision Consistency: ${(consistencyRatio * 100).toFixed(1)}% ` +
                    `${decisionConsistency > 0 ? 'bullish' : 'bearish'}\n`;
        
        // Analyze last 3 decisions
        if (history.length >= 3) {
            const lastDecision = decisions[0] || 0;
            const secondLastDecision = decisions[1] || 0;
            const thirdLastDecision = decisions[2] || 0;
            
            // Pattern 1: Two consecutive signals in same direction
            if (lastDecision === secondLastDecision && lastDecision !== 0) {
                analysis += `- ✅ CONFIRMATION: Two consecutive ${lastDecision > 0 ? 'BUY' : 'SELL'} signals\n`;
            } 
            // Pattern 2: Signal reversal
            else if (lastDecision === -secondLastDecision && lastDecision !== 0) {
                analysis += `- ⚠️ WARNING: Recent signal reversal ` +
                            `(${secondLastDecision > 0 ? 'BUY' : 'SELL'} → ${lastDecision > 0 ? 'BUY' : 'SELL'})\n`;
            }
            // Pattern 3: Three signals alternating
            else if (lastDecision === -secondLastDecision && secondLastDecision === -thirdLastDecision) {
                analysis += `- 🔄 PATTERN: Oscillating market (alternating signals)\n`;
            }
        }
        
        // Current price vs historical (only if we have current price)
        if (currentPrice !== null) {
            const highestPrice = Math.max(...prices);
            const lowestPrice = Math.min(...prices);
            
            if (currentPrice > highestPrice) {
                analysis += `- 🚀 BREAKOUT: Current price is above recent high\n`;
            } else if (currentPrice < lowestPrice) {
                analysis += `- 🛟 SUPPORT: Current price is below recent low\n`;
            }
        }
        
        return analysis;
    }
}