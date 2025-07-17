import { MarketDataState } from '../types';
import { BayesianPriceAnalyzer } from './BayesianPriceAnalyzer';

export const TechnicalAnalyzer = {
  analyze: (marketData: MarketDataState) => {
    try {
      const analysis = BayesianPriceAnalyzer.analyze(marketData);

      // Improved volatility scaling with floor (minimum 1.5)
      const volatilityFactor = Math.max(
        1.5,
        1 + (analysis.volatility / marketData.currentPrice) * 10
      );

      // Dynamic thresholds using volatility factor
      const buyThreshold = -0.7 * volatilityFactor;  // More conservative entry
      const sellThreshold = 0.7 * volatilityFactor;

      // State thresholds with volatility scaling
      const stateModerateThreshold = 1.0 * volatilityFactor;
      const stateStrongThreshold = 2.0 * volatilityFactor;

      // Bayesian decision making
      let action: 'buy' | 'sell' | 'hold' = 'hold';
      let confidence = Math.floor(analysis.probability * 100);

      // Dynamic thresholds for volatility
      if (analysis.trendDirection === 'bullish' && analysis.zScore < buyThreshold) {
        action = 'buy';
        confidence = Math.max(65, confidence);
      }
      else if (analysis.trendDirection === 'bearish' && analysis.zScore > sellThreshold) {
        action = 'sell';
        confidence = Math.max(65, confidence);
      }

      // Create human-readable state descriptor
      let stateStrength = '';
      if (Math.abs(analysis.zScore) > stateStrongThreshold) stateStrength = 'STRONG_';
      else if (Math.abs(analysis.zScore) > stateModerateThreshold) stateStrength = 'MODERATE_';

      const state = `${stateStrength}${analysis.regime.toUpperCase()}_${analysis.trendDirection.toUpperCase()}`;

      return {
        action,
        confidence,
        stopLoss: action !== 'hold' ? analysis.stopLoss : 0,
        takeProfit: action !== 'hold' ? analysis.takeProfit : 0,
        state,
        reasoning: `Bayesian edge: ${(analysis.probability * 100).toFixed(1)}% | ` +
          `Z: ${analysis.zScore.toFixed(2)} | ` +
          `VolFactor: ${volatilityFactor.toFixed(2)} | ` +
          `Threshold: ${action !== 'hold'
            ? (action === 'buy' ? buyThreshold : sellThreshold).toFixed(2)
            : 'N/A'
          } | ` +
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