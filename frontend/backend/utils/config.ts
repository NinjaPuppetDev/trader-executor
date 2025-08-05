// config.ts
export const CONFIG = {
    // Network Configuration
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    privateKeyKeeper: process.env.KEEPER_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    privateKey: process.env.TRADER_PRIVATE_KEY || "",

    // Contract Addresses
    executorAddress: process.env.EXECUTOR_ADDRESS || "",
    stableToken: process.env.STABLE_TOKEN || "",
    volatileToken: process.env.VOLATILE_TOKEN || "",
    exchangeAddress: process.env.EXCHANGE_ADDRESS || "",
    priceTriggerAddress: process.env.PRICE_TRIGGER_ADDRESS || "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    tradeTriggerAddress: process.env.TRADE_TRIGGER_ADDRESS || "0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82",

    // Binance Trader Configuration
    binanceSymbol: process.env.BINANCE_SYMBOL || "ethusdt",
    dataBufferSize: parseInt(process.env.DATA_BUFFER_SIZE || "500"),
    minDataPoints: parseInt(process.env.MIN_DATA_POINTS || "50"),
    analysisTradeInterval: parseInt(process.env.ANALYSIS_TRADE_INTERVAL || "50"),
    analysisTimeInterval: parseInt(process.env.ANALYSIS_TIME_INTERVAL || "15000"),
    volumeSpikeThreshold: parseFloat(process.env.VOLUME_SPIKE_THRESHOLD || "2.0"),
    minConfidence: parseInt(process.env.MIN_CONFIDENCE || "65"),

    // Trading Parameters
    slippagePercent: parseFloat(process.env.SLIPPAGE_PERCENT || "1"),
    slippageIncrement: parseFloat(process.env.SLIPPAGE_INCREMENT || "1.5"),
    maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || "10"),
    minTradeAmount: parseFloat(process.env.MIN_TRADE_AMOUNT || "0.001"),
    maxTradeAmount: parseFloat(process.env.MAX_TRADE_AMOUNT || "0.04"),
    positionSizePercentage: parseFloat(process.env.POSITION_SIZE_PERCENT || "2"),
    minContractBalance: process.env.MIN_CONTRACT_BALANCE || "10",
    minStableLiquidity: process.env.MIN_STABLE_LIQUIDITY || "100",
    minVolatileLiquidity: process.env.MIN_VOLATILE_LIQUIDITY || "1",
    maxPriceImpact: process.env.MAX_PRICE_IMPACT || "0.05",

    // Other Parameters
    processingDelay: parseInt(process.env.PROCESSING_DELAY || "5000"),
    graphqlEndpoint: process.env.GRAPHQL_ENDPOINT || "http://localhost:4000/graphql",
    databasePath: process.env.DATABASE_PATH || "data/trigger-system.db",
    maxGasPrice: process.env.MAX_GAS_PRICE || "100",
    confidenceThreshold: 60,    // Minimum confidence to trigger
    replayInterval: 100,

    candleInterval: 300000, // 5 minutes
    candleBufferSize: 100, // ~8 hours of data
    ohlcMinDataPoints: 12,

    historicalReplaySpeed: 5,

};

// Add type safety
export type Config = typeof CONFIG;