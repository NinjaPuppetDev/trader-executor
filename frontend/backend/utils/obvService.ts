import https from 'https';
import path from 'path';
import fs from 'fs';

const CACHE_DIR = path.resolve(__dirname, '../cache');
const OBV_CACHE_FILE = path.join(CACHE_DIR, 'obv-cache.json');

interface OBVData {
    value: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    lastUpdated: string;
    currentPrice: number;
    priceChange24h: number;
    priceChangePercent: number;
    cacheKey: string;
}

// CoinGecko ID mapping
const COIN_ID_MAP: Record<string, string> = {
    ETH: "ethereum",
    BTC: "bitcoin",
    SOL: "solana",
    // Add other symbols as needed
};

export async function getOnBalanceVolume(symbol: string = 'ETH'): Promise<OBVData> {
    const coinId = COIN_ID_MAP[symbol.toUpperCase()] || symbol.toLowerCase();
    const cacheKey = `${symbol}-${coinId}`;

    // Try cache first
    try {
        if (fs.existsSync(OBV_CACHE_FILE)) {
            const cacheContent = fs.readFileSync(OBV_CACHE_FILE, 'utf-8');
            if (cacheContent.trim() !== '') {
                const cache = JSON.parse(cacheContent);
                const cacheAge = Date.now() - new Date(cache.lastUpdated).getTime();
                if (cacheAge < 15 * 60 * 1000 && cache.cacheKey === cacheKey) {
                    return cache;
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ OBV cache read error:', err);
    }

    const apiKey = process.env.COINGECKO_API_KEY || '';
    const path = `/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=60&interval=daily`;

    return new Promise((resolve) => {
        const options = {
            hostname: 'api.coingecko.com',
            path,
            method: 'GET',
            headers: {
                'User-Agent': 'Node.js Crypto Trader',
                ...(apiKey ? { 'x-cg-demo-api-key': apiKey } : {})
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const obv = calculateOBV(result.prices, result.total_volumes);
                    const trend = determineTrend(obv.values);

                    // Calculate price changes
                    const prices = result.prices;
                    const currentPrice = prices[prices.length - 1][1];
                    const price24hAgo = prices.length > 24 ? prices[prices.length - 25][1] : prices[0][1];
                    const priceChange24h = currentPrice - price24hAgo;
                    const priceChangePercent = (priceChange24h / price24hAgo) * 100;

                    const obvData = {
                        value: obv.currentValue,
                        trend,
                        currentPrice,
                        priceChange24h,
                        priceChangePercent,
                        lastUpdated: new Date().toISOString(),
                        cacheKey
                    };

                    // Update cache
                    try {
                        fs.writeFileSync(OBV_CACHE_FILE, JSON.stringify(obvData, null, 2));
                    } catch (err) {
                        console.warn('⚠️ OBV cache write error:', err);
                    }

                    resolve(obvData);
                } catch (error) {
                    console.error('❌ OBV data parsing error:', error);
                    resolve(getCachedOBV(cacheKey));
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ OBV API request error:', error);
            resolve(getCachedOBV(cacheKey));
        });

        req.on('timeout', () => {
            console.warn('⚠️ OBV API request timed out');
            req.destroy();
            resolve(getCachedOBV(cacheKey));
        });

        req.end();
    });
}

function getCachedOBV(cacheKey: string): OBVData {
    try {
        if (fs.existsSync(OBV_CACHE_FILE)) {
            const cacheContent = fs.readFileSync(OBV_CACHE_FILE, 'utf-8');
            if (cacheContent.trim() !== '') {
                const cache = JSON.parse(cacheContent);
                if (cache.cacheKey === cacheKey) {
                    return cache;
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ OBV cache fallback failed:', err);
    }

    return {
        value: 0,
        trend: 'neutral',
        currentPrice: 0,
        priceChange24h: 0,
        priceChangePercent: 0,
        lastUpdated: new Date().toISOString(),
        cacheKey
    };
}

// Rest of OBVService remains the same (calculateOBV, determineTrend)

function calculateOBV(prices: [number, number][], volumes: [number, number][]): {
    values: number[];
    currentValue: number
} {
    if (prices.length !== volumes.length || prices.length < 2) {
        throw new Error('Insufficient data for OBV calculation');
    }

    // Sort by timestamp just in case
    prices.sort((a, b) => a[0] - b[0]);
    volumes.sort((a, b) => a[0] - b[0]);

    const obvValues: number[] = [0]; // Start with OBV 0
    let prevPrice = prices[0][1];

    for (let i = 1; i < prices.length; i++) {
        const currentPrice = prices[i][1];
        const currentVolume = volumes[i][1];
        let obv = obvValues[i - 1];

        if (currentPrice > prevPrice) {
            // Bullish: add volume
            obv += currentVolume;
        } else if (currentPrice < prevPrice) {
            // Bearish: subtract volume
            obv -= currentVolume;
        }
        // If equal, OBV remains the same

        obvValues.push(obv);
        prevPrice = currentPrice;
    }

    return {
        values: obvValues,
        currentValue: obvValues[obvValues.length - 1]
    };
}

function determineTrend(obvValues: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (obvValues.length < 3) return 'neutral';

    const lastThree = obvValues.slice(-3);
    const trendStrength = lastThree[2] - lastThree[0]; // Net change over 3 periods

    if (trendStrength > 0) {
        // Bullish if last value > first value
        return 'bullish';
    } else if (trendStrength < 0) {
        // Bearish if last value < first value
        return 'bearish';
    }

    // Neutral if no net change
    return 'neutral';
}

export async function getCurrentPrice(symbol: string = 'ETH'): Promise<number> {
    try {
        const coinId = COIN_ID_MAP[symbol.toUpperCase()] || symbol.toLowerCase();
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;

        const response = await new Promise<string>((resolve, reject) => {
            const req = https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });

        const data = JSON.parse(response);
        return data[coinId].usd;
    } catch (error) {
        console.error('❌ Current price fetch error:', error);
        return 0;
    }
}