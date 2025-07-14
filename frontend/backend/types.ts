type LogStatus = "pending" | "completed" | "failed" | "executed" | "skipped";
type LogSource = "price-detections" | "trade-execution";


interface BaseLogEntry {
    id: string;
    createdAt: string;
    status: LogStatus;
    error?: string;
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
    pairId: number; // Added pair ID

    // New risk management parameters
    stopLoss?: number;
    takeProfit?: number;

    amountIn?: string | null;
    minAmountOut?: string | null;
    actualAmountOut?: string | null;
    txHash?: string | null;
    gasUsed?: string | null;
    timestamp?: string;
}

export interface Position {
    id: string;             // Same as positionId from TradeExecutor
    entryPrice: string;     // In 18 decimals format
    isLong: boolean;        // Position direction
    amount: string;         // Position size
}

export type LogEntry = PriceDetectionLogEntry | TradeExecutionLog;

// Type guards
export function isPriceDetectionLog(log: LogEntry): log is PriceDetectionLogEntry {
    return log.type === "price-detections";
}

export function isTradeExecutionLog(log: LogEntry): log is TradeExecutionLog {
    return log.type === "trade-execution";
}

// Enhanced TradingDecision with risk parameters
export interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low' | string
    stopLoss: number;
    takeProfit: number;
}

export interface MarketContext {
    fgi: number;
    fgi_classification: string;
    obv_value?: number;
    obv_trend?: string;
    rl_insights?: any[];
    timestamp: string;

    // Enhanced price event with volatility
    price_event?: {
        type: string;
        direction: string;
        change_percent: number;
        current_price: number;
        previous_price: number;
        volatility_level: 'low' | 'medium' | 'high' | 'extreme';
    };

    // Added token metadata
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
}

// New type for position risk parameters
export interface RiskParameters {
    stopLoss: number;
    takeProfit: number;
    positionId?: string;
}

// New type for position details
export interface PositionDetails {
    id: string;             // Position ID
    entryPrice: number;
    currentPrice: number;
    amount: number;
    direction: 'long' | 'short';
    status: 'open' | 'closed' | 'liquidated';
    stopLoss: number;       // In basis points (500 = 5%)
    takeProfit: number;     // In basis points (1000 = 10%)
    openedAt: string;
    closedAt?: string;
}

export interface RiskPosition {
    id: string;             // Matches TradeExecutor's positionId
    trader: string;
    isLong: boolean;
    amount: string;
    entryPrice: string;     // In 18 decimals
    stopLoss: number;       // Basis points (500 = 5%)
    takeProfit: number;     // Basis points (1000 = 10%)
    createdAt: string;
    lastUpdated: string;
    status: 'active' | 'closed' | 'liquidated';
}

export interface BayesianRegressionResult {
    predictedPrice: number;
    confidenceInterval: [number, number];
    stopLoss: number;
    takeProfit: number;
    trendDirection: 'bullish' | 'bearish' | 'neutral';
    volatility: number;
    variance: number;
}

export interface MarketDataState {
    prices: number[];
    volumes: number[];
    currentPrice: number;
    averageVolume: number;
    timestamp: number;
    symbol: string;
    additional: {
        open?: number;
        high: number;
        low: number;
        close?: number;
        isBuyerMaker?: boolean;
    };
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
}