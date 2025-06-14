import { getFearAndGreedIndex, getFgiTradingGuidelines } from './fgiService';

interface TokenMapping {
    [symbol: string]: string;
}

interface PromptConfig {
    system: string;
    instructions: string;
    token_mapping: TokenMapping;
    example: {
        reasoning: string;
        decision: string;
        tokenIn: string;
        tokenOut: string;
        amount: string;
        slippage: number;
    };
    market_context?: any;
}

export async function generatePromptConfig(): Promise<PromptConfig> {
    // Get real-time FGI data
    const fgiData = await getFearAndGreedIndex();
    const tradingGuidance = getFgiTradingGuidelines(fgiData.value);

    // Base configuration
    const baseConfig: PromptConfig = {
        system: `You are an institutional crypto trader. Current market sentiment: 
- Fear & Greed Index: ${fgiData.value} (${fgiData.classification})
- Trading Guidance: ${tradingGuidance}

Analyze market conditions and provide a trading decision based on technical indicators, market sentiment, and risk management principles.`,

        instructions: `Output a JSON object with these exact fields:
- reasoning: Brief explanation of your analysis
- decision: "buy", "sell", "hold", or "wait"
- tokenIn: Source token contract address
- tokenOut: Destination token contract address
- amount: Amount to trade (as a string)
- slippage: Max slippage percentage (1-100)

Use addresses from the token mapping. Follow these guidelines:
1. Risk Management: Never risk more than 5% of portfolio
2. Trend Following: Align with 50-day moving average
3. Sentiment: Consider Fear & Greed Index
4. Volatility: Adjust position size based on ATR`,

        token_mapping: {
            "TKNA": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
            "TKNB": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
            "ETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "BTC": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "DAI": "0x6B175474E89094C44Da98b954EedeAC495271d0F"
        },

        example: {
            reasoning: "FGI at 60 suggests greed. Taking partial profits on ETH position.",
            decision: "sell",
            tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            amount: "0.5",
            slippage: 1
        },

        market_context: {
            fgi: fgiData.value,
            fgi_classification: fgiData.classification,
            timestamp: new Date().toISOString()
        }
    };

    return baseConfig;
}