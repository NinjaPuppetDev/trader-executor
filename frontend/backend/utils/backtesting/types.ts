/**
 * Trade data type for both live trading and historical simulation
 * Matches Binance's trade event format
 */
export interface TradeData {
    e: string;       // Event type (e.g., 'trade')
    E: number;       // Event time
    s: string;       // Symbol
    t: number;       // Trade ID
    p: string;       // Price
    q: string;       // Quantity
    b: number;       // Buyer order ID
    a: number;       // Seller order ID
    T: number;       // Trade time
    m: boolean;      // Is buyer the market maker?
    M?: boolean;     // Ignore (optional)
}

/**
 * Historical kline data structure for Binance API response
 * Used when converting klines to trade data
 */
export interface KlineData {
    0: number;       // Open time
    1: string;       // Open price
    2: string;       // High price
    3: string;       // Low price
    4: string;       // Close price
    5: string;       // Volume
    6: number;       // Close time
    7: string;       // Quote asset volume
    8: number;       // Number of trades
    9: string;       // Taker buy base asset volume
    10: string;      // Taker buy quote asset volume
    11: string;      // Ignore
}

/**
 * Configuration for historical data download
 */
export interface HistoricalDownloadConfig {
    symbol: string;
    interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
    limit: number;
}

/**
 * File metadata for saved historical data
 */
export interface HistoricalDataFile {
    filename: string;
    symbol: string;
    interval: string;
    tradeCount: number;
    created: number;
    firstTrade: number;
    lastTrade: number;
}