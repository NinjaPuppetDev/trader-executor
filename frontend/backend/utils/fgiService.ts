import https from 'https';
import path from 'path';
import fs from 'fs';

const FGI_API_URL = 'api.alternative.me';
const FGI_API_PATH = '/fng/';
const CACHE_DIR = path.resolve(__dirname, '../cache');
const FGI_CACHE_FILE = path.join(CACHE_DIR, 'fgi-cache.json');

// Initialize cache directory
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
} catch (err) {
    console.error('❌ FGI cache directory error:', err);
}

export async function getFearAndGreedIndex(): Promise<{ value: number; classification: string }> {
    // Try cache first
    try {
        if (fs.existsSync(FGI_CACHE_FILE)) {
            const cacheContent = fs.readFileSync(FGI_CACHE_FILE, 'utf-8');
            if (cacheContent.trim() !== '') {
                const cache = JSON.parse(cacheContent);
                const cacheAge = Date.now() - new Date(cache.timestamp).getTime();
                if (cacheAge < 15 * 60 * 1000) { // 15 minutes
                    return cache.data;
                }
            }
        }
    } catch (err) {
        console.warn('⚠️ FGI cache read error:', err);
    }

    return new Promise((resolve) => {
        const options = {
            hostname: FGI_API_URL,
            path: FGI_API_PATH,
            method: 'GET',
            timeout: 5000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const fgiData = {
                        value: parseInt(result.data[0].value),
                        classification: result.data[0].value_classification
                    };

                    // Update cache
                    try {
                        fs.writeFileSync(FGI_CACHE_FILE, JSON.stringify({
                            data: fgiData,
                            timestamp: new Date().toISOString()
                        }, null, 2));
                    } catch (err) {
                        console.warn('⚠️ FGI cache write error:', err);
                    }

                    resolve(fgiData);
                } catch (error) {
                    console.error('❌ FGI API parsing error:', error);
                    resolve(getCachedFGI());
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ FGI API request error:', error);
            resolve(getCachedFGI());
        });

        req.on('timeout', () => {
            console.warn('⚠️ FGI API request timed out');
            req.destroy();
            resolve(getCachedFGI());
        });

        req.end();
    });
}

function getCachedFGI(): { value: number; classification: string } {
    try {
        if (fs.existsSync(FGI_CACHE_FILE)) {
            const cacheContent = fs.readFileSync(FGI_CACHE_FILE, 'utf-8');
            if (cacheContent.trim() !== '') {
                const cache = JSON.parse(cacheContent);
                return cache.data;
            }
        }
    } catch (err) {
        console.warn('⚠️ FGI cache fallback failed:', err);
    }
    return { value: 50, classification: 'Neutral' };
}