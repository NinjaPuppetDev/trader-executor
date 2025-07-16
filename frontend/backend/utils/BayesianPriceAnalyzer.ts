import { MarketDataState, MarketRegime, BayesianRegressionResult } from '../types';

export class BayesianPriceAnalyzer {
    private static readonly MIN_DATA_POINTS = 24;
    private static readonly MAX_WINDOW_SIZE = 200;
    private static readonly PREDICTION_HORIZON = 2;
    private static readonly CONFIDENCE_LEVEL = 1.645; // 95% confidence
    private static readonly MIN_RISK_REWARD = 1.5; // Minimum risk-reward ratio

    static analyze(data: MarketDataState): BayesianRegressionResult {
        const windowSize = this.calculateAdaptiveWindow(data);

        if (data.prices.length < windowSize) {
            return this.insufficientDataFallback(data.currentPrice);
        }

        const prices = data.prices.slice(-windowSize);
        const timeIndexes = Array.from({ length: prices.length }, (_, i) => i);
        const currentPrice = data.currentPrice;

        // Bayesian inference with uncertainty quantification
        const { slope, intercept, variance, slopeStdError } = this.bayesianRegression(
            timeIndexes,
            prices
        );

        // Predict future price with Bayesian uncertainty
        const predictionIndex = timeIndexes.length + this.PREDICTION_HORIZON;
        const predictedPrice = intercept + slope * predictionIndex;
        const stdDev = Math.sqrt(variance);

        // Confidence interval incorporating model uncertainty
        const predictionVariance = variance * (1 + 1 / timeIndexes.length +
            Math.pow(predictionIndex - timeIndexes.length / 2, 2) /
            timeIndexes.reduce((sum, t) => sum + Math.pow(t - timeIndexes.length / 2, 2), 0));

        const predictionStdDev = Math.sqrt(predictionVariance);
        const confidenceInterval: [number, number] = [
            predictedPrice - this.CONFIDENCE_LEVEL * predictionStdDev,
            predictedPrice + this.CONFIDENCE_LEVEL * predictionStdDev
        ];

        // Calculate z-score and probability (p-value)
        const zScore = (currentPrice - predictedPrice) / predictionStdDev;
        const absZ = Math.abs(zScore);
        const pValue = 2 * (1 - this.standardNormalCDF(absZ)); // Two-tailed p-value
        const probability = 1 - pValue; // Convert to confidence level

        // Statistically significant trend detection
        const trendDirection = this.determineTrend(
            slope,
            slopeStdError,
            currentPrice,
            confidenceInterval
        );

        // Dynamic probability-based risk management
        const { stopLoss, takeProfit } = this.calculateRiskParameters(
            currentPrice,
            trendDirection,
            confidenceInterval,
            stdDev,
            probability
        );

        const regime = this.detectMarketRegime(stdDev, probability, zScore);

        return {
            predictedPrice,
            confidenceInterval,
            stopLoss,
            takeProfit,
            trendDirection,
            volatility: stdDev,
            variance,
            probability,
            zScore,
            regime
        };
    }

    private static detectMarketRegime(
        volatility: number,
        probability: number,
        zScore: number
    ): MarketRegime {
        if (volatility > 0.04 && probability > 0.7)
            return 'trending';
        if (volatility < 0.01 && Math.abs(zScore) < 0.4)
            return 'consolidating';
        if (volatility > 0.06)
            return 'volatile';
        return 'transitioning';
    }

    private static standardNormalCDF(x: number): number {
        // Abramowitz and Stegun approximation for standard normal CDF
        const t = 1 / (1 + 0.2316419 * x);
        const d = 0.3989422804 * Math.exp(-x * x / 2);

        // Fixed polynomial calculation (removed extra parenthesis)
        const polynomial = 0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)));
        let cdf = d * t * polynomial;

        return x > 0 ? 1 - cdf : cdf;
    }

    private static calculateAdaptiveWindow(data: MarketDataState): number {
        if (data.prices.length < this.MIN_DATA_POINTS)
            return this.MIN_DATA_POINTS;

        // Measure recent volatility for window sizing
        const recentPrices = data.prices.slice(-this.MIN_DATA_POINTS);
        let volatility = 0;

        for (let i = 1; i < recentPrices.length; i++) {
            volatility += Math.abs(recentPrices[i] - recentPrices[i - 1]);
        }

        volatility /= recentPrices.length;
        const normalizedVol = volatility / recentPrices[recentPrices.length - 1];

        // High volatility = smaller window, low volatility = larger window
        return Math.floor(
            this.MIN_DATA_POINTS +
            (this.MAX_WINDOW_SIZE - this.MIN_DATA_POINTS) *
            (1 - Math.min(normalizedVol * 100, 0.8))
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

        // Bayesian linear regression with OLS
        const slope = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);
        const intercept = (ySum - slope * xSum) / n;

        // Calculate residuals and variance
        const residuals = y.map((val, i) => val - (intercept + slope * x[i]));
        const variance = residuals.reduce((sum, res) => sum + res * res, 0) / (n - 2);

        // Calculate standard error of slope
        const xMean = xSum / n;
        const xVariance = xSquaredSum / n - xMean * xMean;
        const slopeStdError = Math.sqrt(variance / (n * xVariance));

        return { slope, intercept, variance, slopeStdError };
    }

    private static determineTrend(
        slope: number,
        slopeStdError: number,
        currentPrice: number,
        confidenceInterval: [number, number]
    ): 'bullish' | 'bearish' | 'neutral' {
        // Statistical significance test (t-test)
        const tValue = Math.abs(slope) / slopeStdError;
        if (tValue < 1.96) return 'neutral'; // Not statistically significant

        // Bayesian confirmation with price position
        if (slope > 0) {
            return currentPrice > confidenceInterval[0] ? 'bullish' : 'neutral';
        } else {
            return currentPrice < confidenceInterval[1] ? 'bearish' : 'neutral';
        }
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
        const priceRange = upperBound - lowerBound;

        // Ensure minimum risk-reward ratio
        const minProfitDistance = volatility * this.MIN_RISK_REWARD * riskMultiplier;

        if (trendDirection === 'bullish') {
            const stopLoss = Math.max(
                lowerBound - volatility * riskMultiplier,
                currentPrice - (priceRange * 0.5)
            );

            const takeProfit = Math.min(
                currentPrice + (priceRange * riskMultiplier),
                currentPrice + Math.max(minProfitDistance, upperBound - currentPrice)
            );

            // Final sanity check
            if (stopLoss > currentPrice || takeProfit < currentPrice) {
                return {
                    stopLoss: currentPrice - volatility * 2,
                    takeProfit: currentPrice + volatility * 3
                };
            }

            return { stopLoss, takeProfit };
        }

        if (trendDirection === 'bearish') {
            const stopLoss = Math.min(
                upperBound + volatility * riskMultiplier,
                currentPrice + (priceRange * 0.5)
            );

            const takeProfit = Math.max(
                currentPrice - (priceRange * riskMultiplier),
                currentPrice - Math.max(minProfitDistance, currentPrice - lowerBound)
            );

            // Final sanity check
            if (stopLoss < currentPrice || takeProfit > currentPrice) {
                return {
                    stopLoss: currentPrice + volatility * 2,
                    takeProfit: currentPrice - volatility * 3
                };
            }

            return { stopLoss, takeProfit };
        }

        // Neutral strategy - symmetrical levels
        return {
            stopLoss: currentPrice - volatility * 2.5,
            takeProfit: currentPrice + volatility * 2.5
        };
    }

    private static insufficientDataFallback(currentPrice: number): BayesianRegressionResult {
        return {
            predictedPrice: currentPrice,
            confidenceInterval: [currentPrice * 0.98, currentPrice * 1.02],
            stopLoss: currentPrice * 0.97,
            takeProfit: currentPrice * 1.03,
            trendDirection: 'neutral',
            variance: 0,
            volatility: 0,
            probability: 0.5,
            zScore: 0,
            regime: 'transitioning'
        };
    }
}