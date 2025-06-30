// frontend/config.ts
export const WS_CONFIG = {
    priceTrigger: process.env.NEXT_PUBLIC_PRICE_WS_URL || 'ws://localhost:8080',
    tradeExecutor: process.env.NEXT_PUBLIC_TRADE_WS_URL || 'ws://localhost:8081'
};