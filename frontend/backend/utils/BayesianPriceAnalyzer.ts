import { MarketDataState, MarketRegime, BayesianRegressionResult } from '../types';

// Extended interface for enhanced results (backwards compatible)
export interface EnhancedBayesianResult extends BayesianRegressionResult {
    randomWalkBias?: number;
    meanReversion?: number;
    adaptiveVolatility?: number;
    modelConfidence?: number;
    alternativeScenarios?: {
        bearish: { price: number; probability: number };
        neutral: { price: number; probability: number };
        bullish: { price: number; probability: number };
    };
}

export class BayesianPriceAnalyzer {
    private static readonly MIN_DATA_POINTS = 24;
    private static readonly MAX_WINDOW_SIZE = 200;
    private static readonly PREDICTION_HORIZON = 2;
    private static readonly CONFIDENCE_LEVEL = 1.645; // 95% confidence
    private static readonly MIN_RISK_REWARD = 1.5; // Minimum risk-reward ratio
    private static readonly VOLATILITY_FLOOR_FACTOR = 0.001; // 0.1% of price

    // New constants for enhanced features
    private static readonly RANDOM_WALK_WEIGHT = 0.3;
    private static readonly MEAN_REVERSION_LOOKBACK = 50;
    private static readonly VOLATILITY_DECAY = 0.94; // EWMA decay factor
    private static readonly MODEL_ENSEMBLE_WEIGHTS = [0.4, 0.3, 0.3]; // [linear, random_walk, mean_reversion]

    static analyze(data: MarketDataState): EnhancedBayesianResult {
        const windowSize = this.calculateAdaptiveWindow(data);

        if (data.prices.length < windowSize) {
            return this.insufficientDataFallback(data.currentPrice);
        }

        const prices = data.prices.slice(-windowSize);
        const timeIndexes = Array.from({ length: prices.length }, (_, i) => i);
        const currentPrice = data.currentPrice;

        // Enhanced ensemble modeling
        const models = this.calculateEnsembleModels(prices, timeIndexes, currentPrice);

        // Bayesian regression with numerical stability (original method)
        const { slope, intercept, variance, slopeStdError } = this.bayesianRegression(
            timeIndexes,
            prices
        );

        // Enhanced prediction with model ensemble
        const predictionIndex = timeIndexes.length + this.PREDICTION_HORIZON;
        const ensemblePrediction = this.combineModelPredictions(models, predictionIndex);
        const predictedPrice = ensemblePrediction.price;

        // Enhanced volatility estimation
        const adaptiveVolatility = this.calculateAdaptiveVolatility(prices);
        const stdDev = Math.max(Math.sqrt(variance), adaptiveVolatility);

        // Enhanced confidence interval with model uncertainty
        const meanX = timeIndexes.reduce((sum, t) => sum + t, 0) / timeIndexes.length;
        const sumSquaredDev = timeIndexes.reduce((sum, t) => sum + Math.pow(t - meanX, 2), 0);
        const denominator = Math.max(1e-8, sumSquaredDev);

        const baseVariance = variance * (1 + 1 / timeIndexes.length +
            Math.pow(predictionIndex - meanX, 2) / denominator);

        // Add model uncertainty to prediction variance
        const modelUncertainty = ensemblePrediction.uncertainty;
        const totalVariance = baseVariance + modelUncertainty;
        const predictionStdDev = Math.sqrt(totalVariance);

        const confidenceInterval: [number, number] = [
            predictedPrice - this.CONFIDENCE_LEVEL * predictionStdDev,
            predictedPrice + this.CONFIDENCE_LEVEL * predictionStdDev
        ];

        // Enhanced probability calculation
        const zScore = (currentPrice - predictedPrice) / predictionStdDev;
        const absZ = Math.abs(zScore);
        const pValue = 2 * (1 - this.standardNormalCDF(absZ));
        const probability = 1 - pValue;

        // Enhanced trend detection
        const trendDirection = this.determineTrend(
            slope,
            slopeStdError,
            currentPrice,
            confidenceInterval,
            models.randomWalk.bias // Enhanced with random walk bias
        );

        // Apply volatility floor to prevent microscopic distances
        const effectiveVolatility = Math.max(
            stdDev,
            currentPrice * this.VOLATILITY_FLOOR_FACTOR
        );

        // Enhanced risk management
        const { stopLoss, takeProfit } = this.calculateEnhancedRiskParameters(
            currentPrice,
            trendDirection,
            confidenceInterval,
            effectiveVolatility,
            probability,
            models
        );

        const regime = this.detectMarketRegime(stdDev, probability, zScore, models);

        // Generate alternative scenarios
        const alternativeScenarios = this.generateAlternativeScenarios(
            currentPrice,
            models,
            effectiveVolatility
        );

        return {
            // Original interface (backwards compatible)
            predictedPrice,
            confidenceInterval,
            stopLoss,
            takeProfit,
            trendDirection,
            volatility: stdDev,
            variance,
            probability,
            zScore,
            regime,

            // Enhanced features
            randomWalkBias: models.randomWalk.bias,
            meanReversion: models.meanReversion.strength,
            adaptiveVolatility,
            modelConfidence: ensemblePrediction.confidence,
            alternativeScenarios
        };
    }

    private static calculateEnsembleModels(prices: number[], timeIndexes: number[], currentPrice: number) {
        return {
            linear: this.calculateLinearModel(timeIndexes, prices),
            randomWalk: this.calculateRandomWalkModel(prices, currentPrice),
            meanReversion: this.calculateMeanReversionModel(prices, currentPrice)
        };
    }

    private static calculateLinearModel(timeIndexes: number[], prices: number[]) {
        const regression = this.bayesianRegression(timeIndexes, prices);
        return {
            slope: regression.slope,
            intercept: regression.intercept,
            variance: regression.variance,
            predict: (t: number) => regression.intercept + regression.slope * t
        };
    }

    private static calculateRandomWalkModel(prices: number[], currentPrice: number) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        // Calculate drift (bias) and volatility
        const drift = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - drift, 2), 0) / (returns.length - 1);

        // Detect momentum vs mean reversion bias
        const recentReturns = returns.slice(-10);
        const momentumBias = recentReturns.reduce((sum, r, i) => {
            if (i > 0) {
                return sum + (r * recentReturns[i - 1] > 0 ? 1 : -1);
            }
            return sum;
        }, 0) / (recentReturns.length - 1);

        return {
            drift,
            variance,
            bias: momentumBias * Math.abs(drift),
            predict: (steps: number) => {
                // Geometric Brownian Motion prediction
                const dt = 1; // time step
                const expectedReturn = drift * steps * dt;
                const randomComponent = Math.sqrt(variance * steps * dt);
                return currentPrice * Math.exp(expectedReturn + 0.5 * randomComponent);
            }
        };
    }

    private static calculateMeanReversionModel(prices: number[], currentPrice: number) {
        const lookback = Math.min(this.MEAN_REVERSION_LOOKBACK, prices.length);
        const recentPrices = prices.slice(-lookback);

        // Calculate long-term mean and current deviation
        const longTermMean = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
        const deviation = currentPrice - longTermMean;

        // Estimate mean reversion strength using half-life
        const halfLife = this.estimateHalfLife(recentPrices);
        const reversionRate = Math.log(2) / Math.max(halfLife, 1);

        return {
            mean: longTermMean,
            deviation,
            strength: reversionRate,
            predict: (steps: number) => {
                // Mean reversion prediction: P(t) = mean + (P(0) - mean) * exp(-k*t)
                const decayFactor = Math.exp(-reversionRate * steps);
                return longTermMean + deviation * decayFactor;
            }
        };
    }

    private static estimateHalfLife(prices: number[]): number {
        if (prices.length < 3) return 10; // Default half-life

        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        // Simple autocorrelation at lag 1
        const mean = changes.reduce((sum, c) => sum + c, 0) / changes.length;
        let autoCorr = 0;
        let variance = 0;

        for (let i = 1; i < changes.length; i++) {
            autoCorr += (changes[i] - mean) * (changes[i - 1] - mean);
            variance += Math.pow(changes[i] - mean, 2);
        }

        autoCorr /= (changes.length - 1);
        variance /= (changes.length - 1);

        const correlation = variance > 0 ? autoCorr / variance : 0;
        return correlation > 0 ? -1 / Math.log(Math.abs(correlation)) : 10;
    }

    private static combineModelPredictions(models: any, predictionIndex: number) {
        const predictions = [
            models.linear.predict(predictionIndex),
            models.randomWalk.predict(this.PREDICTION_HORIZON),
            models.meanReversion.predict(this.PREDICTION_HORIZON)
        ];

        // Weighted ensemble prediction
        const weightedPrice = predictions.reduce((sum, pred, i) =>
            sum + pred * this.MODEL_ENSEMBLE_WEIGHTS[i], 0);

        // Calculate prediction uncertainty (variance across models)
        const meanPrediction = predictions.reduce((sum, pred) => sum + pred, 0) / predictions.length;
        const modelVariance = predictions.reduce((sum, pred) =>
            sum + Math.pow(pred - meanPrediction, 2), 0) / predictions.length;

        // Model confidence based on agreement
        const maxDeviation = Math.max(...predictions.map(p => Math.abs(p - meanPrediction)));
        const confidence = 1 / (1 + maxDeviation / meanPrediction);

        return {
            price: weightedPrice,
            uncertainty: modelVariance,
            confidence: Math.max(0.1, Math.min(0.9, confidence))
        };
    }

    private static calculateAdaptiveVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;

        // EWMA volatility calculation
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }

        let ewmaVariance = Math.pow(returns[0], 2);
        for (let i = 1; i < returns.length; i++) {
            ewmaVariance = this.VOLATILITY_DECAY * ewmaVariance +
                (1 - this.VOLATILITY_DECAY) * Math.pow(returns[i], 2);
        }

        return Math.sqrt(ewmaVariance) * prices[prices.length - 1];
    }

    private static generateAlternativeScenarios(currentPrice: number, models: any, volatility: number) {
        const scenarios = ['bearish', 'neutral', 'bullish'];
        const multipliers = [-1.5, 0, 1.5];

        return scenarios.reduce((acc, scenario, i) => {
            const adjustment = multipliers[i] * volatility;
            const scenarioPrice = currentPrice + adjustment;

            // Calculate probability based on model ensemble
            const linearProb = this.calculateScenarioProbability(models.linear, scenarioPrice, currentPrice);
            const randomWalkProb = this.calculateScenarioProbability(models.randomWalk, scenarioPrice, currentPrice);
            const meanReversionProb = this.calculateScenarioProbability(models.meanReversion, scenarioPrice, currentPrice);

            const weightedProb = linearProb * this.MODEL_ENSEMBLE_WEIGHTS[0] +
                randomWalkProb * this.MODEL_ENSEMBLE_WEIGHTS[1] +
                meanReversionProb * this.MODEL_ENSEMBLE_WEIGHTS[2];

            acc[scenario] = {
                price: scenarioPrice,
                probability: Math.max(0.1, Math.min(0.9, weightedProb))
            };

            return acc;
        }, {} as any);
    }

    private static calculateScenarioProbability(model: any, scenarioPrice: number, currentPrice: number): number {
        // Simplified probability calculation - can be enhanced with proper statistical methods
        const expectedPrice = model.predict ? model.predict(this.PREDICTION_HORIZON) : currentPrice;
        const distance = Math.abs(scenarioPrice - expectedPrice);
        const variance = model.variance || Math.pow(currentPrice * 0.01, 2);

        // Gaussian probability approximation
        return Math.exp(-Math.pow(distance, 2) / (2 * variance));
    }

    // Enhanced versions of existing methods
    private static detectMarketRegime(
        volatility: number,
        probability: number,
        zScore: number,
        models: any
    ): MarketRegime {
        const trendStrength = Math.abs(models.linear.slope || 0);
        const meanReversionStrength = models.meanReversion.strength || 0;
        const randomWalkBias = Math.abs(models.randomWalk.bias || 0);

        // Enhanced regime detection with multiple factors
        if (volatility > 0.04 && probability > 0.7 && trendStrength > 0.5)
            return 'trending';
        if (volatility < 0.01 && Math.abs(zScore) < 0.4 && meanReversionStrength > 0.1)
            return 'consolidating';
        if (volatility > 0.06 || randomWalkBias > 0.3)
            return 'volatile';
        return 'transitioning';
    }

    private static determineTrend(
        slope: number,
        slopeStdError: number,
        currentPrice: number,
        confidenceInterval: [number, number],
        randomWalkBias: number = 0
    ): 'bullish' | 'bearish' | 'neutral' {
        // Statistical significance test (original)
        const tValue = slopeStdError > 0 ? Math.abs(slope) / slopeStdError : 0;
        if (tValue < 1.96) return 'neutral';

        // Enhanced with random walk bias
        const combinedSignal = slope + randomWalkBias * this.RANDOM_WALK_WEIGHT;

        // Bayesian confirmation with enhanced signal
        if (combinedSignal > 0) {
            return currentPrice > confidenceInterval[0] ? 'bullish' : 'neutral';
        } else {
            return currentPrice < confidenceInterval[1] ? 'bearish' : 'neutral';
        }
    }

    private static calculateEnhancedRiskParameters(
        currentPrice: number,
        trendDirection: 'bullish' | 'bearish' | 'neutral',
        confidenceInterval: [number, number],
        volatility: number,
        probability: number,
        models: any
    ): { stopLoss: number; takeProfit: number } {
        // Get original risk parameters
        const originalRisk = this.calculateRiskParameters(
            currentPrice,
            trendDirection,
            confidenceInterval,
            volatility,
            probability
        );

        // Enhanced with model-specific adjustments
        const meanReversionAdjustment = models.meanReversion.strength * 0.5;
        const randomWalkAdjustment = Math.abs(models.randomWalk.bias) * 0.3;

        let { stopLoss, takeProfit } = originalRisk;

        // Adjust based on mean reversion (tighter stops, closer targets)
        if (meanReversionAdjustment > 0.1) {
            const adjustment = volatility * meanReversionAdjustment;
            if (trendDirection === 'bullish') {
                stopLoss = Math.max(stopLoss, currentPrice - adjustment);
                takeProfit = Math.min(takeProfit, currentPrice + adjustment);
            } else if (trendDirection === 'bearish') {
                stopLoss = Math.min(stopLoss, currentPrice + adjustment);
                takeProfit = Math.max(takeProfit, currentPrice - adjustment);
            }
        }

        // Adjust based on random walk bias (wider stops for strong bias)
        if (randomWalkAdjustment > 0.2) {
            const adjustment = volatility * randomWalkAdjustment;
            if (trendDirection === 'bullish') {
                stopLoss = Math.min(stopLoss, currentPrice - adjustment);
                takeProfit = Math.max(takeProfit, currentPrice + adjustment);
            } else if (trendDirection === 'bearish') {
                stopLoss = Math.max(stopLoss, currentPrice + adjustment);
                takeProfit = Math.min(takeProfit, currentPrice - adjustment);
            }
        }

        return { stopLoss, takeProfit };
    }

    // Original methods remain unchanged for backwards compatibility
    private static calculateAdaptiveWindow(data: MarketDataState): number {
        if (data.prices.length < this.MIN_DATA_POINTS)
            return this.MIN_DATA_POINTS;

        const recentPrices = data.prices.slice(-this.MIN_DATA_POINTS);
        let volatility = 0;

        for (let i = 1; i < recentPrices.length; i++) {
            volatility += Math.abs(recentPrices[i] - recentPrices[i - 1]);
        }

        volatility /= recentPrices.length;
        const normalizedVol = Math.min(0.5, volatility / recentPrices[0]);

        return Math.min(
            this.MAX_WINDOW_SIZE,
            Math.max(
                this.MIN_DATA_POINTS,
                Math.floor(
                    this.MIN_DATA_POINTS +
                    (this.MAX_WINDOW_SIZE - this.MIN_DATA_POINTS) *
                    (1 - Math.min(normalizedVol * 100, 0.8))
                )
            )
        );
    }

    private static bayesianRegression(
        x: number[],
        y: number[]
    ): { slope: number; intercept: number; variance: number; slopeStdError: number } {
        const n = x.length;
        const xSum = x.reduce((sum, val) => sum + val, 0);
        const ySum = y.reduce((sum, val) => sum + val, 0);
        const xySum = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const xSquaredSum = x.reduce((sum, val) => sum + val * val, 0);

        const denominator = n * xSquaredSum - xSum * xSum;
        if (Math.abs(denominator) < 1e-8) {
            return {
                slope: 0,
                intercept: ySum / n,
                variance: 0,
                slopeStdError: 0
            };
        }

        const slope = (n * xySum - xSum * ySum) / denominator;
        const intercept = (ySum - slope * xSum) / n;

        const residuals = y.map((val, i) => val - (intercept + slope * x[i]));
        const residualSumSquares = residuals.reduce((sum, res) => sum + res * res, 0);
        const variance = residualSumSquares / Math.max(1, n - 2);

        const xMean = xSum / n;
        const xVariance = Math.max(1e-8, xSquaredSum / n - xMean * xMean);
        const slopeStdError = Math.sqrt(Math.max(0, variance) / (n * xVariance));

        return { slope, intercept, variance, slopeStdError };
    }

    private static calculateRiskParameters(
        currentPrice: number,
        trendDirection: 'bullish' | 'bearish' | 'neutral',
        confidenceInterval: [number, number],
        volatility: number,
        probability: number
    ): { stopLoss: number; takeProfit: number } {
        const riskMultiplier = Math.min(3, 1 + (1 - probability) * 2);
        const [lowerBound, upperBound] = confidenceInterval;

        const minRange = volatility * 3;
        const priceRange = Math.max(upperBound - lowerBound, minRange);
        const minProfitDistance = volatility * this.MIN_RISK_REWARD * riskMultiplier;

        switch (trendDirection) {
            case 'bullish': {
                const stopLoss = Math.min(
                    lowerBound - volatility * riskMultiplier,
                    currentPrice - Math.max(volatility * 2, priceRange * 0.3)
                );

                const takeProfit = currentPrice + Math.max(
                    minProfitDistance,
                    volatility * 3,
                    (upperBound - currentPrice) * 1.2
                );

                return this.validateRiskLevels(
                    stopLoss,
                    takeProfit,
                    currentPrice,
                    volatility,
                    'bullish'
                );
            }

            case 'bearish': {
                const stopLoss = Math.max(
                    upperBound + volatility * riskMultiplier,
                    currentPrice + Math.max(volatility * 2, priceRange * 0.3)
                );

                const takeProfit = currentPrice - Math.max(
                    minProfitDistance,
                    volatility * 3,
                    (currentPrice - lowerBound) * 1.2
                );

                return this.validateRiskLevels(
                    stopLoss,
                    takeProfit,
                    currentPrice,
                    volatility,
                    'bearish'
                );
            }

            default:
                return {
                    stopLoss: currentPrice - volatility * 2.5,
                    takeProfit: currentPrice + volatility * 2.5
                };
        }
    }

    private static validateRiskLevels(
        stopLoss: number,
        takeProfit: number,
        currentPrice: number,
        volatility: number,
        direction: 'bullish' | 'bearish'
    ) {
        const validBull = direction === 'bullish' &&
            stopLoss < currentPrice &&
            takeProfit > currentPrice;

        const validBear = direction === 'bearish' &&
            stopLoss > currentPrice &&
            takeProfit < currentPrice;

        if (validBull || validBear) {
            return { stopLoss, takeProfit };
        }

        return direction === 'bullish'
            ? {
                stopLoss: currentPrice - volatility * 2,
                takeProfit: currentPrice + volatility * 3
            }
            : {
                stopLoss: currentPrice + volatility * 2,
                takeProfit: currentPrice - volatility * 3
            };
    }

    private static standardNormalCDF(x: number): number {
        const absX = Math.abs(x);
        const t = 1 / (1 + 0.5 * absX);

        const exponent = -absX * absX - 1.26551223 + t * (
            1.00002368 + t * (
                0.37409196 + t * (
                    0.09678418 + t * (
                        -0.18628806 + t * (
                            0.27886807 + t * (
                                -1.13520398 + t * (
                                    1.48851587 + t * (
                                        -0.82215223 + t * 0.17087277
                                    )
                                )
                            )
                        )
                    )
                )
            )
        );

        const tau = t * Math.exp(exponent);
        return x >= 0 ? 1 - tau : tau;
    }

    private static insufficientDataFallback(currentPrice: number): EnhancedBayesianResult {
        const volatility = currentPrice * 0.005;
        return {
            predictedPrice: currentPrice,
            confidenceInterval: [currentPrice - volatility, currentPrice + volatility],
            stopLoss: currentPrice - volatility * 2,
            takeProfit: currentPrice + volatility * 2,
            trendDirection: 'neutral',
            variance: Math.pow(volatility, 2),
            volatility,
            probability: 0.5,
            zScore: 0,
            regime: 'transitioning',

            // Enhanced fallback values
            randomWalkBias: 0,
            meanReversion: 0,
            adaptiveVolatility: volatility,
            modelConfidence: 0.5,
            alternativeScenarios: {
                bearish: { price: currentPrice - volatility, probability: 0.33 },
                neutral: { price: currentPrice, probability: 0.34 },
                bullish: { price: currentPrice + volatility, probability: 0.33 }
            }
        };
    }
}