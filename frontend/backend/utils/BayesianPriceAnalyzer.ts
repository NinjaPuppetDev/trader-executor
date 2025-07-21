import { MarketDataState, BayesianRegressionResult, MarketRegime } from '../types';

export interface AnalyzerConfig {
  minDataPoints?: number;
  riskRewardRatio?: number;
  supportResistanceLookback?: number;
  volumeConfirmationThreshold?: number;
  trendConfirmationThreshold?: number;
  breakoutConfirmationThreshold?: number;
  riskPercent?: number;
  volumeSpeedThreshold?: number; // NEW

}

export class BayesianPriceAnalyzer {
  private static readonly defaultConfig: Required<AnalyzerConfig> = {
    minDataPoints: 5,
    riskRewardRatio: 2.0,
    supportResistanceLookback: 20,
    volumeConfirmationThreshold: 1.25,
    trendConfirmationThreshold: 0.015,
    breakoutConfirmationThreshold: 0.01,
    riskPercent: 0.01,
    volumeSpeedThreshold: 0.05, // ~5% average upward change default

  };

  static analyze(
    data: MarketDataState,
    config: AnalyzerConfig = {}
  ): BayesianRegressionResult {
    const cfg = { ...this.defaultConfig, ...config };
    const { prices, currentPrice, volumes = [] } = data;

    if (prices.length < cfg.minDataPoints) {
      return this.neutralResult(currentPrice, cfg.riskRewardRatio);
    }

    const { support, resistance } = this.findSupportResistance(
      prices, 
      cfg.supportResistanceLookback
    );
    
    const priceSpeed = this.calculatePriceSpeed(prices);
    const volumeConfirmed = volumes.length > 0 
      ? this.checkVolumeConfirmation(volumes, cfg.volumeConfirmationThreshold)
      : false;

    const { trendDirection, prediction } = this.assessPricePosition(
      currentPrice,
      support,
      resistance,
      priceSpeed,
      volumeConfirmed,
      cfg.trendConfirmationThreshold,
      cfg.breakoutConfirmationThreshold
    );

    const { stopLoss, takeProfit } = this.priceActionRiskLevels(
      currentPrice,
      support,
      resistance,
      trendDirection,
      cfg.riskRewardRatio,
      cfg.riskPercent
    );

    const confidence = this.calculatePositionConfidence(
      currentPrice, 
      support, 
      resistance,
      volumeConfirmed
    );

    return {
      predictedPrice: prediction,
      confidenceInterval: [support, resistance],
      stopLoss,
      takeProfit,
      trendDirection,
      volatility: (resistance - support) / currentPrice,
      variance: 0,
      probability: confidence,
      zScore: 0,
      regime: this.determineMarketRegime(support, resistance, currentPrice)
    };
  }

  private static assessPricePosition(
    currentPrice: number,
    support: number,
    resistance: number,
    priceSpeed: number,
    volumeConfirmed: boolean,
    trendThreshold: number,
    breakoutThreshold: number
  ): { trendDirection: 'bullish' | 'bearish' | 'neutral'; prediction: number } {
    const range = resistance - support;
    const position = (currentPrice - support) / range;
    
    // Breakout detection
    if (currentPrice > resistance * (1 + breakoutThreshold) && volumeConfirmed) {
      return { trendDirection: 'bullish', prediction: currentPrice + range * 0.5 };
    }
    if (currentPrice < support * (1 - breakoutThreshold) && volumeConfirmed) {
      return { trendDirection: 'bearish', prediction: currentPrice - range * 0.5 };
    }
    
    // Trend detection
    const bullishSpeed = priceSpeed > trendThreshold;
    const bearishSpeed = priceSpeed < -trendThreshold;
    
    if (position > 0.6 && bullishSpeed) {
      return { trendDirection: 'bullish', prediction: resistance };
    }
    if (position < 0.4 && bearishSpeed) {
      return { trendDirection: 'bearish', prediction: support };
    }
    
    // Mean reversion
    if (position > 0.7) {
      return { trendDirection: 'bearish', prediction: support + range * 0.3 };
    }
    if (position < 0.3) {
      return { trendDirection: 'bullish', prediction: resistance - range * 0.3 };
    }
    
    return { trendDirection: 'neutral', prediction: currentPrice };
  }

  private static priceActionRiskLevels(
    currentPrice: number,
    support: number,
    resistance: number,
    trendDirection: 'bullish' | 'bearish' | 'neutral',
    riskReward: number,
    riskPercent: number
  ) {
    const range = resistance - support;
    const riskDistance = currentPrice * riskPercent;
    
    let stopLoss: number, takeProfit: number;
    
    if (trendDirection === 'bullish') {
      stopLoss = support - (range * 0.01);
      takeProfit = resistance + (riskDistance * riskReward);
    } 
    else if (trendDirection === 'bearish') {
      stopLoss = resistance + (range * 0.01);
      takeProfit = support - (riskDistance * riskReward);
    } 
    else {
      stopLoss = currentPrice - riskDistance;
      takeProfit = currentPrice + riskDistance;
    }
    
    // Ensure logical values
    if (trendDirection === 'bullish') {
      stopLoss = Math.min(stopLoss, currentPrice - riskDistance);
    } else if (trendDirection === 'bearish') {
      stopLoss = Math.max(stopLoss, currentPrice + riskDistance);
    }
    
    return { stopLoss, takeProfit };
  }

  private static findSupportResistance(
    prices: number[], 
    lookback: number
  ): { support: number; resistance: number } {
    const recentPrices = prices.slice(-lookback);
    if (!recentPrices.length) {
      const lastPrice = prices[prices.length - 1] || 1;
      return { support: lastPrice, resistance: lastPrice };
    }

    const range = Math.max(1, Math.max(...recentPrices) - Math.min(...recentPrices));
    const gridSize = range / 20;
    const clusters = new Map<number, number>();
    
    recentPrices.forEach(price => {
      const level = Math.round(price / gridSize) * gridSize;
      clusters.set(level, (clusters.get(level) || 0) + 1);
    });

    const currentPrice = recentPrices[recentPrices.length - 1];
    const minPrice = Math.min(...recentPrices);
    const maxPrice = Math.max(...recentPrices);
    
    let support = minPrice;
    let maxSupportCount = 0;
    let resistance = maxPrice;
    let maxResistanceCount = 0;
    
    clusters.forEach((count, level) => {
      // Support detection (lower 30% of range)
      if (level >= minPrice && level <= minPrice + (maxPrice - minPrice) * 0.3) {
        if (count > maxSupportCount) {
          support = level;
          maxSupportCount = count;
        }
      }
      
      // Resistance detection (upper 30% of range)
      if (level >= maxPrice - (maxPrice - minPrice) * 0.3 && level <= maxPrice) {
        if (count > maxResistanceCount) {
          resistance = level;
          maxResistanceCount = count;
        }
      }
    });

    return { support, resistance };
  }

  private static calculatePriceSpeed(prices: number[]): number {
    if (prices.length < 3) return 0;
    
    const recent = prices.slice(-5);
    const weights = [0.1, 0.15, 0.25, 0.3, 0.4].slice(0, recent.length - 1);
    let totalWeight = 0;
    let weightedChange = 0;
    
    for (let i = 1; i < recent.length; i++) {
      const change = (recent[i] - recent[i-1]) / recent[i-1];
      weightedChange += change * weights[i-1];
      totalWeight += weights[i-1];
    }
    
    return weightedChange / totalWeight;
  }

  private static checkVolumeConfirmation(
    volumes: number[],
    magnitudeThreshold: number,
    speedThreshold?: number // optional
  ): boolean {
    if (volumes.length < 5) return false;
  
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
    const basicConfirmed = currentVolume > avgVolume * magnitudeThreshold;
  
    if (speedThreshold === undefined) {
      return basicConfirmed;
    }
  
    const speed = this.calculateVolumeSpeed(volumes);
    const speedConfirmed = speed > speedThreshold;
  
    return basicConfirmed && speedConfirmed;
  }
  

  private static calculateVolumeSpeed(volumes: number[]): number {
    if (volumes.length < 3) return 0;
  
    const recent = volumes.slice(-5);
    let deltaSum = 0;
  
    for (let i = 1; i < recent.length; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      if (prev > 0) {
        deltaSum += (curr - prev) / prev;
      }
    }
  
    return deltaSum / (recent.length - 1);
  }
  

  private static calculatePositionConfidence(
    currentPrice: number,
    support: number,
    resistance: number,
    volumeConfirmed: boolean
  ): number {
    const range = resistance - support;
    if (range <= 0) return 0.5;
    
    const position = (currentPrice - support) / range;
    let confidence = 0.6;
    
    // Increase confidence at range extremes
    if (position < 0.15 || position > 0.85) {
      confidence = 0.75;
    }
    
    // Boost confidence with volume confirmation
    if (volumeConfirmed) {
      confidence = Math.min(0.9, confidence + 0.15);
    }
    
    return confidence;
  }

  private static determineMarketRegime(
    support: number,
    resistance: number,
    currentPrice: number
  ): MarketRegime {
    const range = resistance - support;
    const rangePercentage = range / currentPrice;
    
    if (rangePercentage < 0.02) {
      return 'consolidating';
    }
    
    return currentPrice > resistance || currentPrice < support
      ? 'trending'
      : 'transitioning';
  }

  private static neutralResult(
    currentPrice: number, 
    riskReward: number
  ): BayesianRegressionResult {
    return {
      predictedPrice: currentPrice,
      confidenceInterval: [currentPrice * 0.98, currentPrice * 1.02],
      stopLoss: currentPrice * 0.98,
      takeProfit: currentPrice * 1.02 * riskReward,
      trendDirection: 'neutral',
      volatility: 0.02,
      variance: 0,
      probability: 0.5,
      zScore: 0,
      regime: 'consolidating'
    };
  }
}