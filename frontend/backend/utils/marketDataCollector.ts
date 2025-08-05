// MarketDataCollector.ts
import WebSocket from 'ws';
import { CONFIG } from './config';
import { MarketDataState, OHLC, OrderBookSnapshot } from '../types';
import fetch from 'node-fetch';

export class MarketDataCollector {
    private wsTrade: WebSocket | null = null;
    private wsOrderBook: WebSocket | null = null;
    private ohlcHistory: OHLC[] = [];
    private currentCandle: OHLC | null = null;
    private candleStartTime = 0;
    private tradeReconnectAttempts = 0;
    private orderBookReconnectAttempts = 0;
    private lastPrice: number | null = null;
    private lastTradeMessageTime = 0;
    private lastOrderBookMessageTime = 0;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private isActive = false;
    private candleCloseTimeout: NodeJS.Timeout | null = null;
    private currentMarketState: MarketDataState | null = null;
    private orderBook: OrderBookSnapshot = { bids: [], asks: [], timestamp: 0 };
    private tradeFlow = { buyVolume: 0, sellVolume: 0, delta: 0 };
    private historicalDataLoaded = false;
    private maxHistoricalCandles: number;

    constructor(private symbol: string = 'ethusdt') {
        // Calculate desired historical candles (7 days)
        const candlesPerDay = (24 * 60) / (CONFIG.candleInterval / 60000);
        const desiredCandles = Math.ceil(candlesPerDay * 7);
        
        // Binance API only allows max 1000 candles per request
        this.maxHistoricalCandles = Math.min(desiredCandles, 1000);
        
        this.log(`📊 Will fetch ${this.maxHistoricalCandles} historical candles (max allowed)`);
    }

    async connect() {
        this.isActive = true;
        await this.initializeHistoricalData();
        this.connectTradeWebSocket();
        this.connectOrderBookWebSocket();
        this.startHeartbeat();
    }

    private async initializeHistoricalData() {
        try {
            // Fetch historical candles
            const candles = await this.fetchHistoricalOHLC(CONFIG.candleInterval);
            this.ohlcHistory = candles;
            
            if (candles.length > 0) {
                this.lastPrice = candles[candles.length - 1].close;
                this.log(`📜 Loaded ${candles.length} historical ${CONFIG.candleInterval/60000}-min candles`);
            } else {
                this.log('⚠️ No historical candles loaded');
            }
            
            // Fetch initial order book
            this.orderBook = await this.fetchOrderBookSnapshot();
            this.historicalDataLoaded = true;
            this.log(`📊 Loaded initial order book with ${this.orderBook.bids.length} bids and ${this.orderBook.asks.length} asks`);
        } catch (err) {
            this.error('Historical initialization failed', err);
            this.historicalDataLoaded = false;
        }
    }

    private async fetchHistoricalOHLC(intervalMs: number): Promise<OHLC[]> {
        const intervalMinutes = intervalMs / 60000;
        const binanceInterval = this.getBinanceInterval(intervalMinutes);
        
        try {
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${this.symbol.toUpperCase()}&interval=${binanceInterval}&limit=${this.maxHistoricalCandles}`;
            this.log(`🔍 Fetching historical data from: ${url}`);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorBody}`);
            }
            
            const klines = await response.json();
            return klines.map((k: any) => ({
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                timestamp: k[0],
                openTime: k[0],
                closeTime: k[6],
                buyVolume: 0,  // Binance doesn't provide separate volumes
                sellVolume: 0
            }));
        } catch (err) {
            this.error(`Failed to fetch historical OHLC for interval ${binanceInterval}`, err);
            return [];
        }
    }

    private getBinanceInterval(minutes: number): string {
        // Supported Binance intervals
        const binanceIntervals: Record<string, number> = {
            '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
            '1h': 60, '2h': 120, '4h': 240, '6h': 360, '8h': 480,
            '12h': 720, '1d': 1440, '3d': 4320, '1w': 10080, '1M': 43200
        };

        // Find closest match
        let closestInterval = '15m';
        let smallestDiff = Infinity;
        
        for (const [key, value] of Object.entries(binanceIntervals)) {
            const diff = Math.abs(minutes - value);
            if (diff < smallestDiff) {
                smallestDiff = diff;
                closestInterval = key;
            }
        }

        // Log if there's a mismatch
        if (smallestDiff > 0) {
            this.log(`⚠️ Using ${closestInterval} Binance interval for ${minutes}-min candles (difference: ${smallestDiff}min)`);
        }
        
        return closestInterval;
    }

    private async fetchOrderBookSnapshot(): Promise<OrderBookSnapshot> {
        try {
            const response = await fetch(
                `https://fapi.binance.com/fapi/v1/depth?symbol=${this.symbol.toUpperCase()}&limit=1000`
            );
            
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorBody}`);
            }
            
            const data = await response.json();
            return {
                bids: data.bids.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
                asks: data.asks.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
                timestamp: data.lastUpdateId
            };
        } catch (err) {
            this.error('Failed to fetch order book snapshot', err);
            return { bids: [], asks: [], timestamp: 0 };
        }
    }

    private connectTradeWebSocket() {
        this.cleanupTradeWebSocket();
        
        const wsUrl = `wss://fstream.binance.com/ws/${this.symbol}@trade`;
        this.log(`🔗 Connecting to trade WebSocket: ${wsUrl}`);
        
        this.wsTrade = new WebSocket(wsUrl, {
            handshakeTimeout: 15000,
            perMessageDeflate: false
        });

        this.wsTrade.on('open', () => {
            this.tradeReconnectAttempts = 0;
            this.log(`✅ Trade WebSocket connected`);
            this.lastTradeMessageTime = Date.now();
            this.scheduleCandleClose();
        });

        this.wsTrade.on('message', (data: string) => {
            this.lastTradeMessageTime = Date.now();
            this.processTradeData(data);
        });

        this.wsTrade.on('ping', () => this.wsTrade?.pong());
        this.wsTrade.on('pong', () => this.lastTradeMessageTime = Date.now());
        this.wsTrade.on('error', (err) => {
            this.error('Trade WebSocket error:', err);
            this.scheduleTradeReconnect();
        });
        this.wsTrade.on('close', (code, reason) => {
            this.log(`🚫 Trade WebSocket closed (${code}: ${reason.toString()})`);
            this.scheduleTradeReconnect();
        });
    }

    private connectOrderBookWebSocket() {
        this.cleanupOrderBookWebSocket();
        
        const wsUrl = `wss://fstream.binance.com/ws/${this.symbol}@depth@100ms`;
        this.log(`🔗 Connecting to order book WebSocket: ${wsUrl}`);
        
        this.wsOrderBook = new WebSocket(wsUrl, {
            handshakeTimeout: 15000,
            perMessageDeflate: false
        });

        this.wsOrderBook.on('open', () => {
            this.orderBookReconnectAttempts = 0;
            this.log(`✅ OrderBook WebSocket connected`);
            this.lastOrderBookMessageTime = Date.now();
        });

        this.wsOrderBook.on('message', (data: string) => {
            this.lastOrderBookMessageTime = Date.now();
            this.processOrderBookData(data);
        });

        this.wsOrderBook.on('ping', () => this.wsOrderBook?.pong());
        this.wsOrderBook.on('pong', () => this.lastOrderBookMessageTime = Date.now());
        this.wsOrderBook.on('error', (err) => {
            this.error('OrderBook WebSocket error:', err);
            this.scheduleOrderBookReconnect();
        });
        this.wsOrderBook.on('close', (code, reason) => {
            this.log(`🚫 OrderBook WebSocket closed (${code}: ${reason.toString()})`);
            this.scheduleOrderBookReconnect();
        });
    }

    private processTradeData = (rawData: string) => {
        try {
            const trade = JSON.parse(rawData);
            const price = parseFloat(trade.p);
            const volume = parseFloat(trade.q);
            const timestamp = trade.E || Date.now();
            const isBuyerMaker = trade.m;
            const aggressor = isBuyerMaker ? 'seller' : 'buyer';

            this.lastPrice = price;
            this.lastTradeMessageTime = Date.now();

            if (this.isActive) {
                // Update trade flow metrics
                if (aggressor === 'buyer') {
                    this.tradeFlow.buyVolume += volume;
                    this.tradeFlow.delta += volume;
                } else {
                    this.tradeFlow.sellVolume += volume;
                    this.tradeFlow.delta -= volume;
                }

                this.updateOHLCCandle(price, volume, timestamp, aggressor);
                this.updateMarketState();
            }
        } catch (err) {
            this.error('Trade data parse error:', err);
        }
    };

    private processOrderBookData = (rawData: string) => {
        try {
            const data = JSON.parse(rawData);
            this.orderBook = {
                bids: data.b.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
                asks: data.a.map(([p, q]: [string, string]) => [parseFloat(p), parseFloat(q)]),
                timestamp: data.E || Date.now()
            };
            this.updateMarketState();
        } catch (err) {
            this.error('OrderBook parse error:', err);
        }
    };

    private updateOHLCCandle(
        price: number,
        volume: number,
        timestamp: number,
        aggressor: 'buyer' | 'seller'
    ) {
        const candleStart = Math.floor(timestamp / CONFIG.candleInterval) * CONFIG.candleInterval;

        // New candle period
        if (!this.currentCandle || candleStart > this.candleStartTime) {
            if (this.currentCandle) {
                this.closeCurrentCandle();
            }

            // Initialize new candle with explicit buy/sell volumes
            this.currentCandle = {
                open: price,
                high: price,
                low: price,
                close: price,
                volume: volume,
                timestamp: candleStart,
                buyVolume: aggressor === 'buyer' ? volume : 0,
                sellVolume: aggressor === 'seller' ? volume : 0
            };
            
            this.candleStartTime = candleStart;
            this.scheduleCandleClose();
        } 
        // Update existing candle
        else if (this.currentCandle) {
            this.currentCandle.high = Math.max(this.currentCandle.high, price);
            this.currentCandle.low = Math.min(this.currentCandle.low, price);
            this.currentCandle.close = price;
            this.currentCandle.volume += volume;

            // Ensure buy/sell volumes are always numbers
            if (aggressor === 'buyer') {
                this.currentCandle.buyVolume = (this.currentCandle.buyVolume || 0) + volume;
            } else {
                this.currentCandle.sellVolume = (this.currentCandle.sellVolume || 0) + volume;
            }
        }
    }

    private scheduleCandleClose() {
        const now = Date.now();
        const nextCloseTime = Math.ceil(now / CONFIG.candleInterval) * CONFIG.candleInterval;
        const delay = nextCloseTime - now;

        this.cleanupCandleTimer();

        if (this.isActive && delay > 0) {
            this.candleCloseTimeout = setTimeout(() => {
                if (this.currentCandle) this.closeCurrentCandle();
                this.scheduleCandleClose();
            }, delay);
        }
    }

    private closeCurrentCandle() {
        if (!this.currentCandle) return;
        
        this.ohlcHistory.push(this.currentCandle);
        
        // Maintain history size
        if (this.ohlcHistory.length > CONFIG.candleBufferSize) {
            this.ohlcHistory.shift();
        }
        
        this.log(`🕯️ Closed ${CONFIG.candleInterval/60000}min candle`);
        this.currentCandle = null;
        this.updateMarketState();
    }

    private updateMarketState() {
        // Calculate high/low for historical data
        let high = -Infinity;
        let low = Infinity;
        
        if (this.ohlcHistory.length > 0) {
            high = Math.max(...this.ohlcHistory.map(c => c.high));
            low = Math.min(...this.ohlcHistory.map(c => c.low));
        }

        // Create market state snapshot
        this.currentMarketState = {
            timestamp: Date.now(),
            symbol: this.symbol,
            currentPrice: this.lastPrice,
            ohlcHistory: [...this.ohlcHistory],
            currentCandle: this.currentCandle,
            orderBook: this.orderBook,
            tradeFlow: {...this.tradeFlow},
            candleDuration: CONFIG.candleInterval,
            dataDuration: this.ohlcHistory.length * CONFIG.candleInterval,
            additional: { high, low }
        };
    }

    private startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        
        this.heartbeatInterval = setInterval(() => {
            if (!this.isActive) return;
            const now = Date.now();

            // Trade WebSocket health check
            if (this.wsTrade?.readyState === WebSocket.OPEN) {
                const tradeTimeDiff = now - this.lastTradeMessageTime;
                if (tradeTimeDiff > 15000) {
                    this.wsTrade.ping();
                    this.log('❤️‍🔥 Sent trade WebSocket ping');
                }
                if (tradeTimeDiff > 60000) {
                    this.log(`♻️ No trade data for ${Math.floor(tradeTimeDiff/1000)}s - reconnecting`);
                    this.scheduleTradeReconnect();
                }
            }

            // OrderBook WebSocket health check
            if (this.wsOrderBook?.readyState === WebSocket.OPEN) {
                const orderBookTimeDiff = now - this.lastOrderBookMessageTime;
                if (orderBookTimeDiff > 15000) {
                    this.wsOrderBook.ping();
                    this.log('❤️‍🔥 Sent order book WebSocket ping');
                }
                if (orderBookTimeDiff > 60000) {
                    this.log(`♻️ No orderbook data for ${Math.floor(orderBookTimeDiff/1000)}s - reconnecting`);
                    this.scheduleOrderBookReconnect();
                }
            }
        }, 10000);
    }

    private scheduleTradeReconnect() {
        if (!this.isActive) return;
        this.cleanupTradeWebSocket();
        
        const delay = Math.min(1000 * Math.pow(2, this.tradeReconnectAttempts), 30000);
        this.tradeReconnectAttempts++;
        
        this.log(`⏳ Reconnecting trade in ${delay/1000}s (attempt ${this.tradeReconnectAttempts})`);
        setTimeout(() => this.connectTradeWebSocket(), delay);
    }

    private scheduleOrderBookReconnect() {
        if (!this.isActive) return;
        this.cleanupOrderBookWebSocket();
        
        const delay = Math.min(1000 * Math.pow(2, this.orderBookReconnectAttempts), 30000);
        this.orderBookReconnectAttempts++;
        
        this.log(`⏳ Reconnecting orderbook in ${delay/1000}s (attempt ${this.orderBookReconnectAttempts})`);
        setTimeout(() => this.connectOrderBookWebSocket(), delay);
    }

    private cleanupTradeWebSocket() {
        if (this.wsTrade) {
            this.wsTrade.removeAllListeners();
            if (this.wsTrade.readyState === WebSocket.OPEN) {
                this.wsTrade.close();
            }
            this.wsTrade = null;
        }
    }

    private cleanupOrderBookWebSocket() {
        if (this.wsOrderBook) {
            this.wsOrderBook.removeAllListeners();
            if (this.wsOrderBook.readyState === WebSocket.OPEN) {
                this.wsOrderBook.close();
            }
            this.wsOrderBook = null;
        }
    }

    private cleanupCandleTimer() {
        if (this.candleCloseTimeout) {
            clearTimeout(this.candleCloseTimeout);
            this.candleCloseTimeout = null;
        }
    }

    private async fetchPriceViaREST(): Promise<number | null> {
        try {
            const response = await fetch(
                `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${this.symbol.toUpperCase()}`
            );
            
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorBody}`);
            }
            
            const data = await response.json();
            return parseFloat(data.price);
        } catch (err) {
            this.error('REST price fetch failed:', err);
            return null;
        }
    }

    public getCurrentMarketState(): MarketDataState | null {
        return this.currentMarketState;
    }

    public getCurrentPrice(): number | null {
        return this.lastPrice;
    }

    public getLastUpdateTime(): number {
        return this.lastTradeMessageTime;
    }

    public async getFreshPrice(): Promise<number | null> {
        if (Date.now() - this.lastTradeMessageTime < 60000) {
            return this.lastPrice;
        }
        return await this.fetchPriceViaREST();
    }

    public start() {
        if (!this.isActive) {
            this.connect();
        }
    }

    public stop() {
        this.isActive = false;
        this.cleanupTradeWebSocket();
        this.cleanupOrderBookWebSocket();
        this.cleanupCandleTimer();
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        this.log('🛑 Market data collection stopped');
    }

    public isConnected(): boolean {
        return this.wsTrade?.readyState === WebSocket.OPEN && 
               this.wsOrderBook?.readyState === WebSocket.OPEN;
    }

    public isHistoricalDataLoaded(): boolean {
        return this.historicalDataLoaded;
    }

    private log(message: string) {
        console.log(`[${new Date().toISOString()}] [MDC:${this.symbol}] ${message}`);
    }

    private error(message: string, error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[${new Date().toISOString()}] [MDC:${this.symbol}] ❌ ${message}: ${errorMsg}`);
        
        // Add stack trace for better debugging
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
    }
}