// src/utils/technicalAnalyzer.ts
import { MarketDataState } from '../types';
import { BayesianPriceAnalyzer } from './BayesianPriceAnalyzer';

export const TechnicalAnalyzer = {
  analyze: (marketData: MarketDataState) => {
    try {
      const analysis = BayesianPriceAnalyzer.analyze(marketData);

      // Calculate standard deviation from variance
      const stdDev = Math.sqrt(analysis.variance);

      // Convert Bayesian analysis to trading signal
      let action: 'buy' | 'sell' | 'hold' = 'hold';
      let confidence = 50;

      // Calculate price deviation from prediction
      const priceDiff = Math.abs(marketData.currentPrice - analysis.predictedPrice);
      const deviation = priceDiff / stdDev;

      if (analysis.trendDirection === 'bullish') {
        if (marketData.currentPrice < analysis.predictedPrice) {
          action = 'buy';
          confidence = deviation > 1.5 ? 80 : 65;
        }
      } else if (analysis.trendDirection === 'bearish') {
        if (marketData.currentPrice > analysis.predictedPrice) {
          action = 'sell';
          confidence = deviation > 1.5 ? 80 : 65;
        }
      }

      return {
        action,
        confidence,
        stopLoss: analysis.stopLoss,
        takeProfit: analysis.takeProfit,
        state: `${analysis.trendDirection.toUpperCase()}_${deviation.toFixed(1)}SD`,
        reasoning: `Prediction: ${analysis.predictedPrice.toFixed(2)} (±${stdDev.toFixed(2)})`
      };
    } catch (error) {
      return {
        action: 'hold',
        confidence: 50,
        stopLoss: 0,
        takeProfit: 0,
        state: 'INSUFFICIENT_DATA',
        reasoning: 'Not enough data for Bayesian analysis'
      };
    }
  }
};