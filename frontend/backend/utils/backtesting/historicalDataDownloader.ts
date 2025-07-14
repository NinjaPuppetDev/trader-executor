import https from 'https';
import fs from 'fs';
import path from 'path';
import { TradeData, KlineData, HistoricalDataFile } from './types';

// Define significant event interface
interface SignificantEvent {
    startIndex: number;
    endIndex: number;
    eventType: 'breakout' | 'reversal' | 'continuation';
    direction: 'up' | 'down';
    confidence: number;
    trades: TradeData[];
}

export async function downloadHistoricalData(
    symbol: string,
    interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' = '1m',
    limit = 1000,
    detectEvents: boolean = true
): Promise<{ trades: TradeData[]; metadata: HistoricalDataFile; events?: SignificantEvent[] }> {
    return new Promise((resolve, reject) => {
        console.log(`📥 Downloading historical data for ${symbol}...`);

        const params = new URLSearchParams({
            symbol: symbol.toUpperCase(),
            interval,
            limit: limit.toString()
        });

        const options = {
            hostname: 'api.binance.com',
            path: `/api/v3/klines?${params}`,
            method: 'GET',
            headers: { 'User-Agent': 'Node.js/HistoricalDataDownloader' }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => data += chunk);

            res.on('end', () => {
                try {
                    const klines: KlineData[] = JSON.parse(data);
                    const trades: TradeData[] = [];
                    let firstTradeTime = Infinity;
                    let lastTradeTime = -Infinity;

                    klines.forEach((kline) => {
                        const openTime = kline[0];
                        const close = parseFloat(kline[4]);
                        const volume = parseFloat(kline[5]);

                        for (let i = 0; i < 5; i++) {
                            const randomPrice = parseFloat(
                                (close * (1 + (Math.random() - 0.5) * 0.001)).toFixed(4)
                            );
                            const tradeTime = openTime + i * 10000;

                            firstTradeTime = Math.min(firstTradeTime, tradeTime);
                            lastTradeTime = Math.max(lastTradeTime, tradeTime);

                            trades.push({
                                e: 'klines',
                                E: tradeTime,
                                s: symbol,
                                t: Date.now(), // Using current timestamp as trade ID
                                p: randomPrice.toString(),
                                q: (volume / 5).toFixed(8),
                                b: -1, // Not available in klines
                                a: -1, // Not available in klines
                                T: tradeTime,
                                m: Math.random() > 0.5
                            });
                        }
                    });

                    // Create metadata
                    const dataDir = './data';
                    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

                    const filename = path.join(dataDir, `${symbol}_${interval}_${Date.now()}.json`);
                    const metadata: HistoricalDataFile = {
                        filename,
                        symbol,
                        interval,
                        tradeCount: trades.length,
                        created: Date.now(),
                        firstTrade: firstTradeTime,
                        lastTrade: lastTradeTime
                    };

                    // Save data with metadata
                    const fileData = { trades, metadata };
                    fs.writeFileSync(filename, JSON.stringify(fileData, null, 2));
                    console.log(`💾 Saved ${trades.length} simulated trades to ${filename}`);

                    // Detect significant events if requested
                    let events: SignificantEvent[] = [];
                    if (detectEvents && trades.length > 50) {
                        console.log('🔍 Scanning for significant events...');
                        events = findSignificantEvents(trades);

                        if (events.length > 0) {
                            const eventDir = path.join(dataDir, 'events');
                            if (!fs.existsSync(eventDir)) fs.mkdirSync(eventDir);

                            events.forEach((event, idx) => {
                                const eventFilename = path.join(
                                    eventDir,
                                    `${symbol}_event_${idx}_${Date.now()}.json`
                                );
                                fs.writeFileSync(eventFilename, JSON.stringify(event, null, 2));
                                console.log(`💾 Saved event #${idx} to ${eventFilename}`);
                            });
                        }
                    }

                    resolve({ trades, metadata, events });
                } catch (error) {
                    reject(new Error(`Error parsing response: ${error instanceof Error ? error.message : String(error)}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Request failed: ${error.message}`));
        });

        req.end();
    });
}

// Helper function to calculate statistics
function calculateWindowStatistics(trades: TradeData[]): {
    prices: number[];
    volumes: number[];
    high: number;
    low: number;
    open: number;
    close: number;
    mean: number;
    stdDev: number;
    avgVolume: number;
} {
    const prices = trades.map(t => parseFloat(t.p));
    const volumes = trades.map(t => parseFloat(t.q));

    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const open = prices[0];
    const close = prices[prices.length - 1];

    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const stdDev = Math.sqrt(
        prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length
    );

    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;

    return { prices, volumes, high, low, open, close, mean, stdDev, avgVolume };
}

// Find significant events using the three core beliefs
function findSignificantEvents(trades: TradeData[], windowSize = 50): SignificantEvent[] {
    const events: SignificantEvent[] = [];

    // Slide through historical data with 50-trade windows
    for (let i = 0; i <= trades.length - windowSize; i++) {
        const window = trades.slice(i, i + windowSize);
        const stats = calculateWindowStatistics(window);
        const lastTrade = window[window.length - 1];

        // BELIEF 1: Volume Spike (current volume > 2x average)
        const volumeSpike = parseFloat(lastTrade.q) > 2 * stats.avgVolume;

        // BELIEF 2: Price Rejection (price moves beyond 2σ but closes within 1σ)
        const currentPrice = parseFloat(lastTrade.p);
        const priceDeviation = Math.abs(currentPrice - stats.mean);
        const priceRejection = priceDeviation > stats.stdDev &&
            priceDeviation < 2 * stats.stdDev;

        // BELIEF 3: Momentum Consistency (last 3 trades same direction)
        const lastThree = stats.prices.slice(-3);
        const momentumUp = lastThree[2] > lastThree[1] && lastThree[1] > lastThree[0];
        const momentumDown = lastThree[2] < lastThree[1] && lastThree[1] < lastThree[0];
        const momentumConsistency = momentumUp || momentumDown;

        // Check if all three beliefs are satisfied
        if (volumeSpike && priceRejection && momentumConsistency) {
            // Determine event type and direction
            let eventType: 'breakout' | 'reversal' | 'continuation' = 'continuation';
            let direction: 'up' | 'down' = momentumUp ? 'up' : 'down';

            // Breakout detection (price beyond recent range)
            const recentHigh = Math.max(...stats.prices.slice(-20));
            const recentLow = Math.min(...stats.prices.slice(-20));
            if (currentPrice > recentHigh || currentPrice < recentLow) {
                eventType = 'breakout';
            }

            // Reversal detection (price rejects extreme)
            if ((currentPrice < stats.mean && momentumUp) ||
                (currentPrice > stats.mean && momentumDown)) {
                eventType = 'reversal';
            }

            // Confidence calculation based on strength of signals
            const confidence = Math.min(1,
                0.4 * (volumeSpike ? 1 : 0) +
                0.3 * (priceRejection ? 1 : 0) +
                0.3 * (momentumConsistency ? 1 : 0)
            );

            events.push({
                startIndex: i,
                endIndex: i + windowSize - 1,
                eventType,
                direction,
                confidence,
                trades: window
            });

            // Skip ahead to avoid overlapping events
            i += windowSize;
        }
    }

    console.log(`🎯 Found ${events.length} significant events`);
    return events;
}

// Additional helper function to load and replay specific events
export function replayEventFromFile(filename: string): SignificantEvent {
    try {
        const data = fs.readFileSync(filename, 'utf-8');
        const event = JSON.parse(data) as SignificantEvent;
        console.log(`⏯ Loaded event: ${event.eventType} ${event.direction} at ${event.confidence.toFixed(2)} confidence`);
        return event;
    } catch (error) {
        throw new Error(`Failed to load event: ${error instanceof Error ? error.message : String(error)}`);
    }
}