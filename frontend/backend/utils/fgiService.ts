const FGI_API_URL = "https://api.alternative.me/fng/";
const CACHE_TTL = 300000; // 5 minutes cache

interface FgiData {
    value: number;
    classification: string;
    timestamp: number;
}

let cachedFgi: FgiData | null = null;
let lastFetchTime = 0;

export async function getFearAndGreedIndex(): Promise<FgiData> {
    // Return cached data if still valid
    if (cachedFgi && Date.now() - lastFetchTime < CACHE_TTL) {
        return cachedFgi;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(FGI_API_URL, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`API error ${response.status}`);

        const data = await response.json();
        if (!data?.data?.length) throw new Error("Invalid API response");

        const latest = data.data[0];
        const value = parseInt(latest.value);

        if (isNaN(value) || value < 0 || value > 100) {
            throw new Error("Invalid FGI value");
        }

        // Interpret the value
        let classification = "Neutral";
        if (value >= 75) classification = "Extreme Greed";
        else if (value >= 55) classification = "Greed";
        else if (value <= 25) classification = "Extreme Fear";
        else if (value <= 45) classification = "Fear";

        cachedFgi = {
            value,
            classification,
            timestamp: parseInt(latest.timestamp)
        };

        lastFetchTime = Date.now();
        return cachedFgi;
    } catch (error) {
        console.error("FGI API Error:", error);

        // Return cached data even if stale when API fails
        if (cachedFgi) return cachedFgi;

        // Fallback to neutral if no cache
        return {
            value: 50,
            classification: "Neutral",
            timestamp: Math.floor(Date.now() / 1000)
        };
    }
}

// FGI interpretation guidelines
export function getFgiTradingGuidelines(fgi: number): string {
    if (fgi >= 75) return "Extreme Greed: Consider taking profits. Market likely overbought.";
    if (fgi >= 55) return "Greed: Be cautious with new positions. Consider profit-taking.";
    if (fgi <= 25) return "Extreme Fear: Potential buying opportunity. Market may be oversold.";
    if (fgi <= 45) return "Fear: Look for accumulation opportunities. Market may be undervalued.";
    return "Neutral: Market in balance. Evaluate other indicators for trading signals.";
}