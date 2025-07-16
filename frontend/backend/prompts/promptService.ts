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
        const technicalDecision = TechnicalAnalyzer.analyze(marketState);

        // Format Bayesian analysis
        const analysisTable = `
┌──────────────────────┬──────────────────────┐
│ Current Price        │ ${marketState.currentPrice.toFixed(2)} 
│ Predicted Price      │ ${bayesianAnalysis.predictedPrice.toFixed(2)} 
│ Confidence Interval  │ [${bayesianAnalysis.confidenceInterval[0].toFixed(2)}, ${bayesianAnalysis.confidenceInterval[1].toFixed(2)}]
│ Volatility           │ ${bayesianAnalysis.volatility.toFixed(4)}
│ Trend Direction      │ ${bayesianAnalysis.trendDirection.toUpperCase()}
│ Technical Signal     │ ${technicalDecision.state}
└──────────────────────┴──────────────────────┘`.trim();

        // Determine if we should trade
        const shouldTrade = technicalDecision.action === 'buy' || technicalDecision.action === 'sell';

        // Build the prompt system message
        let systemMessage = `ROLE: Quantitative Trading Algorithm
TASK: Execute ETH/USD trades based on technical analysis

## MANDATORY RULES ##
1. FOLLOW TECHNICAL ANALYSIS SIGNAL
2. ${shouldTrade ? 'OUTPUT TRADE DECISION AS JSON' : 'OUTPUT HOLD DECISION AS JSON'}
3. MINIMUM RISK-REWARD RATIO: 1.5:1
4. ${shouldTrade ? `TRADE DIRECTION: ${technicalDecision.action.toUpperCase()}` : 'NO TRADE OPPORTUNITY'}

## MARKET ANALYSIS ##
${analysisTable}`;

        if (shouldTrade) {
            systemMessage += `

## TRADE PARAMETERS ##
Stop Loss: ${bayesianAnalysis.stopLoss.toFixed(2)}
Take Profit: ${bayesianAnalysis.takeProfit.toFixed(2)}
Technical State: ${technicalDecision.state}

## TOKEN ADDRESSES ##
Stablecoin: ${this.stableToken}
Volatile: ${this.volatileToken}`;
        }

        systemMessage += `

## REQUIRED OUTPUT FORMAT ##
{
  "decision": "${shouldTrade ? technicalDecision.action : 'hold'}",
  "tokenIn": "${shouldTrade ?
                (technicalDecision.action === 'buy' ? this.stableToken : this.volatileToken) :
                ZERO_ADDRESS}",
  "tokenOut": "${shouldTrade ?
                (technicalDecision.action === 'buy' ? this.volatileToken : this.stableToken) :
                ZERO_ADDRESS}",
  "amount": "0", // Position sizing should be handled externally
  "slippage": ${shouldTrade ? (bayesianAnalysis.volatility > 0.03 ? 2.0 : 1.0) : 0},
  "stopLoss": ${shouldTrade ? bayesianAnalysis.stopLoss.toFixed(2) : 0},
  "takeProfit": ${shouldTrade ? bayesianAnalysis.takeProfit.toFixed(2) : 0},
  "reasoning": "${technicalDecision.reasoning.replace(/"/g, '\\"')}",
  "confidence": "${technicalDecision.confidence > 75 ? 'high' : technicalDecision.confidence > 60 ? 'medium' : 'low'}"
}

## CRITICAL INSTRUCTIONS ##
1. ${shouldTrade ? 'EXECUTE TRADE ONLY IF TECHNICAL SIGNAL IS STRONG' : 'DO NOT TRADE WHEN TECHNICAL SIGNAL IS WEAK'}
2. VERIFY STOP-LOSS/TAKE-PROFIT LEVELS BEFORE OUTPUT`.trim();

        return {
            config: {
                system: systemMessage,
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
                    trade_direction: technicalDecision.action,
                    stop_loss: bayesianAnalysis.stopLoss,
                    take_profit: bayesianAnalysis.takeProfit,
                    confidence: technicalDecision.confidence,
                    timestamp: new Date().toISOString(),
                    regime: marketState.regime
                }
            },
            bayesianAnalysis
        };
    }
}