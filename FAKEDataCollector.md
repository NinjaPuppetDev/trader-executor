// src/utils/MockMarketDataCollector.ts
import { MarketDataState } from '../types';

export class MockMarketDataCollector {
    private symbol: string;
    private scenario: 'LONG' | 'SHORT' | 'NEUTRAL';
    private priceHistory: number[] = [];
    private lastPrice = 3000; // Starting price
    private interval: NodeJS.Timeout | null = null;

    constructor(symbol: string, scenario: 'LONG' | 'SHORT' | 'NEUTRAL' = 'LONG') {
        this.symbol = symbol;
        this.scenario = scenario;
        
        // Initialize price history
        for (let i = 0; i < 50; i++) {
            this.priceHistory.push(3000 - i);
        }
    }

    start() {
        console.log(`🚀 Started MOCK Market Data Collector for ${this.symbol} (${this.scenario} scenario)`);
        
        // Simulate market movements based on scenario
        this.interval = setInterval(() => {
            if (this.scenario === 'LONG') {
                // Simulate bullish trend: 0.1% increase every second
                this.lastPrice *= 1.001;
            } else if (this.scenario === 'SHORT') {
                // Simulate bearish trend: 0.1% decrease every second
                this.lastPrice *= 0.999;
            } else {
                // Neutral: small random fluctuations
                this.lastPrice *= 1 + (Math.random() - 0.5) * 0.0005;
            }
            
            // Update price history
            this.priceHistory.push(this.lastPrice);
            if (this.priceHistory.length > 100) this.priceHistory.shift();
            
        }, 1000);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        console.log('🛑 Mock Market Data Collector stopped');
    }

    getCurrentMarketState(): MarketDataState {
        return {
            prices: [...this.priceHistory],
            volumes: Array(this.priceHistory.length).fill(1000),
            currentPrice: this.lastPrice,
            averageVolume: 1000,
            timestamp: Date.now(),
            symbol: this.symbol,
            additional: {
                high: Math.max(...this.priceHistory),
                low: Math.min(...this.priceHistory)
            }
        };
    }
}