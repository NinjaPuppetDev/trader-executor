export const fetchAllLogs = async () => {
    try {
        const [veniceRes, priceTriggerRes, tradeExecutionsRes] = await Promise.all([
            fetch('/api/logs'),
            fetch('/api/price-trigger-logs'),
            fetch('/api/trade-executions')
        ]);

        const veniceLogs = await veniceRes.json();
        const priceTriggerLogs = await priceTriggerRes.json();
        const tradeExecutions = await tradeExecutionsRes.json();

        // Combine all logs
        const allLogs = [
            ...veniceLogs,
            ...priceTriggerLogs,
            ...tradeExecutions
        ];

        // Sort by timestamp
        allLogs.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        return allLogs;
    } catch (error) {
        console.error('Failed to fetch logs:', error);
        return [];
    }
};