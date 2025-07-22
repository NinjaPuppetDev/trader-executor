// Updated promptService.ts
import { MarketDataCollector } from "../utils/marketDataCollector";
import { BayesianPriceAnalyzer } from "../utils/bayesianPriceAnalyzer";
import { FundingRateAnalyzer } from "../fundingRateAnalyzer"; // Add import
import { MarketDataState, BayesianRegressionResult, MarketRegime } from "../types";

function renderTemplate<T extends Record<string, unknown>>(template: string, data: T): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    key in data ? String(data[key as keyof T]) : ''
  );
}

type Trend = 'bullish' | 'bearish' | 'neutral';

export class PromptService {
  private ICONS: Record<Trend, string> = {
    bullish: '↑',
    bearish: '↓',
    neutral: '➡',
  };

  constructor(
    private marketDataCollector: MarketDataCollector,
    private symbol: string = 'ethusdt',
    private fundingRateAnalyzer?: FundingRateAnalyzer // Add optional parameter
  ) {}

  private getMarketState(): MarketDataState {
    const state = this.marketDataCollector.getCurrentMarketState();
    return state || this.getFallbackState();
  }

  private getFallbackState(): MarketDataState {
    const price = 3000;
    return {
      prices: [price],
      volumes: [0],
      currentPrice: price,
      averageVolume: 0,
      timestamp: Date.now(),
      symbol: this.symbol,
      regime: 'consolidating',
      additional: { high: price, low: price },
    } as MarketDataState;
  }

  generatePromptConfig(): { config: any; bayesianAnalysis: BayesianRegressionResult } {
    const state = this.getMarketState();
    const analysis = BayesianPriceAnalyzer.analyze(state);
    
    // Get funding rate sentiment if available
    const fundingSentiment = this.fundingRateAnalyzer?.getCurrentSentiment();
    const fundingStr = fundingSentiment 
      ? `${fundingSentiment.overallSentiment} (Score: ${fundingSentiment.score.toFixed(3)})`
      : 'Not available';

    const templateData = {
      symbol: state.symbol.toUpperCase(),
      currentPrice: state.currentPrice.toFixed(4),
      predictedPrice: analysis.predictedPrice.toFixed(4),
      volatilityPercent: (analysis.volatility * 100).toFixed(2),
      regime: analysis.regime.toUpperCase(),
      stopLoss: analysis.stopLoss.toFixed(4),
      takeProfit: analysis.takeProfit.toFixed(4),
      fundingSentiment: fundingStr // Add to template
    };

    const sysTemplate = [
        'TRADING AGENT PROTOCOL - STRICT RULES APPLY',
        'Symbol: {{symbol}}',
        'Current Price: {{currentPrice}}',
        'Predicted Price: {{predictedPrice}}',
        'Volatility: {{volatilityPercent}}%',
        'Market Regime: {{regime}}',
        'Funding Rate Sentiment: {{fundingSentiment}}', // New line
        '',
        'KEY LEVELS:',
        `Stop Loss: {{stopLoss}}`,
        `Take Profit: {{takeProfit}}`,
        '',
        'ABSOLUTE REQUIREMENTS:',
        '1. For BUY/SELL decisions:',
        '   - tokenIn MUST be "STABLECOIN" for BUY',
        '   - tokenOut MUST be "VOLATILE" for BUY',
        '   - tokenIn MUST be "VOLATILE" for SELL',
        '   - tokenOut MUST be "STABLECOIN" for SELL',
        '   - amount MUST be a POSITIVE NUMBER',
        '   - stopLoss MUST be a NUMBER',
        '   - takeProfit MUST be a NUMBER',
        '',
        '2. For HOLD decisions:',
        '   - decision MUST be "hold"',
        '   - amount MUST be "0"',
        '',
        '3. NEVER:',
        '   - Use token addresses (0x...)',
        '   - Return incomplete JSON',
        '   - Omit any required fields',
        '',
        'OUTPUT FORMAT - COMPLETE VALID JSON ONLY:',
        '{',
        '  "decision": "buy|sell|hold",',
        '  "tokenIn": "STABLECOIN|VOLATILE",',
        '  "tokenOut": "STABLECOIN|VOLATILE",',
        '  "amount": "100.50", // MUST BE POSITIVE NUMBER FOR TRADES',
        '  "slippage": 0.5,',
        '  "stopLoss": 2950.25, // MUST BE NUMBER',
        '  "takeProfit": 3100.75, // MUST BE NUMBER',
        '  "reasoning": "Detailed analysis here..."',
        '}',
        '',
        'FAILURE EXAMPLE (INVALID):',
        '{',
        '  "decision": "buy",',
        '  "tokenIn": "STABLECOIN",',
        '  "tokenOut": "VOLATILE",',
        '  "amount": "0", // INVALID FOR BUY/SELL',
        '  "slippage": 0.5',
        '  // MISSING stopLoss/takeProfit',
        '}',
        '',
        'CRITICAL: COMPLETE THE ENTIRE JSON OBJECT!'
    ].join('\n');

    const system = renderTemplate(sysTemplate, templateData);

    const trend = analysis.trendDirection as Trend;
    const icon = this.ICONS[trend];
    
    // Add funding rate interpretation to rules
    const instructions = `CURRENT MARKET ANALYSIS:
    - Trend: ${trend.toUpperCase()} ${icon}
    - Confidence: ${(analysis.probability * 100).toFixed(1)}%
    - Volatility: ${(analysis.volatility * 100).toFixed(2)}%
    - Regime: ${analysis.regime.toUpperCase()}
    - Price Spike: [WILL BE ADDED LATER]
    
    TRADING RULES:
    1. Only execute trades when confidence > 60%
    2. Use Bayesian levels as reference:
       - Stop Loss: ${analysis.stopLoss.toFixed(4)}
       - Take Profit: ${analysis.takeProfit.toFixed(4)}
    3. For BUY: tokenIn="STABLECOIN", tokenOut="VOLATILE", amount > 0
    4. For SELL: tokenIn="VOLATILE", tokenOut="STABLECOIN", amount > 0
    5. For HOLD: amount="0"
    6. Consider funding rate sentiment:
       - Positive funding → Longs pay shorts → Caution for new longs
       - Negative funding → Shorts pay longs → Caution for new shorts
       - Extreme sentiment (|score| > 0.8) indicates potential reversal
    
    YOUR TASK:
    1. Analyze ALL factors (price, volume, regime, funding rates)
    2. Make FINAL decision (buy/sell/hold) considering:
       a. Bayesian confidence level
       b. Funding rate sentiment extremes
       c. Market regime context
    3. Return COMPLETE, VALID JSON with ALL required fields
    4. NEVER truncate the response`;
    
    return {
        config: {
            system,
            instructions
        },
        bayesianAnalysis: analysis
    };
  }
}