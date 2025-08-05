type LogStatus = "pending" | "completed" | "failed" | "executed" | "skipped";
type LogSource = "price-detections" | "trade-execution";
export type MarketRegime = 'uptrend' | 'downtrend' | 'consolidating' | 'exhaustion' | 'transitioning' | 'trending';

interface BaseLogEntry {
    id: string;
    createdAt: string;
    status: LogStatus;
    error?: string;
}

export interface OHLC {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
    averageVolume?: number;
    buyVolume?: number;  // Added: Aggressor buy volume
    sellVolume?: number; // Added: Aggressor sell volume
}

export interface OrderBookSnapshot {
  bids: [number, number][]; // [price, quantity]
  asks: [number, number][];
  timestamp: number;
}

export interface TradeFlowMetrics {
  buyVolume: number;  // Cumulative buy volume
  sellVolume: number; // Cumulative sell volume
  delta: number;      // Net volume delta (buyVolume - sellVolume)
}

export interface BayesianRegressionResult {
  predictedPrice: number;
  confidenceInterval: [number, number];
  stopLoss: number;
  takeProfit: number;
  trendDirection: 'bullish' | 'bearish' | 'neutral';
  volatility: number;
  variance: number;
  probability: number;
  zScore: number;
  regime: MarketRegime;
  indicators: {
    support: number;
    resistance: number;
    vwma: number;
    obv: number;
    rsi: number;
    volumeRsi: number;
    vwap: number;
    volumeDelta?: number;           // Added: Net buy/sell volume difference
    bidAskImbalance?: number;       // Added: Order book imbalance
    liquidityClusters?: {           // Added: Key liquidity levels
      price: number;
      bidLiquidity: number;
      askLiquidity: number;
    }[];
    arimaForecast: number;          // Added: ARIMA forecast value
    arimaConfidence: number;        // Added: ARIMA model confidence
  };
}

export interface PriceDetectionLogEntry extends BaseLogEntry {
    type: "price-detections";
    pairId: number;
    priceContext: string;
    decision: string;
    decisionLength: number;
    spikePercent: number;
    tokenIn: string;
    tokenOut: string;
    confidence: 'high' | 'medium' | 'low' | string;
    amount: string;
    eventTxHash: string;
    eventBlockNumber: number;
    fgi?: number | null;
    fgiClassification?: string | null;
    stopLoss?: number;
    takeProfit?: number;
    reasoning?: string;
    timestamp?: string;
    actualAmountOut?: string;
    gasUsed?: string;
    riskPositionId?: string;
    currentPrice: number;
    positionAction?: 'open' | 'close' | 'adjust' | 'hold' | string;
    positionId?: string | null;
    bayesianAnalysis?: BayesianRegressionResult | null;
    regime: MarketRegime;
    orderFlowSignals?: {  // Added: Order flow signals
      absorption: boolean;
      stopRun: boolean;
      liquidityGrab: boolean;
    };
}

export interface TradeExecutionLog extends BaseLogEntry {
    type: "trade-execution";
    source: "trade-execution";
    sourceLogId: string;
    sourceType: "price-detections";
    tokenIn: string;
    tokenOut: string;
    amount: string;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    pairId: number;
    stopLoss?: number;
    takeProfit?: number;
    amountIn?: string | null;
    minAmountOut?: string | null;
    actualAmountOut?: string | null;
    txHash?: string | null;
    gasUsed?: string | null;
    timestamp?: string;
    positionId?: string | null;
    entryPrice?: string | null;
    liquidityClusters?: {  // Added: Liquidity levels used for execution
      price: number;
      bidLiquidity: number;
      askLiquidity: number;
    }[];
}

export interface Position {
    id: string;
    entryPrice: string;
    isLong: boolean;
    amount: string;
    tradeFlow?: TradeFlowMetrics; // Added: Trade flow at position entry
}

export type LogEntry = PriceDetectionLogEntry | TradeExecutionLog;

// Type guards
export function isPriceDetectionLog(log: LogEntry): log is PriceDetectionLogEntry {
    return log.type === "price-detections";
}

export function isTradeExecutionLog(log: LogEntry): log is TradeExecutionLog {
    return log.type === "trade-execution";
}

export interface TradingDecision {
    positionAction: 'open' | 'close' | 'hold' | 'adjust';
    decision: 'buy' | 'sell' | 'hold';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low' | string;
    stopLoss?: number;
    takeProfit?: number;
    positionId?: string;
    orderFlowSignals?: {  // Added: Signals influencing decision
      absorption: boolean;
      stopRun: boolean;
    };
}

export interface MarketContext {
    fgi: number;
    fgi_classification: string;
    obv_value?: number;
    obv_trend?: string;
    rl_insights?: any[];
    timestamp: string;
    price_event?: {
        type: string;
        direction: string;
        change_percent: number;
        current_price: number;
        previous_price: number;
        volatility_level: 'low' | 'medium' | 'high' | 'extreme';
        volumeDelta?: number; // Added: Net volume change
    };
    token_metadata?: {
        stable: {
            address: string;
            symbol: string;
            decimals: number;
        };
        volatile: {
            address: string;
            symbol: string;
            decimals: number;
        };
    };
    orderBookImbalance?: number; // Added: Current bid-ask imbalance
}

export interface RiskParameters {
    stopLoss: number;
    takeProfit: number;
    positionId?: string;
    liquidityCluster?: {  // Added: Liquidity level used for stop
      price: number;
      bidLiquidity: number;
      askLiquidity: number;
    };
}

export interface PositionDetails {
    id: string;
    entryPrice: number;
    currentPrice: number;
    amount: number;
    direction: 'long' | 'short';
    status: 'open' | 'closed' | 'liquidated';
    stopLoss: number;
    takeProfit: number;
    openedAt: string;
    closedAt?: string;
    entryTradeFlow?: TradeFlowMetrics; // Added: Trade flow at entry
}

export interface RiskPosition {
    id: string;
    trader: string;
    isLong: boolean;
    amount: string;
    entryPrice: string;
    stopLoss: number;
    takeProfit: number;
    createdAt: string;
    lastUpdated: string;
    status: 'active' | 'closed' | 'liquidated';
    metadata?: string;
    entryVolumeDelta?: number; // Added: Volume delta at position entry
}

export interface MarketDataState {
  timestamp: number;
  symbol: string;
  currentPrice: number | null;
  ohlcHistory: OHLC[];
  currentCandle: OHLC | null;
  candleDuration: number;
  dataDuration: number;
  additional?: {
    high?: number;
    low?: number;
  };
  regime?: MarketRegime;
  averageVolume?: number;
  signal?: {
    shouldTrigger: boolean;
    recommendedAction: string;
    confidence: number;
    signals: string[];
    keyLevels: number[];
    currentPrice: number;
    symbol: string;
    trend: string;
  };
  priceChangePercent?: number;
  priceChange24h?: number;
  bayesianAnalysis?: BayesianRegressionResult;
  orderBook?: OrderBookSnapshot;  // Added: Current order book state
  tradeFlow?: TradeFlowMetrics;   // Added: Current trade flow metrics
  liquidityClusters?: {           // Added: Key liquidity levels
    price: number;
    bidLiquidity: number;
    askLiquidity: number;
  }[];
}