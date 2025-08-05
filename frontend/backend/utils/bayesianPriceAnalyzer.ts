import { MarketDataState, BayesianRegressionResult, MarketRegime, OHLC, OrderBookSnapshot } from '../types';


export interface AnalyzerConfig {
  minDataPoints?: number;
  riskRewardRatio?: number;
  supportResistanceLookback?: number;
  volumeConfirmationThreshold?: number;
  volumeWeightedLookback?: number;
  obvLookback?: number;
  volumeProfileThreshold?: number;
  rsiPeriod?: number;
  volumeRsiPeriod?: number;
  vwapConfirmationThreshold?: number;
  volumeDivergenceThreshold?: number;
  recentCandlesForAverage?: number;
  minATRPeriod?: number;
  dailyATRMultiplier?: number;
  minStopDistancePercent?: number;
  maxStopDistancePercent?: number;
  maxVolatilityPercent?: number;
}

  export class BayesianPriceAnalyzer {
  private static readonly defaultConfig: Required<AnalyzerConfig> = {
    minDataPoints: 96,
    riskRewardRatio: 3.0,
    supportResistanceLookback: 672,
    volumeConfirmationThreshold: 1.8,
    volumeWeightedLookback: 96,
    obvLookback: 288,
    volumeProfileThreshold: 0.85,
    rsiPeriod: 21,
    volumeRsiPeriod: 14,
    vwapConfirmationThreshold: 0.02,
    volumeDivergenceThreshold: 0.4,
    recentCandlesForAverage: 32,
    minATRPeriod: 14,
    dailyATRMultiplier: 2.5,
    minStopDistancePercent: 0.015,
    maxStopDistancePercent: 0.05,
    maxVolatilityPercent: 0.08
  };

  static analyze(
    data: MarketDataState,
    config: AnalyzerConfig = {}
  ): BayesianRegressionResult {
    const cfg = { ...this.defaultConfig, ...config };
    
    if (!data.ohlcHistory || data.ohlcHistory.length < cfg.minDataPoints) {
      const currentPrice = data.currentPrice || 0;
      return this.neutralResult(currentPrice, cfg.riskRewardRatio);
    }

    const ohlc = data.ohlcHistory;
    const currentPrice = data.currentPrice || ohlc[ohlc.length - 1].close;
    const recentCandles = ohlc.slice(-cfg.recentCandlesForAverage);
    
    const defaultOrderBook: OrderBookSnapshot = { 
      bids: [], 
      asks: [], 
      timestamp: Date.now() 
    };
    const orderBook = data.orderBook || defaultOrderBook;
    
    const { support, resistance, volumeProfile } = 
      this.calculateVolumeBasedSupportResistance(ohlc, cfg.supportResistanceLookback, cfg.volumeProfileThreshold);
    
    const vwma = this.calculateVWMA(ohlc, cfg.volumeWeightedLookback);
    const obvAnalysis = this.analyzeOBV(ohlc, cfg.obvLookback);
    const rsi = this.calculateRSI(ohlc, cfg.rsiPeriod);
    const volumeRsi = this.calculateVolumeRSI(ohlc, cfg.volumeRsiPeriod);
    const vwapAnalysis = this.analyzeVWAP(ohlc);
    
    const orderFlowAnalysis = this.analyzeOrderFlow(ohlc, orderBook);
    const orderFlowSignals = this.detectOrderFlowSignals(
      currentPrice,
      orderBook,
      recentCandles,
      orderFlowAnalysis.volumeDelta
    );
    
    const regime = this.determineMarketRegime(
      ohlc,
      currentPrice,
      vwma,
      rsi,
      orderFlowAnalysis.bidAskImbalance
    );
    
    const priceActionSignals = this.detectPriceActionSignals(
      ohlc,
      currentPrice,
      support,
      resistance,
      obvAnalysis,
      rsi,
      volumeRsi,
      cfg,
      recentCandles,
      orderFlowAnalysis,
      orderFlowSignals
    );

    const arimaResult = this.analyzeARIMA(ohlc);
    const arimaWeight = this.calculateARIMAWeight(ohlc, arimaResult.confidence);
    const basePrediction = priceActionSignals.prediction;
    const combinedPrediction = arimaWeight > 0.3 
      ? (basePrediction * (1 - arimaWeight)) + (arimaResult.forecast * arimaWeight)
      : basePrediction;

    const { stopLoss, takeProfit } = this.calculateRiskLevels(
      ohlc,
      currentPrice,
      support,
      resistance,
      priceActionSignals.trendDirection,
      cfg,
      orderFlowAnalysis.liquidityClusters
    );

    return {
      predictedPrice: combinedPrediction,
      confidenceInterval: [support, resistance],
      stopLoss,
      takeProfit,
      trendDirection: priceActionSignals.trendDirection,
      volatility: vwapAnalysis.volatility,
      variance: 0,
      probability: priceActionSignals.confidence,
      zScore: 0,
      regime,
      indicators: {
        support,
        resistance,
        vwma: vwma.length > 0 ? vwma[vwma.length - 1] : currentPrice,
        obv: obvAnalysis.currentOBV,
        rsi: rsi.length > 0 ? rsi[rsi.length - 1] : 50,
        volumeRsi: volumeRsi.length > 0 ? volumeRsi[volumeRsi.length - 1] : 50,
        vwap: vwapAnalysis.currentVWAP,
        volumeDelta: orderFlowAnalysis.volumeDelta,
        bidAskImbalance: orderFlowAnalysis.bidAskImbalance,
        liquidityClusters: orderFlowAnalysis.liquidityClusters,
        arimaForecast: arimaResult.forecast,
        arimaConfidence: arimaResult.confidence
      }
    };
  }

  private static analyzeARIMA(ohlc: OHLC[]): { forecast: number; confidence: number } {
    if (ohlc.length < 10) return { forecast: 0, confidence: 0 };
    
    try {
      const prices = ohlc.map(c => c.close);
      const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
      const laggedReturns = returns.slice(0, -1);
      const currentReturns = returns.slice(1);
      
      const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const cov = (x: number[], y: number[]) => {
        const mx = mean(x), my = mean(y);
        return x.reduce((sum, _, i) => sum + (x[i] - mx) * (y[i] - my), 0) / x.length;
      };
      
      const phi = cov(laggedReturns, currentReturns) / cov(laggedReturns, laggedReturns);
      const lastReturn = returns[returns.length - 1];
      const forecastReturn = phi * lastReturn;
      const forecastPrice = prices[prices.length - 1] * (1 + forecastReturn);
      
      const predictedReturns = laggedReturns.map(r => phi * r);
      const ssRes = currentReturns.reduce((sum, r, i) => sum + Math.pow(r - predictedReturns[i], 2), 0);
      const ssTot = currentReturns.reduce((sum, r) => sum + Math.pow(r - mean(currentReturns), 2), 0);
      const rSquared = 1 - (ssRes / (ssTot || 1));
      
      return {
        forecast: forecastPrice,
        confidence: Math.min(0.95, Math.max(0.05, rSquared))
      };
    } catch {
      return { forecast: 0, confidence: 0 };
    }
  }

  private static calculateARIMAWeight(ohlc: OHLC[], arimaConfidence: number): number {
    if (ohlc.length < 20) return 0;
    
    const recentVolatility = this.calculateVolatility(ohlc.slice(-20));
    const volatilityFactor = 1 - Math.min(1, recentVolatility / 0.05);
    const trendStrength = this.calculateTrendStrength(ohlc);
    
    return Math.min(0.4, 
      (arimaConfidence * 0.6) + 
      (trendStrength * 0.3) + 
      (volatilityFactor * 0.1)
    );
  }

  private static calculateVolatility(ohlc: OHLC[]): number {
    const closes = ohlc.map(c => c.close);
    const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
    const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / closes.length;
    return Math.sqrt(variance);
  }

  private static calculateTrendStrength(ohlc: OHLC[]): number {
    if (ohlc.length < 10) return 0;
    
    const prices = ohlc.map(c => c.close);
    const smaShort = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const smaLong = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const priceChange = prices[prices.length - 1] - prices[0];
    const maxChange = Math.max(...prices) - Math.min(...prices);
    
    return Math.min(1, Math.abs(smaShort - smaLong) / (maxChange || 1) * 2);
  }

 private static calculateRiskLevels(
  ohlc: OHLC[],
  currentPrice: number,
  support: number,
  resistance: number,
  trendDirection: 'bullish' | 'bearish' | 'neutral',
  config: Required<AnalyzerConfig>,
  liquidityClusters: { price: number; bidLiquidity: number; askLiquidity: number }[]
): { stopLoss: number; takeProfit: number } {
  // 1. Calculate daily ATR for stable volatility measurement
  const dailyCandles = this.resampleToDaily(ohlc);
  const atr = dailyCandles.length >= config.minATRPeriod 
    ? this.calculateATR(dailyCandles, config.minATRPeriod) 
    : currentPrice * 0.02; // Fallback to 2% if insufficient data
  
  // 2. Dynamic multiplier based on volatility
  const volatilityRatio = atr / currentPrice;
  const atrMultiplier = volatilityRatio > 0.03 
    ? config.dailyATRMultiplier * 1.5 
    : volatilityRatio > 0.02 
      ? config.dailyATRMultiplier * 1.25 
      : config.dailyATRMultiplier;
  
  const atrStop = atr * atrMultiplier;

  // 3. Find nearest significant liquidity levels
  const nearLiquidity = liquidityClusters
    .filter(cl => trendDirection === 'bullish' 
      ? cl.price < currentPrice 
      : cl.price > currentPrice)
    .sort((a, b) => trendDirection === 'bullish' 
      ? b.price - a.price 
      : a.price - b.price)[0];
  
  // 4. Adaptive buffers for support/resistance (2-5% based on volatility)
  const bufferPercent = Math.min(0.05, Math.max(0.02, volatilityRatio * 2));
  const effectiveSupport = nearLiquidity?.price || support * (1 - bufferPercent);
  const effectiveResistance = nearLiquidity?.price || resistance * (1 + bufferPercent);

  // 5. Enforce minimum/maximum stop distances
  const minStopDistance = currentPrice * config.minStopDistancePercent;
  const maxStopDistance = currentPrice * config.maxStopDistancePercent;

  // 6. Calculate dynamic profit targets
  const minProfitDistance = Math.max(
    atr * 0.5, // Minimum 0.5 ATR
    currentPrice * 0.005 // Minimum 0.5%
  );
  
  const maxProfitDistance = Math.min(
    atr * 4, // Maximum 4 ATR
    currentPrice * 0.15 // Maximum 15%
  );

  if (trendDirection === 'bullish') {
    let stopLoss = Math.max(
      effectiveSupport,
      currentPrice - atrStop
    );
    
    // Enforce minimum distance
    if (currentPrice - stopLoss < minStopDistance) {
      stopLoss = currentPrice - minStopDistance;
    }
    // Enforce maximum distance
    else if (currentPrice - stopLoss > maxStopDistance) {
      stopLoss = currentPrice - maxStopDistance;
    }
    
    // Find nearest liquidity cluster above current price
    const profitTargets = liquidityClusters
      .filter(cl => cl.price > currentPrice)
      .sort((a, b) => a.price - b.price); // Ascending: nearest first
      
    let takeProfit = profitTargets.length > 0 
      ? profitTargets[0].price
      : currentPrice + minProfitDistance;
    
    // Ensure minimum profit threshold
    if (takeProfit - currentPrice < minProfitDistance) {
      takeProfit = currentPrice + minProfitDistance;
    }
    
    // Cap at max profit distance
    if (takeProfit - currentPrice > maxProfitDistance) {
      takeProfit = currentPrice + maxProfitDistance;
    }
    
    return { stopLoss, takeProfit };
  }
  
  if (trendDirection === 'bearish') {
    let stopLoss = Math.min(
      effectiveResistance,
      currentPrice + atrStop
    );
    
    // Enforce minimum distance
    if (stopLoss - currentPrice < minStopDistance) {
      stopLoss = currentPrice + minStopDistance;
    }
    // Enforce maximum distance
    else if (stopLoss - currentPrice > maxStopDistance) {
      stopLoss = currentPrice + maxStopDistance;
    }
    
    // Find nearest liquidity cluster below current price
    const profitTargets = liquidityClusters
      .filter(cl => cl.price < currentPrice)
      .sort((a, b) => b.price - a.price); // Descending: nearest first
      
    let takeProfit = profitTargets.length > 0 
      ? profitTargets[0].price
      : currentPrice - minProfitDistance;
    
    // Ensure minimum profit threshold
    if (currentPrice - takeProfit < minProfitDistance) {
      takeProfit = currentPrice - minProfitDistance;
    }
    
    // Cap at max profit distance
    if (currentPrice - takeProfit > maxProfitDistance) {
      takeProfit = currentPrice - maxProfitDistance;
    }
    
    return { stopLoss, takeProfit };
  }
  
  // Neutral position uses wider stops
  const neutralStop = Math.max(atrStop, minStopDistance);
  return {
    stopLoss: currentPrice - neutralStop,
    takeProfit: currentPrice + (neutralStop * config.riskRewardRatio)
  };
}

private static resampleToDaily(ohlc: OHLC[]): OHLC[] {
  if (ohlc.length === 0) return [];
  
  const dailyCandles: OHLC[] = [];
  let currentDay: number | null = null;
  let dailyCandle: OHLC | null = null; // Use full OHLC type instead of Partial
  
  for (const candle of ohlc) {
    const candleDate = new Date(candle.timestamp);
    const day = Date.UTC(
      candleDate.getUTCFullYear(), 
      candleDate.getUTCMonth(), 
      candleDate.getUTCDate()
    );
    
    if (day !== currentDay) {
      if (dailyCandle) {
        dailyCandles.push(dailyCandle);
      }
      
      currentDay = day;
      dailyCandle = {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        timestamp: day,
        buyVolume: candle.buyVolume || 0,  // Initialize with 0 if undefined
        sellVolume: candle.sellVolume || 0 // Initialize with 0 if undefined
      };
    } else {
      if (dailyCandle) {
        // Safe to access properties since we initialized them
        dailyCandle.high = Math.max(dailyCandle.high, candle.high);
        dailyCandle.low = Math.min(dailyCandle.low, candle.low);
        dailyCandle.close = candle.close;
        dailyCandle.volume += candle.volume;
        dailyCandle.buyVolume = (dailyCandle.buyVolume || 0) + (candle.buyVolume || 0);
        dailyCandle.sellVolume = (dailyCandle.sellVolume || 0) + (candle.sellVolume || 0);
      }
    }
  }
  
  if (dailyCandle) {
    dailyCandles.push(dailyCandle);
  }
  
  return dailyCandles;
}
  private static calculateATR(ohlc: OHLC[], period: number = 14): number {
    if (ohlc.length < period + 1) return 0;
    
    let sumTR = 0;
    // Calculate True Range for each candle
    for (let i = 1; i < ohlc.length; i++) {
      const candle = ohlc[i];
      const prevCandle = ohlc[i-1];
      
      const highLow = candle.high - candle.low;
      const highPrevClose = Math.abs(candle.high - prevCandle.close);
      const lowPrevClose = Math.abs(candle.low - prevCandle.close);
      
      const tr = Math.max(highLow, highPrevClose, lowPrevClose);
      sumTR += tr;
    }
    
    return sumTR / period;
  }

  private static analyzeOrderFlow(
    ohlc: OHLC[],
    orderBook: OrderBookSnapshot
  ): {
    volumeDelta: number;
    bidAskImbalance: number;
    liquidityClusters: { price: number; bidLiquidity: number; askLiquidity: number }[];
  } {
    const volumeDelta = ohlc.reduce((delta, candle) => 
      delta + (candle.buyVolume || 0) - (candle.sellVolume || 0), 0);

    const totalBid = orderBook.bids.reduce((sum, [_, q]) => sum + q, 0);
    const totalAsk = orderBook.asks.reduce((sum, [_, q]) => sum + q, 0);
    const bidAskImbalance = totalBid + totalAsk > 0 
      ? (totalBid - totalAsk) / (totalBid + totalAsk) 
      : 0;

    const liquidityMap = new Map<number, { bid: number; ask: number }>();
    orderBook.bids.forEach(([price, quantity]) => {
      const rounded = Math.round(price * 100) / 100;
      const entry = liquidityMap.get(rounded) || { bid: 0, ask: 0 };
      entry.bid += quantity;
      liquidityMap.set(rounded, entry);
    });
    orderBook.asks.forEach(([price, quantity]) => {
      const rounded = Math.round(price * 100) / 100;
      const entry = liquidityMap.get(rounded) || { bid: 0, ask: 0 };
      entry.ask += quantity;
      liquidityMap.set(rounded, entry);
    });
    
    const liquidityClusters = Array.from(liquidityMap.entries())
      .map(([price, { bid, ask }]) => ({
        price,
        bidLiquidity: bid,
        askLiquidity: ask
      }))
      .sort((a, b) => b.bidLiquidity - a.bidLiquidity)
      .slice(0, 5);

    return { volumeDelta, bidAskImbalance, liquidityClusters };
  }

  private static detectOrderFlowSignals(
    currentPrice: number,
    orderBook: OrderBookSnapshot,
    recentCandles: OHLC[],
    volumeDelta: number
  ): {
    absorption: boolean;
    stopRun: boolean;
    liquidityGrab: boolean;
  } {
    if (!orderBook.bids.length || !orderBook.asks.length || recentCandles.length < 2) {
      return { absorption: false, stopRun: false, liquidityGrab: false };
    }

    const nearBid = orderBook.bids[0][0];
    const nearAsk = orderBook.asks[0][0];
    const bidSize = orderBook.bids[0][1];
    const askSize = orderBook.asks[0][1];

    const absorption = 
      (currentPrice > nearAsk && volumeDelta > 0 && askSize > bidSize * 3) ||
      (currentPrice < nearBid && volumeDelta < 0 && bidSize > askSize * 3);

    const prevCandle = recentCandles[recentCandles.length - 2];
    const lastCandle = recentCandles[recentCandles.length - 1];
    const stopRun = 
      (lastCandle.high > prevCandle.high && volumeDelta < 0) ||
      (lastCandle.low < prevCandle.low && volumeDelta > 0);

    return { absorption, stopRun, liquidityGrab: absorption && stopRun };
  }

  private static calculateVolumeBasedSupportResistance(
    ohlc: OHLC[],
    lookback: number,
    volumeThreshold: number
  ): { support: number; resistance: number; volumeProfile: number[] } {
    const recent = ohlc.slice(-lookback);
    const volumeProfile: number[] = [];
    
    // Fallback to standard support/resistance if insufficient data
    if (recent.length < 5) {
      const prices = recent.map(c => c.close);
      return {
        support: Math.min(...prices),
        resistance: Math.max(...prices),
        volumeProfile: []
      };
    }
    
    // Calculate volume profile
    const priceLevels: { [key: string]: number } = {};
    recent.forEach(candle => {
      const levels = [candle.open, candle.high, candle.low, candle.close];
      levels.forEach(price => {
        const rounded = Math.round(price * 100) / 100;
        const key = rounded.toString();
        priceLevels[key] = (priceLevels[key] || 0) + candle.volume;
      });
    });
    
    // Find significant levels
    const maxVolume = Math.max(...Object.values(priceLevels));
    const significantLevels = Object.entries(priceLevels)
      .filter(([_, vol]) => vol > maxVolume * volumeThreshold)
      .map(([price]) => parseFloat(price))
      .sort((a, b) => a - b);
    
    // Find support and resistance
    const lastPrice = recent[recent.length - 1].close;
    const below = significantLevels.filter(p => p < lastPrice);
    const above = significantLevels.filter(p => p > lastPrice);
    
    const support = below.length > 0 ? Math.max(...below) : Math.min(...significantLevels);
    const resistance = above.length > 0 ? Math.min(...above) : Math.max(...significantLevels);
    
    return {
      support: isFinite(support) ? support : lastPrice * 0.98,
      resistance: isFinite(resistance) ? resistance : lastPrice * 1.02,
      volumeProfile: significantLevels
    };
  }

  private static calculateVWMA(ohlc: OHLC[], period: number): number[] {
    if (ohlc.length < period) return [];
    
    const vwma = [];
    for (let i = period - 1; i < ohlc.length; i++) {
      let sumTPV = 0;
      let sumVol = 0;
      
      for (let j = 0; j < period; j++) {
        const candle = ohlc[i - j];
        const typicalPrice = (candle.high + candle.low + candle.close) / 3;
        sumTPV += typicalPrice * candle.volume;
        sumVol += candle.volume;
      }
      
      vwma.push(sumTPV / sumVol);
    }
    return vwma;
  }

  private static analyzeOBV(ohlc: OHLC[], lookback: number): {
    currentOBV: number;
    trend: number;
    divergence: number;
  } {
    let obv = 0;
    const obvHistory: number[] = [];
    
    for (let i = 1; i < ohlc.length; i++) {
      const current = ohlc[i];
      const previous = ohlc[i-1];
      
      if (current.close > previous.close) {
        obv += current.volume;
      } else if (current.close < previous.close) {
        obv -= current.volume;
      } else {
        // No change in price, no OBV change
      }
      obvHistory.push(obv);
    }
    
    // Calculate OBV trend
    let obvTrend = 0;
    if (obvHistory.length >= lookback) {
      const recentOBV = obvHistory.slice(-lookback);
      obvTrend = (recentOBV[recentOBV.length - 1] - recentOBV[0]) / lookback;
    }
    
    // Calculate price trend
    let priceTrend = 0;
    if (ohlc.length >= lookback) {
      const recentPrices = ohlc.slice(-lookback).map(c => c.close);
      priceTrend = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / lookback;
    }
    
    return {
      currentOBV: obv,
      trend: obvTrend,
      divergence: Math.sign(priceTrend) !== Math.sign(obvTrend) ? Math.abs(priceTrend) : 0
    };
  }

  private static calculateRSI(ohlc: OHLC[], period: number): number[] {
    if (ohlc.length < period + 1) return [];
    
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < ohlc.length; i++) {
      const change = ohlc[i].close - ohlc[i-1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    const rsi: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;
    
    // Initial average
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
    
    // Subsequent periods
    for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
    
    return rsi;
  }

  private static calculateVolumeRSI(ohlc: OHLC[], period: number): number[] {
    if (ohlc.length < period + 1) return [];
    
    const volumeChanges: number[] = [];
    for (let i = 1; i < ohlc.length; i++) {
      volumeChanges.push(ohlc[i].volume - ohlc[i-1].volume);
    }
    
    const gains = volumeChanges.map(v => v > 0 ? v : 0);
    const losses = volumeChanges.map(v => v < 0 ? Math.abs(v) : 0);
    
    const vrsi: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;
    
    // Initial average
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    vrsi.push(100 - (100 / (1 + rs)));
    
    // Subsequent periods
    for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      vrsi.push(100 - (100 / (1 + rs)));
    }
    
    return vrsi;
  }

  private static analyzeVWAP(ohlc: OHLC[]): {
    currentVWAP: number;
    volatility: number;
    confirmed: boolean;
  } {
    if (ohlc.length === 0) return { currentVWAP: 0, volatility: 0, confirmed: false };
    
    // 1. Calculate VWAP
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    const vwapValues: number[] = [];
    
    for (const candle of ohlc) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
      vwapValues.push(cumulativeTPV / cumulativeVolume);
    }
    
    // 2. Calculate True Range volatility (more relevant for stops)
    let sumTR = 0;
    for (let i = 1; i < ohlc.length; i++) {
      const current = ohlc[i];
      const previous = ohlc[i-1];
      
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      sumTR += tr;
    }
    const volatility = sumTR / ohlc.length;
    
    // 3. Confirmation logic
    const lastCandle = ohlc[ohlc.length - 1];
    const currentVWAP = vwapValues[vwapValues.length - 1];
    const priceDiff = Math.abs(lastCandle.close - currentVWAP);
    const priceDiffPercent = priceDiff / currentVWAP;
    
    const volumes = ohlc.map(c => c.volume);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    
    return {
      currentVWAP,
      volatility,
      confirmed: priceDiffPercent > 0.005 && lastCandle.volume > avgVolume
    };
  }

  private static detectVolumeDivergence(
    ohlc: OHLC[],
    threshold: number
  ): { bullish: boolean; bearish: boolean } {
    if (ohlc.length < 10) return { bullish: false, bearish: false };
    
    const prices = ohlc.map(c => c.close);
    const volumes = ohlc.map(c => c.volume);
    
    // Find price peaks
    const pricePeaks: {index: number, value: number}[] = [];
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] > prices[i-1] && prices[i] > prices[i+1]) {
        pricePeaks.push({ index: i, value: prices[i] });
      }
    }
    
    // Find volume peaks
    const volumePeaks: {index: number, value: number}[] = [];
    for (let i = 1; i < volumes.length - 1; i++) {
      if (volumes[i] > volumes[i-1] && volumes[i] > volumes[i+1]) {
        volumePeaks.push({ index: i, value: volumes[i] });
      }
    }
    
    // Check for divergences in the last 2 peaks
    if (pricePeaks.length < 2 || volumePeaks.length < 2) {
      return { bullish: false, bearish: false };
    }
    
    const lastPricePeak = pricePeaks[pricePeaks.length - 1];
    const prevPricePeak = pricePeaks[pricePeaks.length - 2];
    const lastVolumePeak = volumePeaks[volumePeaks.length - 1];
    const prevVolumePeak = volumePeaks[volumePeaks.length - 2];
    
    let bullishDivergence = false;
    let bearishDivergence = false;
    
    // Bearish divergence: higher price high with lower volume high
    if (lastPricePeak.value > prevPricePeak.value && 
        lastVolumePeak.value < prevVolumePeak.value * (1 - threshold)) {
      bearishDivergence = true;
    }
    
    // Bullish divergence: lower price low with higher volume low
    if (lastPricePeak.value < prevPricePeak.value && 
        lastVolumePeak.value > prevVolumePeak.value * (1 + threshold)) {
      bullishDivergence = true;
    }
    
    return { bullish: bullishDivergence, bearish: bearishDivergence };
  }

  private static determineMarketRegime(
    ohlc: OHLC[],
    currentPrice: number,
    vwma: number[],
    rsi: number[],
    bidAskImbalance: number
  ): MarketRegime {
    if (vwma.length < 2) return 'consolidating';
    
    // Trend detection using VWMA
    const shortVWMA = vwma[vwma.length - 1];
    const longVWMA = vwma[Math.floor(vwma.length / 2)];
    const vwmaDiff = shortVWMA - longVWMA;
    const vwmaRatio = Math.abs(vwmaDiff) / longVWMA;
    
    // RSI based regime
    const lastRSI = rsi.length > 0 ? rsi[rsi.length - 1] : 50;
    
    if (vwmaRatio > 0.015) {
      return vwmaDiff > 0 ? 'uptrend' : 'downtrend';
    }
    
    if (lastRSI > 70 || lastRSI < 30) {
      return 'exhaustion';
    }
    
    return 'consolidating';
  }

  private static detectPriceActionSignals(
    ohlc: OHLC[],
    currentPrice: number,
    support: number,
    resistance: number,
    obvAnalysis: { divergence: number },
    rsi: number[],
    volumeRsi: number[],
    config: Required<AnalyzerConfig>,
    recentCandles: OHLC[],
    orderFlowAnalysis: { volumeDelta: number; bidAskImbalance: number },
    orderFlowSignals: { absorption: boolean; stopRun: boolean; }
): { trendDirection: 'bullish' | 'bearish' | 'neutral'; prediction: number; confidence: number } {
    if (ohlc.length < 2) {
        return {
            trendDirection: 'neutral',
            prediction: currentPrice,
            confidence: 0.5
        };
    }
    
    const lastCandle = ohlc[ohlc.length - 1];
    const prevCandle = ohlc[ohlc.length - 2];
    const lastRSI = rsi.length > 0 ? rsi[rsi.length - 1] : 50;
    const lastVolumeRSI = volumeRsi.length > 0 ? volumeRsi[volumeRsi.length - 1] : 50;
    
    // Order Flow Signals take priority
    if (orderFlowSignals.absorption) {
        if (currentPrice <= support * 0.995) {
            return {
                trendDirection: 'bullish',
                prediction: resistance,
                confidence: 0.85
            };
        }
        if (currentPrice >= resistance * 1.005) {
            return {
                trendDirection: 'bearish',
                prediction: support,
                confidence: 0.85
            };
        }
    }

    if (orderFlowSignals.stopRun) {
        return {
            trendDirection: orderFlowAnalysis.volumeDelta > 0 ? 'bullish' : 'bearish',
            prediction: orderFlowAnalysis.volumeDelta > 0 
                ? resistance * 1.03 
                : support * 0.97,
            confidence: 0.8
        };
    }

    // Support/Resistance Reactions
    const supportBuffer = support * 0.995;
    const resistanceBuffer = resistance * 1.005;
    
    // Bullish signals at support
    if (currentPrice <= supportBuffer) {
        const bullishConfidence = this.calculateSupportConfidence(
            lastCandle,
            recentCandles,
            obvAnalysis.divergence,
            lastRSI,
            lastVolumeRSI,
            config,
            orderFlowAnalysis
        );
        
        if (bullishConfidence > 0.6) {
            return {
                trendDirection: 'bullish',
                prediction: resistance,
                confidence: bullishConfidence
            };
        }
    }
    
    // Bearish signals at resistance
    if (currentPrice >= resistanceBuffer) {
        const bearishConfidence = this.calculateResistanceConfidence(
            lastCandle,
            recentCandles,
            obvAnalysis.divergence,
            lastRSI,
            lastVolumeRSI,
            config,
            orderFlowAnalysis
        );
        
        if (bearishConfidence > 0.6) {
            return {
                trendDirection: 'bearish',
                prediction: support,
                confidence: bearishConfidence
            };
        }
    }
    
    // Volume-Weighted Trend Confirmation
    if (lastCandle.close > lastCandle.open && 
        lastVolumeRSI > 60 && 
        lastCandle.volume > prevCandle.volume * config.volumeConfirmationThreshold) {
        return {
            trendDirection: 'bullish',
            prediction: resistance,
            confidence: 0.7
        };
    }
    
    if (lastCandle.close < lastCandle.open && 
        lastVolumeRSI < 40 && 
        lastCandle.volume > prevCandle.volume * config.volumeConfirmationThreshold) {
        return {
            trendDirection: 'bearish',
            prediction: support,
            confidence: 0.7
        };
    }
    
    // OBV Divergence Signals
    if (Math.abs(obvAnalysis.divergence) > config.volumeDivergenceThreshold) {
        if (lastRSI > 70 && lastVolumeRSI < 30) {
            return {
                trendDirection: 'bearish',
                prediction: support * 0.98,
                confidence: 0.75
            };
        }
        
        if (lastRSI < 30 && lastVolumeRSI > 70) {
            return {
                trendDirection: 'bullish',
                prediction: resistance * 1.02,
                confidence: 0.75
            };
        }
    }
    
    // Default neutral position
    return {
        trendDirection: 'neutral',
        prediction: currentPrice,
        confidence: 0.5
    };
}

private static getCandleAverageVolume(candle: OHLC, recentCandles: OHLC[]): number {
    // 1. Use candle's averageVolume if available
    if (candle.averageVolume !== undefined) {
        return candle.averageVolume;
    }
    
    // 2. Calculate from recent candles if available
    if (recentCandles.length > 0) {
        const volumes = recentCandles.map(c => c.volume);
        const average = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        return average;
    }
    
    // 3. Fallback to current candle's volume
    return candle.volume;
}

private static calculateSupportConfidence(
    candle: OHLC,
    recentCandles: OHLC[],
    obvDivergence: number,
    rsi: number,
    volumeRsi: number,
    config: Required<AnalyzerConfig>,
    orderFlowAnalysis: { volumeDelta: number; bidAskImbalance: number }
): number {
    const avgVolume = this.getCandleAverageVolume(candle, recentCandles);
    
    let confidence = 0.6;
    
    // Bullish reversal patterns
    if (candle.close > candle.open && candle.close > (candle.high + candle.low) / 2) {
        confidence += 0.15;
    }
    
    // Volume confirmation
    if (candle.volume > config.volumeConfirmationThreshold * avgVolume) {
        confidence += 0.15;
    }
    
    // OBV positive divergence
    if (obvDivergence > config.volumeDivergenceThreshold) {
        confidence += 0.1;
    }
    
    // Oversold conditions
    if (rsi < 35) {
        confidence += 0.05;
    }
    
    // Volume increasing at support
    if (volumeRsi > 60) {
        confidence += 0.05;
    }
    
    return Math.min(0.95, confidence);
}


private static calculateResistanceConfidence(
    candle: OHLC,
    recentCandles: OHLC[],
    obvDivergence: number,
    rsi: number,
    volumeRsi: number,
    config: Required<AnalyzerConfig>,
    orderFlowAnalysis: { volumeDelta: number; bidAskImbalance: number }
): number {
    // Safe average volume calculation
    const avgVolume = this.getCandleAverageVolume(candle, recentCandles);
    
    let confidence = 0.6;
    
    // Bearish reversal patterns
    if (candle.close < candle.open && candle.close < (candle.high + candle.low) / 2) {
      confidence += 0.15;
    }
    
    // Volume confirmation
    if (candle.volume > config.volumeConfirmationThreshold * avgVolume) {
      confidence += 0.15;
    }
    
    // OBV negative divergence
    if (obvDivergence < -config.volumeDivergenceThreshold) {
      confidence += 0.1;
    }
    
    // Overbought conditions
    if (rsi > 65) {
      confidence += 0.05;
    }
    
    // Volume decreasing at resistance
    if (volumeRsi < 40) {
      confidence += 0.05;
    }
    
    return Math.min(0.95, confidence);
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
      regime: 'consolidating',
      indicators: {
        support: currentPrice * 0.98,
        resistance: currentPrice * 1.02,
        vwma: currentPrice,
        obv: 0,
        rsi: 50,
        volumeRsi: 50,
        vwap: currentPrice,
        volumeDelta: 0,
        bidAskImbalance: 0,
        liquidityClusters: [],
        arimaForecast: 0,
        arimaConfidence: 0
      }
    };
  }
}