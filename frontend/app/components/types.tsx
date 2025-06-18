// Add these interfaces
export interface BaseLogEntry {
    id: string;
    createdAt: string;
    status: 'pending' | 'completed' | 'failed';
    txHash?: string;
    blockNumber?: number;
    error?: string;
    decision: string;
    decisionLength: number;
}

export interface VeniceLogEntry extends BaseLogEntry {
    source: "venice";
    prompt: string;
}

export interface PriceTriggerLogEntry extends BaseLogEntry {
    source: "price-trigger";
    priceContext: string;
    spikePercent?: number;
}

export interface TradeExecutionLog {
    id: string;
    source: "trade-execution";
    sourceLogId: string;
    sourceType: 'venice' | 'price-trigger';
    timestamp: string;
    decision: string;
    decisionLength: number;
    status: 'completed' | 'pending' | 'failed' | 'error';
    createdAt: string;
    txHash?: string;
    blockNumber?: number;
    error?: string;
    amountIn: string;
    tokenIn: string;
    tokenOut: string;
    minAmountOut: string;
    actualAmountOut?: string;
    gasUsed?: string;
}

export type LogEntry = VeniceLogEntry | PriceTriggerLogEntry | TradeExecutionLog;