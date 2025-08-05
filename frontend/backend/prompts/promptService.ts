import { MarketDataCollector } from "../utils/marketDataCollector";
import { BayesianPriceAnalyzer } from "../utils/bayesianPriceAnalyzer";
import { FundingRateAnalyzer } from "../fundingRateAnalyzer";
import { MarketDataState, BayesianRegressionResult, MarketRegime, OHLC } from "../types";
import { HistoricalDataService } from "../historicalDataService";
import { PositionManager } from "../positionManager";
import { AppDataSource } from "../priceTriggerListener";

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
    private fundingRateAnalyzer?: FundingRateAnalyzer
  ) {}

  private getMarketState(): MarketDataState {
    const state = this.marketDataCollector.getCurrentMarketState();
    return state || this.getFallbackState();
  }

  private getFallbackState(): MarketDataState {
    const price = 3000;
    const timestamp = Date.now();
    const candle: OHLC = {
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      timestamp: timestamp - 300000
    };

    return {
      ohlcHistory: [candle],
      currentCandle: candle,
      candleDuration: 300000,
      dataDuration: 300000,
      timestamp,
      symbol: this.symbol,
      currentPrice: price,
      additional: { high: price, low: price },
      regime: 'consolidating'
    };
  }

  async generatePromptConfig(): Promise<{ config: any; bayesianAnalysis: BayesianRegressionResult }> {
    const state = this.getMarketState();
    const analysis = BayesianPriceAnalyzer.analyze(state);
    const historicalService = new HistoricalDataService();
    const positionManager = new PositionManager();
    
    // Get funding rate sentiment if available
    let fundingStr = 'Not available';
    try {
      const fundingSentiment = this.fundingRateAnalyzer?.getCurrentSentiment();
      fundingStr = fundingSentiment 
        ? `${fundingSentiment.overallSentiment} (Score: ${fundingSentiment.score.toFixed(3)})`
        : 'Not available';
    } catch (error) {
      console.error('Error getting funding sentiment:', error);
    }

    // Get recent price history
    const pairId = parseInt(process.env.PAIR_ID || "1");
    let historyFormatted = "No history available";
    let trendAnalysis = "No trend analysis available";
    
    try {
      const history = await historicalService.getRecentPriceHistory(pairId);
      historyFormatted = historicalService.formatHistoryForPrompt(history);
      trendAnalysis = historicalService.analyzeTrend(history, state.currentPrice);
    } catch (error) {
      console.error('Error processing history:', error);
    }
    
    // Get current open position
    let openPosition = null;
    try {
      openPosition = await positionManager.getOpenPosition(pairId);
    } catch (error) {
      console.error('Error fetching position:', error);
    }

    // Calculate position PnL safely
    let positionCurrentPnL = 0;
    if (openPosition && state.currentPrice !== null) {
      positionCurrentPnL = openPosition.direction === 'long' 
        ? (state.currentPrice - openPosition.openPrice) * openPosition.amount
        : (openPosition.openPrice - state.currentPrice) * openPosition.amount;
    }
    
    // Prepare template data with null-safe formatting
    const templateData = {
      symbol: state.symbol.toUpperCase(),
      currentPrice: state.currentPrice !== null ? state.currentPrice.toFixed(4) : 'N/A',
      predictedPrice: analysis.predictedPrice.toFixed(4),
      volatilityPercent: (analysis.volatility * 100).toFixed(2),
      regime: analysis.regime.toUpperCase(),
      stopLoss: analysis.stopLoss.toFixed(4),
      takeProfit: analysis.takeProfit.toFixed(4),
      fundingSentiment: fundingStr,
      priceHistory: historyFormatted,
      trendAnalysis: trendAnalysis,
      hasOpenPosition: !!openPosition,
      positionDirection: openPosition?.direction || 'none',
      positionOpenPrice: openPosition?.openPrice?.toFixed(4) || 'N/A',
      positionCurrentPnL: positionCurrentPnL.toFixed(4),
      positionStopLoss: openPosition?.stopLoss?.toFixed(4) || 'N/A',
      positionTakeProfit: openPosition?.takeProfit?.toFixed(4) || 'N/A'
    };

    // System prompt template
    const sysTemplate = [
        'OHLC-BASED TRADING AGENT PROTOCOL - STRICT RULES APPLY',
        'Symbol: {{symbol}}',
        'Current Price: {{currentPrice}}',
        'Predicted Price: {{predictedPrice}}',
        'Volatility: {{volatilityPercent}}%',
        'Market Regime: {{regime}}',
        'Funding Rate Sentiment: {{fundingSentiment}}',
        '',
        'KEY LEVELS:',
        `Stop Loss: {{stopLoss}}`,
        `Take Profit: {{takeProfit}}`,
        '',
        'RECENT PRICE HISTORY:',
        '{{priceHistory}}',
        '',
        'TREND ANALYSIS:',
        '{{trendAnalysis}}',
        '',
        'POSITION MANAGEMENT RULES:',
        '1. If there is NO open position:',
        '   - You may OPEN a new position with "open" action',
        '2. If there is an OPEN position:',
        '   - You may CLOSE it with "close" action and positionId',
        '   - You may ADJUST stop loss/take profit with "adjust" action and positionId',
        '   - You may HOLD and do nothing',
        '3. Position actions:',
        '   - "open": Open a new position (requires all position fields)',
        '   - "close": Close existing position (requires positionId)',
        '   - "adjust": Update existing position (requires positionId and SL/TP)',
        '   - "hold": Maintain current position',
        '4. When closing:',
        '   - Always include positionId of the position to close',
        '   - Amount should be "0" for close actions',
        '5. When adjusting:',
        '   - Only update stopLoss and/or takeProfit',
        '   - Other fields remain unchanged',
        '',
        'OHLC VOLUME-BASED RULES:',
        '1. Volume Confirmation REQUIRED for breakouts',
        '2. Volume Divergence indicates potential reversals',
        '3. Low volume = reduced position sizing',
        '4. High volume spikes = increased confidence',
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
        '  "positionAction": "open|close|adjust|hold",',
        '  "decision": "buy|sell|hold",',
        '  "tokenIn": "STABLECOIN|VOLATILE",',
        '  "tokenOut": "STABLECOIN|VOLATILE",',
        '  "amount": "100.50", // MUST BE POSITIVE NUMBER FOR TRADES',
        '  "slippage": 0.5,',
        '  "stopLoss": 2950.25, // MUST BE NUMBER',
        '  "takeProfit": 3100.75, // MUST BE NUMBER',
        '  "positionId": "uuid-for-close-adjust", // REQUIRED FOR CLOSE/ADJUST',
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
    
    // Position context
    const positionContext = openPosition
      ? `CURRENT OPEN POSITION:
        - Direction: ${openPosition.direction.toUpperCase()} ${openPosition.direction === 'long' ? '📈' : '📉'}
        - Open Price: ${openPosition.openPrice?.toFixed(4) || 'N/A'}
        - Current PnL: ${positionCurrentPnL.toFixed(4)} ${positionCurrentPnL > 0 ? '✅' : '❌'}
        - Stop Loss: ${openPosition.stopLoss?.toFixed(4) || 'N/A'}
        - Take Profit: ${openPosition.takeProfit?.toFixed(4) || 'N/A'}`
      : 'NO OPEN POSITIONS';
    
    const instructions = `OHLC MARKET ANALYSIS:
    - Trend: ${trend.toUpperCase()} ${icon}
    - Confidence: ${(analysis.probability * 100).toFixed(1)}%
    - Volatility: ${(analysis.volatility * 100).toFixed(2)}%
    - Regime: ${analysis.regime.toUpperCase()}
    - Price Spike: [WILL BE ADDED LATER]
    
    ${positionContext}
    
    VOLUME-BASED TRADING RULES:
    1. Volume Confirmation: ${analysis.probability > 0.6 ? '✅' : '❌'} (Required for breakouts)
    2. Volume Strength: ${(analysis.volatility * 100).toFixed(1)}%
    3. Position sizing based on volume:
       - Low volume → 25-50% position size
       - Medium volume → 50-75% position size
       - High volume → 75-100% position size
    
    RISK MANAGEMENT:
    1. Bayesian Levels:
       - Stop Loss: ${analysis.stopLoss.toFixed(4)}
       - Take Profit: ${analysis.takeProfit.toFixed(4)}
    2. Max Risk: 1% per trade
    3. Volatility Scaling: Positions reduced during high volatility
    
    FUNDING RATE CONSIDERATIONS:
    1. Current Funding: ${fundingStr}
    2. Rules:
       - Positive funding → Longs pay shorts → Caution for new longs
       - Negative funding → Shorts pay longs → Caution for new shorts
       - Extreme sentiment (|score| > 0.8) indicates potential reversal
    
    YOUR EXECUTION PLAN:
    1. Analyze ALL factors (OHLC patterns, volume, regime, funding rates, position)
    2. Make FINAL decision considering:
       a. Volume confirmation status
       b. Bayesian confidence level
       c. Funding rate sentiment
       d. Current position status
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