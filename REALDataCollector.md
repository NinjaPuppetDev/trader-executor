import WebSocket from 'ws';
import { CONFIG } from './config';
import { TechnicalAnalyzer } from './technicalAnalyzer';
import { MarketDataState } from '../types';

// Define the new signal type
interface PriceActionSignal {
  action: string;
  confidence: number;
  stopLoss: number;
  takeProfit: number;
  state: string;
  reasoning: string;
}

export class MarketDataCollector {
  private ws: WebSocket | null = null;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private additionalData: {
    high: number;
    low: number;
    open?: number;
    close?: number;
    isBuyerMaker?: boolean;
  } = {
      high: -Infinity,
      low: Infinity
    };
  private currentMarketState: MarketDataState | null = null;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private symbol: string = 'ethusdt') { }

  async connect() {
    console.log(`🔌 Connecting to Binance ${this.symbol} stream...`);
    this.ws = new WebSocket(`wss://fstream.binance.com/ws/${this.symbol}@trade`);

    this.ws.on('open', () => {
      console.log(`✅ Connected to Binance ${this.symbol} stream`);
      this.resetDataBuffers();
      this.reconnectAttempts = 0;
      this.startHeartbeat();
    });

    this.ws.on('message', this.processTradeData);
    this.ws.on('error', this.handleError);
    this.ws.on('close', this.handleReconnect);
    this.ws.on('pong', () => console.debug('❤️ WebSocket heartbeat confirmed'));
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Send ping every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private handleError = (err: Error) => {
    console.error('WebSocket error:', err);
    this.reconnect();
  };

  private handleReconnect = () => {
    console.log('Connection closed. Reconnecting...');
    this.reconnect();
  };

  private reconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(() => {
      console.log(`⏳ Attempting reconnect #${this.reconnectAttempts}...`);
      this.connect();
    }, delay);
  }

  private resetDataBuffers() {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.additionalData = {
      high: -Infinity,
      low: Infinity
    };
    this.currentMarketState = null;
  }

  private processTradeData = (rawData: string) => {
    try {
      const trade = JSON.parse(rawData);
      const price = parseFloat(trade.p);
      const volume = parseFloat(trade.q);
      const isBuyerMaker = trade.m;

      // Update history buffers
      this.priceHistory.push(price);
      this.volumeHistory.push(volume);

      // Track additional metrics
      if (this.priceHistory.length === 1) {
        this.additionalData.open = price;
      }
      this.additionalData.high = Math.max(this.additionalData.high, price);
      this.additionalData.low = Math.min(this.additionalData.low, price);
      this.additionalData.close = price;
      this.additionalData.isBuyerMaker = isBuyerMaker;

      // Maintain fixed buffer size
      if (this.priceHistory.length > CONFIG.dataBufferSize) {
        this.priceHistory.shift();
        this.volumeHistory.shift();
      }

      // Update market state in memory
      this.updateMarketState();
    } catch (err) {
      console.error('Error processing trade:', err);
    }
  }

  private updateMarketState() {
    if (this.priceHistory.length < CONFIG.minDataPoints) return;

    // Create market state with proper typing
    const marketState: MarketDataState = {
      prices: [...this.priceHistory],
      volumes: [...this.volumeHistory],
      currentPrice: this.priceHistory[this.priceHistory.length - 1],
      averageVolume: this.calculateAverageVolume(),
      timestamp: Date.now(),
      symbol: this.symbol,
      additional: {
        high: this.additionalData.high,
        low: this.additionalData.low,
        open: this.additionalData.open,
        close: this.additionalData.close,
        isBuyerMaker: this.additionalData.isBuyerMaker
      }
    };

    // Generate technical signal using the new analyzer
    const signal: PriceActionSignal = TechnicalAnalyzer.analyze(marketState);

    // Add signal to market state with proper typing
    marketState.signal = {
      shouldTrigger: signal.confidence > CONFIG.confidenceThreshold,
      recommendedAction: signal.action,
      confidence: signal.confidence,
      signals: [signal.state], // Using state as the primary signal
      keyLevels: [signal.stopLoss, signal.takeProfit],
      currentPrice: marketState.currentPrice,
      symbol: marketState.symbol,
      trend: signal.state.includes('up') ? 'uptrend' :
        signal.state.includes('down') ? 'downtrend' : 'neutral'
    };

    this.currentMarketState = marketState;
  }


  public getCurrentMarketState(): MarketDataState | null {
    return this.currentMarketState;
  }

  private calculateAverageVolume(): number {
    return this.volumeHistory.reduce((a, b) => a + b, 0) / this.volumeHistory.length;
  }


  public start() {
    this.connect();
    console.log(`🚀 Started Market Data Collector for ${this.symbol}`);
  }

  public stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    console.log('🛑 Market Data Collector stopped');
  }
}