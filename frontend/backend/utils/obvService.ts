import https from 'https';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const CACHE_DIR = path.resolve(__dirname, '../cache');
const CACHE_FILE = path.join(CACHE_DIR, 'obv-cache.json');

interface OBVData {
    value: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    lastUpdated: string;
}

// Initialize cache directory
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
} catch (err) {
    console.error('❌ OBV cache directory error:', err);
}

export async function getOnBalanceVolume(symbol: string = 'ETH/USDT'): Promise<OBVData> {
    // Try cache first
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
            const cacheAge = Date.now() - new Date(cache.lastUpdated).getTime();
            if (cacheAge < 15 * 60 * 1000 && cache.symbol === symbol) return cache;
        }
    } catch (err) {
        console.warn('⚠️ OBV cache read error:', err);
    }

    try {
        const obvData = await fetchObvData(symbol);

        // Update cache
        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...obvData, symbol }, null, 2));
        } catch (err) {
            console.warn('⚠️ OBV cache write error:', err);
        }

        return obvData;
    } catch (error) {
        console.error('❌ OBV calculation error:', error);

        // Fallback to cache if available
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        }

        return {
            value: 0,
            trend: 'neutral',
            lastUpdated: new Date().toISOString()
        };
    }
}

async function fetchObvData(symbol: string): Promise<OBVData> {
    return new Promise((resolve, reject) => {
        // This would be replaced with actual OBV calculation from price data
        // For now, we'll simulate based on market sentiment

        // In a real implementation, we would calculate OBV from price/volume data
        const simulatedValue = Math.random() * 1000000;
        const simulatedTrend = Math.random() > 0.6 ? 'bullish' :
            Math.random() > 0.3 ? 'bearish' : 'neutral';

        resolve({
            value: simulatedValue,
            trend: simulatedTrend,
            lastUpdated: new Date().toISOString()
        });
    });
}