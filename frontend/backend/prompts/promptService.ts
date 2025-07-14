import { MarketDataCollector } from '../utils/marketDataCollector';
import { BayesianPriceAnalyzer } from '../utils/BayesianPriceAnalyzer'; // New Bayesian analyzer
import { ethers } from 'ethers';
import { MarketDataState } from '../types';
import { BayesianRegressionResult } from '../types';

const ZERO_ADDRESS = ethers.constants.AddressZero;

export interface PromptConfig {
    system: string;
    instructions: string;
    token_mapping: Record<string, string>;
    market_context: Record<string, any>;
}

interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold';
    tokenIn: string;
    tokenOut: string;
    amount: string;
    slippage: number;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
    stopLoss?: number;
    takeProfit?: number;
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

        if (!state) {
            return {
                prices: [],
                volumes: [],
                currentPrice: 0,
                averageVolume: 0,
                timestamp: Date.now(),
                symbol: this.symbol,
                additional: {
                    high: 0,
                    low: 0
                }
            };
        }

        return state;
    }

    async generatePromptConfig(currentPrice?: number): Promise<{
        config: PromptConfig;
        bayesianAnalysis: BayesianRegressionResult
    }> {
        const marketState = this.getMarketStateWithFallback();
        const bayesianAnalysis = BayesianPriceAnalyzer.analyze(marketState);
        const stdDev = Math.sqrt(bayesianAnalysis.variance);
        const priceDeviation = (marketState.currentPrice - bayesianAnalysis.predictedPrice) / stdDev;
        const absDeviation = Math.abs(priceDeviation);
        const volatility = bayesianAnalysis.volatility;

        if (currentPrice !== undefined) {
            marketState.currentPrice = currentPrice;
        }


        // Pre-calculate critical values
        const positionSize = this.calculatePositionSize(absDeviation);
        const slippage = this.calculateSlippage(volatility);
        const confidence = this.calculateConfidence(absDeviation);
        const tradeSignal = this.getTradeSignal(
            priceDeviation,
            bayesianAnalysis.trendDirection
        );

        // Format Bayesian analysis for display
        const analysisTable = `
┌──────────────────────┬──────────────────────┐
│ Current Price        │ ${marketState.currentPrice.toFixed(2)} 
│ Predicted Price      │ ${bayesianAnalysis.predictedPrice.toFixed(2)} 
│ Deviation            │ ${priceDeviation.toFixed(2)}σ
│ Confidence Interval  │ [${bayesianAnalysis.confidenceInterval[0].toFixed(2)}, ${bayesianAnalysis.confidenceInterval[1].toFixed(2)}]
│ Volatility           │ ${volatility.toFixed(4)}
│ Trend Direction      │ ${bayesianAnalysis.trendDirection.toUpperCase()}
└──────────────────────┴──────────────────────┘`.trim();

        return {
            config: {
                system: `ROLE: Senior Quantitative Analyst
TASK: Execute Bayesian price action strategy for ${this.symbol.toUpperCase()}

## STATISTICAL ANALYSIS ##
${analysisTable}

## TRADING RULES (STRICT ENFORCEMENT) ##
1. Trade signals:
   - BUY ONLY when: deviation < -1σ AND trend is BULLISH
   - SELL ONLY when: deviation > 1σ AND trend is BEARISH
   - HOLD otherwise

2. Position sizing (ETH equivalent):
   - |dev| > 2σ: ${positionSize.high} ETH
   - 1σ < |dev| ≤ 2σ: ${positionSize.medium} ETH
   - |dev| ≤ 1σ: HOLD (0 ETH)

3. Risk parameters (NON-NEGOTIABLE):
   Stop Loss: ${bayesianAnalysis.stopLoss.toFixed(2)}
   Take Profit: ${bayesianAnalysis.takeProfit.toFixed(2)}
   Slippage: ${slippage}%

4. Directional rules:
   - For BUY: 
        • SL must be BELOW current price
        • TP must be ABOVE current price
   - For SELL:
        • SL must be ABOVE current price
        • TP must be BELOW current price

5. Output requirements:
   ${this.getOutputTemplate(positionSize, slippage, bayesianAnalysis)}

## CRITICAL WARNINGS ##
1. NEVER change stopLoss/takeProfit values
2. For hold decisions, USE EXACTLY:
   {
     "decision": "hold",
     "tokenIn": "${ZERO_ADDRESS}",
     "tokenOut": "${ZERO_ADDRESS}",
     "amount": "0",
     "slippage": 0,
     "stopLoss": 0,
     "takeProfit": 0
   }
     
   
3. Token addresses MUST be:
   - Stablecoin: ${this.stableToken}
   - Volatile: ${this.volatileToken}
4. Reasoning MUST include σ deviation`.trim(),

                instructions: `Current Market: ${this.symbol.toUpperCase()} 
Price: ${marketState.currentPrice} (Dev: ${priceDeviation.toFixed(2)}σ)
Signal: ${tradeSignal}

Output ONLY valid JSON with pre-calculated values`.trim(),

                token_mapping: {
                    "STABLECOIN": this.stableToken,
                    "VOLATILE": this.volatileToken
                },

                market_context: {
                    current_price: marketState.currentPrice,
                    predicted_price: bayesianAnalysis.predictedPrice,
                    deviation_sigma: priceDeviation,
                    confidence_interval: bayesianAnalysis.confidenceInterval,
                    trend: bayesianAnalysis.trendDirection,
                    volatility: volatility,
                    stop_loss: bayesianAnalysis.stopLoss,
                    take_profit: bayesianAnalysis.takeProfit,
                    recommended_position_size: positionSize,
                    recommended_slippage: slippage,
                    timestamp: new Date().toISOString()
                }
            },
            bayesianAnalysis
        };
    }

    // ======= HELPER METHODS =======

    private calculatePositionSize(absDeviation: number) {
        return {
            high: absDeviation > 2 ? 0.04 : 0,
            medium: absDeviation > 1 && absDeviation <= 2 ? 0.03 : 0
        };
    }

    private calculateSlippage(volatility: number) {
        return volatility > 0.03 ? 2.0 : 1.0;
    }

    private calculateConfidence(absDeviation: number): 'high' | 'medium' | 'low' {
        return absDeviation > 2 ? 'high' :
            absDeviation > 1 ? 'medium' : 'low';
    }

    private getTradeSignal(
        deviation: number,
        trend: 'bullish' | 'bearish' | 'neutral'
    ): string {
        if (deviation < -1 && trend === 'bullish') return 'STRONG BUY SIGNAL';
        if (deviation > 1 && trend === 'bearish') return 'STRONG SELL SIGNAL';
        if (Math.abs(deviation) > 1) return 'NO TRADE: Trend misalignment';
        return 'NO TRADE: Within 1σ confidence';
    }

    private getOutputTemplate(
        positionSize: { high: number; medium: number },
        slippage: number,
        bayesianAnalysis: BayesianRegressionResult
    ) {
        return `Generate JSON with EXACTLY these values:
{
  "decision": "{{buy/sell/hold}}",
  "tokenIn": "{{${this.stableToken}|${this.volatileToken}|${ZERO_ADDRESS}}}",
  "tokenOut": "{{${this.stableToken}|${this.volatileToken}|${ZERO_ADDRESS}}}",
  "amount": "${positionSize.high || positionSize.medium || '0'}",
  "slippage": ${slippage},
  "stopLoss": ${bayesianAnalysis.stopLoss.toFixed(2)},
  "takeProfit": ${bayesianAnalysis.takeProfit.toFixed(2)},
  "reasoning": "Max 20 words with σ reference",
  "confidence": "${this.calculateConfidence(Math.abs(positionSize.high ? 2.1 : positionSize.medium ? 1.5 : 0))}"
}`.trim();
    }

    private getVolatilityLevel(volatility: number): string {
        if (volatility < 0.01) return "low";
        if (volatility < 0.03) return "medium";
        if (volatility < 0.06) return "high";
        return "extreme";
    }


    enhancePromptWithSpike(
        basePrompt: any,
        currentPrice: number,
        previousPrice: number,
        changePercent: number
    ): any {
        const direction = currentPrice > previousPrice ? "up" : "down";
        const volatilityLevel = this.getVolatilityLevel(Math.abs(changePercent) / 100);
        const priceChange = Math.abs(changePercent);

        return {
            ...basePrompt,
            market_context: {
                ...(basePrompt.market_context || {}),
                price_event: {
                    type: "spike",
                    direction,
                    change_percent: priceChange,
                    current_price: currentPrice,
                    previous_price: previousPrice,
                    volatility_level: volatilityLevel
                }
            },
            instructions: `${basePrompt.instructions}\n\nIMPORTANT: Price spike detected (${priceChange.toFixed(2)}% ${direction})`
        };
    }

    validateDecision(
        decision: TradingDecision,
        bayesianAnalysis: BayesianRegressionResult,
        currentPrice: number
    ): boolean {
        // Always validate hold decisions first
        if (decision.decision === 'hold') {
            const isValidHold =
                decision.tokenIn === ZERO_ADDRESS &&
                decision.tokenOut === ZERO_ADDRESS &&
                decision.amount === "0" &&
                decision.slippage === 0;

            if (!isValidHold) {
                console.error("❌ Invalid hold decision format");
                return false;
            }
            return true;
        }

        // Validate token addresses for trades
        const validBuy = decision.tokenIn === this.stableToken &&
            decision.tokenOut === this.volatileToken;
        const validSell = decision.tokenIn === this.volatileToken &&
            decision.tokenOut === this.stableToken;

        if (!(validBuy || validSell)) {
            console.error("❌ Invalid token pair");
            return false;
        }

        // Validate risk parameters
        if (decision.stopLoss === undefined || decision.takeProfit === undefined) {
            console.error("❌ Missing risk parameters");
            return false;
        }

        const slDiff = Math.abs(decision.stopLoss - bayesianAnalysis.stopLoss);
        const tpDiff = Math.abs(decision.takeProfit - bayesianAnalysis.takeProfit);

        if (slDiff > currentPrice * 0.01 || tpDiff > currentPrice * 0.01) {
            console.error(`❌ Risk parameters differ from Bayesian values: 
            SL: ${decision.stopLoss} vs ${bayesianAnalysis.stopLoss}
            TP: ${decision.takeProfit} vs ${bayesianAnalysis.takeProfit}`);
            return false;
        }

        // Validate position sizing
        const stdDev = Math.sqrt(bayesianAnalysis.variance);
        const priceDeviation = Math.abs((currentPrice - bayesianAnalysis.predictedPrice) / stdDev);
        const amount = parseFloat(decision.amount);

        let expectedAmount = 0;
        if (priceDeviation > 2) expectedAmount = 0.04;
        else if (priceDeviation > 1) expectedAmount = 0.03;

        if (Math.abs(amount - expectedAmount) > 0.005) {
            console.error(`❌ Invalid position size: ${amount} vs expected ${expectedAmount}`);
            return false;
        }

        // Validate confidence level
        if (priceDeviation > 1.5 && decision.confidence !== 'high') {
            console.error(`❌ Confidence should be high for ${priceDeviation.toFixed(1)}σ deviation`);
            return false;
        }

        // Validate slippage range
        const validSlippage = bayesianAnalysis.volatility > 0.03
            ? decision.slippage >= 1.5 && decision.slippage <= 3
            : decision.slippage >= 0.5 && decision.slippage <= 1.5;

        if (!validSlippage) {
            console.error(`❌ Invalid slippage: ${decision.slippage} for volatility ${bayesianAnalysis.volatility}`);
            return false;
        }

        return true;
    }
}