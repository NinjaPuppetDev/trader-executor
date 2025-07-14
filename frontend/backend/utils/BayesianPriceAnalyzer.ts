// src/utils/BayesianPriceAnalyzer.ts
import { MarketDataState } from '../types';

export interface BayesianRegressionResult {
    predictedPrice: number;
    confidenceInterval: [number, number];
    stopLoss: number;
    takeProfit: number;
    trendDirection: 'bullish' | 'bearish' | 'neutral';
    volatility: number;
    variance: number;
}

export class BayesianPriceAnalyzer {
    private static readonly WINDOW_SIZE = 50;
    private static readonly PREDICTION_HORIZON = 3;

    static analyze(data: MarketDataState): BayesianRegressionResult {
        if (data.prices.length < BayesianPriceAnalyzer.WINDOW_SIZE) {
            return this.insufficientDataFallback(data.currentPrice);
        }

        const prices = data.prices.slice(-BayesianPriceAnalyzer.WINDOW_SIZE);
        const timeIndexes = Array.from({ length: prices.length }, (_, i) => i);
        const currentPrice = data.currentPrice;

        // Bayesian linear regression
        const { slope, intercept, variance } = this.bayesianLinearRegression(timeIndexes, prices);

        // Predict future price
        const predictionIndex = timeIndexes.length + BayesianPriceAnalyzer.PREDICTION_HORIZON;
        const predictedPrice = intercept + slope * predictionIndex;

        // Calculate confidence interval (95%)
        const stdDev = Math.sqrt(variance);
        const confidenceInterval: [number, number] = [
            predictedPrice - 1.96 * stdDev,
            predictedPrice + 1.96 * stdDev
        ];

        // Determine trend direction
        const trendDirection = this.determineTrendDirection(slope, currentPrice, confidenceInterval);

        // Calculate stop loss and take profit
        const { stopLoss, takeProfit } = this.calculateRiskLevels(
            currentPrice,
            trendDirection,
            confidenceInterval,
            stdDev
        );

        return {
            predictedPrice,
            confidenceInterval,
            stopLoss,
            takeProfit,
            trendDirection,
            volatility: stdDev,
            variance
        };
    }

    private static insufficientDataFallback(currentPrice: number): BayesianRegressionResult {
        return {
            predictedPrice: currentPrice,
            confidenceInterval: [currentPrice * 0.99, currentPrice * 1.01],
            stopLoss: currentPrice * 0.98,
            takeProfit: currentPrice * 1.02,
            trendDirection: 'neutral',
            volatility: 0,
            variance: 0
        };
    }

    private static bayesianLinearRegression(
        x: number[],
        y: number[]
    ): { slope: number; intercept: number; variance: number } {
        const n = x.length;
        const xSum = x.reduce((sum, val) => sum + val, 0);
        const ySum = y.reduce((sum, val) => sum + val, 0);
        const xySum = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const xSquaredSum = x.reduce((sum, val) => sum + val * val, 0);

        const slope = (n * xySum - xSum * ySum) / (n * xSquaredSum - xSum * xSum);
        const intercept = (ySum - slope * xSum) / n;

        const residuals = y.map((val, i) => val - (intercept + slope * x[i]));
        const variance = residuals.reduce((sum, res) => sum + res * res, 0) / (n - 2);

        return { slope, intercept, variance };
    }

    private static determineTrendDirection(
        slope: number,
        currentPrice: number,
        confidenceInterval: [number, number]
    ): 'bullish' | 'bearish' | 'neutral' {
        const trendStrength = Math.abs(slope);
        if (trendStrength < 0.005) return 'neutral';

        if (slope > 0) {
            return currentPrice > confidenceInterval[0] ? 'bullish' : 'neutral';
        } else {
            return currentPrice < confidenceInterval[1] ? 'bearish' : 'neutral';
        }
    }

    private static calculateRiskLevels(
        currentPrice: number,
        trendDirection: 'bullish' | 'bearish' | 'neutral',
        confidenceInterval: [number, number],
        volatility: number
    ): { stopLoss: number; takeProfit: number } {
        const volatilityFactor = Math.min(Math.max(volatility * 100, 1.5), 4);

        if (trendDirection === 'bullish') {
            return {
                stopLoss: currentPrice * (1 - 0.01 * volatilityFactor),
                takeProfit: currentPrice * (1 + 0.02 * volatilityFactor)
            };
        }

        if (trendDirection === 'bearish') {
            return {
                stopLoss: currentPrice * (1 + 0.01 * volatilityFactor),
                takeProfit: currentPrice * (1 - 0.02 * volatilityFactor)
            };
        }

        return {
            stopLoss: currentPrice * 0.99,
            takeProfit: currentPrice * 1.01
        };
    }
}