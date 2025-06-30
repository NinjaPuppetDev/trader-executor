type LogApiEndpoint = 'venice' | 'price-detections' | 'trade-execution';

// logFetcher.ts
export const fetchLogsByType = async (endpoint: LogApiEndpoint) => {
    try {
        // ... existing cache busting logic ...
        const res = await fetch(`${apiPath}?t=${now}`);
        const data = await res.json();
        return Array.isArray(data) ? data : []; // Ensure we always return an array
    } catch (error) {
        return []; // Return empty array on error
    }
};

export const fetchAllLogs = async () => { // Remove unused parameter
    try {
        const [veniceLogs, priceLogs, tradeLogs] = await Promise.all([
            fetchLogsByType('venice'),
            fetchLogsByType('price-detections'),
            fetchLogsByType('trade-execution')
        ]);

        // Ensure all are arrays before spreading
        return [
            ...(Array.isArray(veniceLogs) ? veniceLogs : []),
            ...(Array.isArray(priceLogs) ? priceLogs : []),
            ...(Array.isArray(tradeLogs) ? tradeLogs : [])
        ].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    } catch (error) {
        return []; // Return empty array on error
    }
};