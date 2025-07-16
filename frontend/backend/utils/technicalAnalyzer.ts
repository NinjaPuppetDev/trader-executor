import { MarketDataState } from '../types';
import { BayesianPriceAnalyzer } from './BayesianPriceAnalyzer';

export const TechnicalAnalyzer = {
  analyze: (marketData: MarketDataState) => {
    try {
      const analysis = BayesianPriceAnalyzer.analyze(marketData);

      // Calculate dynamic volatility factor (Ethereum optimization)
      const volatilityFactor = 1 + (analysis.volatility / marketData.currentPrice) * 15;
      const buyThreshold = -0.5 / volatilityFactor;
      const sellThreshold = 0.5 / volatilityFactor;

      // Bayesian decision making
      let action: 'buy' | 'sell' | 'hold' = 'hold';
      let confidence = Math.floor(analysis.probability * 100);

      // Dynamic thresholds for Ethereum volatility
      if (analysis.trendDirection === 'bullish' && analysis.zScore < buyThreshold) {
        action = 'buy';
        confidence = Math.max(65, confidence);  // Lowered confidence floor
      }
      else if (analysis.trendDirection === 'bearish' && analysis.zScore > sellThreshold) {
        action = 'sell';
        confidence = Math.max(65, confidence);  // Lowered confidence floor
      }

      // Create human-readable state descriptor
      // Remove the first 'state' declaration and combine both approaches
      const stateModerateThreshold = 0.7 / volatilityFactor;
      const stateStrongThreshold = 1.4 / volatilityFactor;

      let stateStrength = '';
      if (Math.abs(analysis.zScore) > stateStrongThreshold) stateStrength = 'STRONG_';
      else if (Math.abs(analysis.zScore) > stateModerateThreshold) stateStrength = 'MODERATE_';

      // Combine strength with regime and trend direction
      const state = `${stateStrength}${analysis.regime.toUpperCase()}_${analysis.trendDirection.toUpperCase()}`;

      return {
        action,
        confidence,
        stopLoss: analysis.stopLoss,
        takeProfit: analysis.takeProfit,
        state,
        reasoning: `Bayesian edge: ${(analysis.probability * 100).toFixed(1)}% | ` +
          `Z: ${analysis.zScore.toFixed(2)} | ` +
          `VolFactor: ${volatilityFactor.toFixed(2)} | ` +
          `Threshold: ${(analysis.trendDirection === 'bullish' ? buyThreshold : sellThreshold).toFixed(2)} | ` +
          `Trend: ${analysis.trendDirection}`
      };
    } catch (error) {
      console.error('Bayesian analysis failed:', error);
      return {
        action: 'hold',
        confidence: 50,
        stopLoss: 0,
        takeProfit: 0,
        state: 'ANALYSIS_FAILURE',
        reasoning: `Error: ${error instanceof Error ? error.message : 'Unknown'}`
      };
    }
  }
};