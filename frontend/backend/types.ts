// ... existing imports ...

// Add a new type for API endpoints
type LogApiEndpoint = "venice" | "price-detections" | "trade-execution" | "logs";

// Update LogSource to match backend values
type LogSource = "venice" | "price-detections" | "trade-execution";
type LogStatus = "pending" | "completed" | "failed" | "error" | "executed" | "skipped" | "invalid";

interface BaseLogEntry {
    id: string;
    createdAt: string;
    status: LogStatus;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    source?: LogSource;
    timestamp?: string;
}

export interface PriceDetectionLogEntry extends BaseLogEntry {
    type: "price-detections";
    priceContext: string;
    decision: string;  // Add this missing property
    decisionLength?: number;
    eventTxHash?: string;
    eventBlockNumber?: number;
    fgi?: number;
    fgiClassification?: string;
    spikePercent?: number;
    actualAmountOut?: string;
    gasUsed?: string;
    success?: boolean;
    tokenIn?: string;
    tokenOut?: string;
    buyVolatile?: boolean;
    amountInWei?: string;
    minAmountOut?: string;
    reasoning?: string;
    confidence?: "high" | "medium" | "low";  // Add this
}

export interface VeniceLogEntry extends BaseLogEntry {
    type: "venice";
    prompt: string;
    response?: string;
    confidence?: "high" | "medium" | "low";
    slippage?: number;
    tokenIn?: string;
    tokenOut?: string;
    amount?: string;
}

export interface TradeExecutionLog extends BaseLogEntry {
    tokenOutDecimals: number;
    tokenInDecimals: number;
    amountIn: string;
    minAmountOut: string;
    actualAmountOut?: string;
    type: "trade-execution";
    source: "trade-execution";
    timestamp: string;
    sourceLogId: string;
    sourceType: 'venice' | 'price-detections';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    gasUsed?: string;
    decision: TradingDecision;  // Now properly defined
}

export type LogEntry = PriceDetectionLogEntry | VeniceLogEntry | TradeExecutionLog;

// Type guards
export function isPriceDetectionLog(log: LogEntry): log is PriceDetectionLogEntry {
    return log.type === "price-detections";
}

export function isVeniceLog(log: LogEntry): log is VeniceLogEntry {
    return log.type === "venice";
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

export type ApiDebugEntry = {
    id: string;
    timestamp: string;
    prompt: string;
    rawResponse: string;
    parsedDecision: TradingDecision;
    error?: string;
};

export interface PromptConfig {
    system: string;
    instructions: string;
    token_mapping: Record<string, string>;
    market_context: Record<string, any>;
}

export interface MarketContext {
    fgi: number;
    fgi_classification: string;
    obv_value: number;
    obv_trend: string;
    rl_insights: any[];
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