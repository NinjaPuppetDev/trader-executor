import { MarketDataCollector } from '../utils/marketDataCollector';
import { BayesianPriceAnalyzer } from '../utils/BayesianPriceAnalyzer';
import { ethers } from 'ethers';
import { MarketDataState, BayesianRegressionResult, MarketRegime } from '../types';
import { TechnicalAnalyzer } from '../utils/technicalAnalyzer';

const ZERO_ADDRESS = ethers.constants.AddressZero;

export interface PromptConfig {
    system: string;
    instructions: string;
    token_mapping: Record<string, string>;
    market_context: Record<string, any>;
}

interface TradingDecision {
    decision: 'buy' | 'sell';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
    stopLoss: number;
    takeProfit: number;
}

export class PromptService {
    private marketDataCollector: MarketDataCollector;
    private stableToken: string;
    private volatileToken: string;
    private symbol: string;

    constructor(
        marketDataCollector: MarketDataCollector,
        stableToken: string,
        volatileToken: string,
        symbol: string = 'ethusdt'
    ) {
        this.marketDataCollector = marketDataCollector;
        this.stableToken = stableToken;
        this.volatileToken = volatileToken;
        this.symbol = symbol;
    }

    private getMarketStateWithFallback(): MarketDataState {
        const state = this.marketDataCollector.getCurrentMarketState();
        return state || {
            prices: [],
            volumes: [],
            currentPrice: 0,
            averageVolume: 0,
            timestamp: Date.now(),
            symbol: this.symbol,
            additional: { high: 0, low: 0 },
            regime: 'consolidating' as MarketRegime
        };
    }

    async generatePromptConfig(currentPrice?: number): Promise<{
        config: PromptConfig;
        bayesianAnalysis: BayesianRegressionResult
    }> {
        const marketState = this.getMarketStateWithFallback();
        const bayesianAnalysis = BayesianPriceAnalyzer.analyze(marketState);

        // Get technical analysis decision
        const technicalDecision = TechnicalAnalyzer.analyze(marketState);

        // Determine trade direction based on technical analysis
        let tradeDirection: 'buy' | 'sell';
        if (technicalDecision.action === 'buy' || technicalDecision.action === 'sell') {
            tradeDirection = technicalDecision.action;
        } else {
            // Fallback to deviation-based decision if hold
            const stdDev = Math.sqrt(bayesianAnalysis.variance);
            const priceDeviation = (marketState.currentPrice - bayesianAnalysis.predictedPrice) / stdDev;
            tradeDirection = priceDeviation < 0 ? 'buy' : 'sell';
        }

        // Calculate dynamic parameters
        const stdDev = Math.sqrt(bayesianAnalysis.variance);
        const priceDeviation = (marketState.currentPrice - bayesianAnalysis.predictedPrice) / stdDev;
        const absDeviation = Math.abs(priceDeviation);
        const volatility = bayesianAnalysis.volatility;
        const positionSize = this.calculatePositionSize(absDeviation);
        const slippage = this.calculateSlippage(volatility);
        const confidence = this.calculateConfidence(absDeviation);

        // Format Bayesian analysis
        const analysisTable = `
┌──────────────────────┬──────────────────────┐
│ Current Price        │ ${marketState.currentPrice.toFixed(2)} 
│ Predicted Price      │ ${bayesianAnalysis.predictedPrice.toFixed(2)} 
│ Deviation            │ ${priceDeviation.toFixed(2)}σ
│ Confidence Interval  │ [${bayesianAnalysis.confidenceInterval[0].toFixed(2)}, ${bayesianAnalysis.confidenceInterval[1].toFixed(2)}]
│ Volatility           │ ${volatility.toFixed(4)}
│ Trend Direction      │ ${bayesianAnalysis.trendDirection.toUpperCase()}
│ Technical Signal     │ ${technicalDecision.state}
└──────────────────────┴──────────────────────┘`.trim();

        return {
            config: {
                system: `ROLE: Quantitative Trading Algorithm
TASK: Execute ETH/USD trades based on technical analysis

## MANDATORY RULES ##
1. USE TECHNICAL ANALYSIS SIGNAL FOR TRADE DECISION
2. OUTPUT MUST BE VALID JSON WITH NO ADDITIONAL TEXT

## MARKET ANALYSIS ##
${analysisTable}

## TRADE PARAMETERS ##
Trade Direction: ${tradeDirection.toUpperCase()}
Position Size: ${positionSize} ETH
Slippage: ${slippage}%
Stop Loss: ${bayesianAnalysis.stopLoss.toFixed(2)}
Take Profit: ${bayesianAnalysis.takeProfit.toFixed(2)}
Technical State: ${technicalDecision.state}

## TOKEN ADDRESSES ##
Stablecoin: ${this.stableToken}
Volatile: ${this.volatileToken}

## REQUIRED OUTPUT FORMAT ##
{
  "decision": "${tradeDirection}",
  "tokenIn": "${tradeDirection === 'buy' ? this.stableToken : this.volatileToken}",
  "tokenOut": "${tradeDirection === 'buy' ? this.volatileToken : this.stableToken}",
  "amount": "${positionSize}",
  "slippage": ${slippage},
  "stopLoss": ${bayesianAnalysis.stopLoss.toFixed(2)},
  "takeProfit": ${bayesianAnalysis.takeProfit.toFixed(2)},
  "reasoning": "${technicalDecision.reasoning.replace(/"/g, '\\"')}",
  "confidence": "${confidence}"
}

## CRITICAL INSTRUCTIONS ##
1. USE EXACT VALUES FROM TECHNICAL ANALYSIS
2. NEVER OUTPUT 'HOLD' AS A DECISION`.trim(),

                instructions: `MARKET: ${this.symbol.toUpperCase()}
PRICE: ${marketState.currentPrice}
TECHNICAL SIGNAL: ${technicalDecision.state}

OUTPUT ONLY THE REQUIRED JSON OBJECT`.trim(),

                token_mapping: {
                    "STABLECOIN": this.stableToken,
                    "VOLATILE": this.volatileToken
                },

                market_context: {
                    current_price: marketState.currentPrice,
                    predicted_price: bayesianAnalysis.predictedPrice,
                    technical_signal: technicalDecision.state,
                    trade_direction: tradeDirection,
                    position_size: positionSize,
                    slippage: slippage,
                    stop_loss: bayesianAnalysis.stopLoss,
                    take_profit: bayesianAnalysis.takeProfit,
                    confidence: confidence,
                    timestamp: new Date().toISOString(),
                    regime: marketState.regime
                }
            },
            bayesianAnalysis
        };
    }

    // ======= HELPER METHODS =======

    private calculatePositionSize(absDeviation: number): string {
        if (absDeviation > 2) return "0.04";
        if (absDeviation > 1) return "0.03";
        return "0.02";  // Minimum trade size
    }

    private calculateSlippage(volatility: number): number {
        return volatility > 0.03 ? 2.0 : 1.0;
    }

    private calculateConfidence(absDeviation: number): 'high' | 'medium' | 'low' {
        return absDeviation > 2 ? 'high' :
            absDeviation > 1 ? 'medium' : 'low';
    }

    createForcedTrade(
        bayesianAnalysis: BayesianRegressionResult,
        currentPrice: number
    ): TradingDecision {
        const stdDev = Math.sqrt(bayesianAnalysis.variance);
        const priceDeviation = (currentPrice - bayesianAnalysis.predictedPrice) / stdDev;
        const absDeviation = Math.abs(priceDeviation);
        const tradeDirection = priceDeviation < 0 ? 'buy' : 'sell';
        const positionSize = this.calculatePositionSize(absDeviation);
        const slippage = this.calculateSlippage(bayesianAnalysis.volatility);
        const confidence = this.calculateConfidence(absDeviation);

        return {
            decision: tradeDirection,
            tokenIn: tradeDirection === 'buy' ? this.stableToken : this.volatileToken,
            tokenOut: tradeDirection === 'buy' ? this.volatileToken : this.stableToken,
            amount: positionSize,
            slippage,
            stopLoss: bayesianAnalysis.stopLoss,
            takeProfit: bayesianAnalysis.takeProfit,
            reasoning: `System-generated trade at ${currentPrice} (${priceDeviation.toFixed(2)}σ)`,
            confidence
        };
    }
}