// Remove Venice-related types since they're not in backend
type LogStatus = "pending" | "completed" | "failed" | "executed" | "skipped";
type LogSource = "price-detections" | "trade-execution";

interface BaseLogEntry {
    id: string;
    createdAt: string;
    status: LogStatus;
    error?: string;
}

export interface PriceDetectionLogEntry extends BaseLogEntry {
    // Fields from backend entity
    type: "price-detections";
    priceContext: string;
    decision: string;
    decisionLength: number;
    spikePercent: number;
    tokenIn: string;
    tokenOut: string;
    confidence: string;
    amount: string;
    eventTxHash: string;
    eventBlockNumber: number;
    fgi?: number | null;
    fgiClassification?: string | null;

    // Optional fields that might be present
    reasoning?: string;
    timestamp?: string;
    actualAmountOut?: string;
    gasUsed?: string;
}

export interface TradeExecutionLog extends BaseLogEntry {
    // Fields from backend entity
    type: "trade-execution";
    source: "trade-execution";
    sourceLogId: string;
    sourceType: "price-detections";
    tokenIn: string;
    tokenOut: string;
    amount: string;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    amountIn?: string | null;
    minAmountOut?: string | null;
    actualAmountOut?: string | null;
    txHash?: string | null;
    gasUsed?: string | null;

    // Optional fields
    timestamp?: string;
}

export type LogEntry = PriceDetectionLogEntry | TradeExecutionLog;

// Type guards
export function isPriceDetectionLog(log: LogEntry): log is PriceDetectionLogEntry {
    return log.type === "price-detections";
}

export function isTradeExecutionLog(log: LogEntry): log is TradeExecutionLog {
    return log.type === "trade-execution";
}

// Additional utility types
export interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
    reasoning: string;
    confidence?: 'high' | 'medium' | 'low';
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
        volatility_level: string;
    };
}