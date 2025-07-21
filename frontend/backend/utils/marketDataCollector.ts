import WebSocket from 'ws';
import { CONFIG } from './config';
import { MarketDataState } from '../types';

export class MarketDataCollector {
    private ws: WebSocket | null = null;
    private priceHistory: number[] = [];
    private volumeHistory: number[] = [];
    private additionalData = {
        high: -Infinity,
        low: Infinity,
        open: 0,
        close: 0
    };
    private currentMarketState: MarketDataState | null = null;
    private reconnectAttempts = 0;

    constructor(private symbol: string = 'ethusdt') { }

    async connect() {
        this.ws = new WebSocket(`wss://fstream.binance.com/ws/${this.symbol}@trade`);

        this.ws.on('open', () => {
            this.reconnectAttempts = 0;
            this.resetDataBuffers();
        });

        this.ws.on('message', this.processTradeData);
        this.ws.on('error', this.handleError);
        this.ws.on('close', this.handleReconnect);
    }

    private handleError = (err: Error) => {
        console.error('WebSocket error:', err);
        this.reconnect();
    };

    private handleReconnect = () => {
        this.reconnect();
    };

    private reconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    private resetDataBuffers() {
        this.priceHistory = [];
        this.volumeHistory = [];
        this.additionalData = {
            high: -Infinity,
            low: Infinity,
            open: 0,
            close: 0
        };
        this.currentMarketState = null;
    }

    private processTradeData = (rawData: string) => {
        try {
            const trade = JSON.parse(rawData);
            const price = parseFloat(trade.p);
            const volume = parseFloat(trade.q);

            // Update history
            this.priceHistory.push(price);
            this.volumeHistory.push(volume);

            // Track additional metrics
            if (this.priceHistory.length === 1) {
                this.additionalData.open = price;
            }
            this.additionalData.high = Math.max(this.additionalData.high, price);
            this.additionalData.low = Math.min(this.additionalData.low, price);
            this.additionalData.close = price;

            // Maintain buffer size
            if (this.priceHistory.length > CONFIG.dataBufferSize) {
                this.priceHistory.shift();
                this.volumeHistory.shift();
            }

            // Update market state
            this.updateMarketState();
        } catch (err) {
            console.error('Error processing trade:', err);
        }
    }

    private updateMarketState() {
        if (this.priceHistory.length < CONFIG.minDataPoints) return;

        const marketState: MarketDataState = {
            prices: [...this.priceHistory],
            volumes: [...this.volumeHistory],
            currentPrice: this.priceHistory[this.priceHistory.length - 1],
            averageVolume: this.calculateAverageVolume(),
            timestamp: Date.now(),
            symbol: this.symbol,
            regime: 'consolidating', // Placeholder, updated by Bayesian
            additional: {
                high: this.additionalData.high,
                low: this.additionalData.low,
                open: this.additionalData.open,
                close: this.additionalData.close
            }
        };

        this.currentMarketState = marketState;
    }

    private calculateAverageVolume(): number {
        return this.volumeHistory.length > 0
            ? this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length
            : 0;
    }

    public getCurrentMarketState(): MarketDataState | null {
        return this.currentMarketState;
    }

    public start() {
        this.connect();
    }

    public stop() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}