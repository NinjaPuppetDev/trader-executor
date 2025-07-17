import { MarketDataCollector } from '../utils/marketDataCollector';
import { BayesianPriceAnalyzer, EnhancedBayesianResult } from '../utils/BayesianPriceAnalyzer';
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

// Enhanced config for more flexible prompting
export interface EnhancedPromptConfig extends PromptConfig {
    flexibility_level?: 'strict' | 'moderate' | 'flexible';
    decision_factors?: {
        technical_weight: number;
        bayesian_weight: number;
        risk_weight: number;
        market_regime_weight: number;
    };
    alternative_scenarios?: any;
}

export class PromptService {
    private marketDataCollector: MarketDataCollector;
    private stableToken: string;
    private volatileToken: string;
    private symbol: string;
    private flexibilityLevel: 'strict' | 'moderate' | 'flexible';

    constructor(
        marketDataCollector: MarketDataCollector,
        stableToken: string,
        volatileToken: string,
        symbol: string = 'ethusdt',
        flexibilityLevel: 'strict' | 'moderate' | 'flexible' = 'moderate'
    ) {
        this.marketDataCollector = marketDataCollector;
        this.stableToken = stableToken;
        this.volatileToken = volatileToken;
        this.symbol = symbol;
        this.flexibilityLevel = flexibilityLevel;
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

    // Original method - backwards compatible
    async generatePromptConfig(currentPrice?: number): Promise<{
        config: PromptConfig;
        bayesianAnalysis: BayesianRegressionResult
    }> {
        const result = await this.generateEnhancedPromptConfig(currentPrice);
        return {
            config: result.config,
            bayesianAnalysis: result.bayesianAnalysis
        };
    }

    // Enhanced method with more flexibility
    async generateEnhancedPromptConfig(currentPrice?: number): Promise<{
        config: EnhancedPromptConfig;
        bayesianAnalysis: EnhancedBayesianResult
    }> {
        const marketState = this.getMarketStateWithFallback();
        const bayesianAnalysis = BayesianPriceAnalyzer.analyze(marketState) as EnhancedBayesianResult;
        const technicalDecision = TechnicalAnalyzer.analyze(marketState);

        // Enhanced analysis table with more information
        const analysisTable = this.buildAnalysisTable(marketState, bayesianAnalysis, technicalDecision);

        // Determine trading opportunity with more nuanced logic
        const tradingOpportunity = this.assessTradingOpportunity(technicalDecision, bayesianAnalysis);

        // Build system message based on flexibility level
        const systemMessage = this.buildSystemMessage(
            analysisTable,
            tradingOpportunity,
            bayesianAnalysis,
            technicalDecision
        );

        // Decision factors for model consideration
        const decisionFactors = this.calculateDecisionFactors(bayesianAnalysis, technicalDecision);

        const config: EnhancedPromptConfig = {
            system: systemMessage,
            instructions: this.buildInstructions(marketState, technicalDecision, tradingOpportunity),
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
                regime: marketState.regime,
                // Enhanced context
                model_confidence: bayesianAnalysis.modelConfidence,
                random_walk_bias: bayesianAnalysis.randomWalkBias,
                mean_reversion: bayesianAnalysis.meanReversion,
                volatility_trend: this.getVolatilityTrend(marketState),
                decision_factors: decisionFactors
            },
            flexibility_level: this.flexibilityLevel,
            decision_factors: decisionFactors,
            alternative_scenarios: bayesianAnalysis.alternativeScenarios
        };

        return { config, bayesianAnalysis };
    }

    private buildAnalysisTable(
        marketState: MarketDataState,
        bayesianAnalysis: EnhancedBayesianResult,
        technicalDecision: any
    ): string {
        const baseTable = `
┌──────────────────────┬──────────────────────┐
│ Current Price        │ ${marketState.currentPrice.toFixed(2)} 
│ Predicted Price      │ ${bayesianAnalysis.predictedPrice.toFixed(2)} 
│ Confidence Interval  │ [${bayesianAnalysis.confidenceInterval[0].toFixed(2)}, ${bayesianAnalysis.confidenceInterval[1].toFixed(2)}]
│ Volatility           │ ${bayesianAnalysis.volatility.toFixed(4)}
│ Trend Direction      │ ${bayesianAnalysis.trendDirection.toUpperCase()}
│ Technical Signal     │ ${technicalDecision.state}
│ Market Regime        │ ${marketState.regime.toUpperCase()}`;

        if (bayesianAnalysis.modelConfidence) {
            return baseTable + `
│ Model Confidence     │ ${(bayesianAnalysis.modelConfidence * 100).toFixed(1)}%
│ Random Walk Bias     │ ${bayesianAnalysis.randomWalkBias?.toFixed(4) || 'N/A'}
│ Mean Reversion       │ ${bayesianAnalysis.meanReversion?.toFixed(4) || 'N/A'}
└──────────────────────┴──────────────────────┘`;
        }

        return baseTable + `
└──────────────────────┴──────────────────────┘`;
    }

    private assessTradingOpportunity(technicalDecision: any, bayesianAnalysis: EnhancedBayesianResult): {
        shouldTrade: boolean;
        strength: 'weak' | 'moderate' | 'strong';
        conflictingSignals: boolean;
        reasoning: string;
    } {
        const technicalStrong = technicalDecision.action !== 'hold' && technicalDecision.confidence > 60;
        const bayesianStrong = bayesianAnalysis.probability > 0.6;
        const modelsAgree = this.checkModelAgreement(technicalDecision, bayesianAnalysis);

        let strength: 'weak' | 'moderate' | 'strong' = 'weak';
        let shouldTrade = false;
        let conflictingSignals = false;
        let reasoning = '';

        if (technicalStrong && bayesianStrong && modelsAgree) {
            strength = 'strong';
            shouldTrade = true;
            reasoning = 'Strong agreement between technical and Bayesian models';
        } else if (technicalStrong || bayesianStrong) {
            strength = 'moderate';
            shouldTrade = this.flexibilityLevel !== 'strict';
            reasoning = 'Mixed signals - one model shows strength';
            conflictingSignals = !modelsAgree;
        } else {
            strength = 'weak';
            shouldTrade = false;
            reasoning = 'Weak signals from both models';
        }

        return { shouldTrade, strength, conflictingSignals, reasoning };
    }

    private checkModelAgreement(technicalDecision: any, bayesianAnalysis: EnhancedBayesianResult): boolean {
        const techDirection = technicalDecision.action;
        const bayesianDirection = bayesianAnalysis.trendDirection;

        if (techDirection === 'hold') return bayesianDirection === 'neutral';
        if (techDirection === 'buy') return bayesianDirection === 'bullish';
        if (techDirection === 'sell') return bayesianDirection === 'bearish';

        return false;
    }

    private buildSystemMessage(
        analysisTable: string,
        tradingOpportunity: any,
        bayesianAnalysis: EnhancedBayesianResult,
        technicalDecision: any
    ): string {
        const baseRole = `ROLE: Advanced Quantitative Trading Algorithm
TASK: Analyze market conditions and make optimal ETH/USD trading decisions

## DECISION FRAMEWORK ##
You are an advanced AI trading system with access to multiple analytical models:
1. Technical Analysis (momentum, patterns, indicators)
2. Bayesian Regression (statistical price prediction)
3. Random Walk Analysis (market efficiency assessment)
4. Mean Reversion Analysis (price equilibrium detection)

## CURRENT MARKET ANALYSIS ##
${analysisTable}`;

        let flexibilityGuidance = '';
        switch (this.flexibilityLevel) {
            case 'strict':
                flexibilityGuidance = `
## TRADING RULES (STRICT MODE) ##
1. TRADE ONLY when technical AND Bayesian signals strongly agree
2. MINIMUM confidence threshold: 75%
3. MANDATORY risk-reward ratio: 1.5:1
4. NO TRADES during conflicting signals`;
                break;

            case 'moderate':
                flexibilityGuidance = `
## TRADING GUIDELINES (MODERATE MODE) ##
1. PREFER trades when models agree, but consider strong single signals
2. ADAPT confidence threshold based on market regime (50-75%)
3. FLEXIBLE risk-reward ratio: 1.2-2.0:1 based on opportunity
4. EVALUATE conflicting signals case-by-case`;
                break;

            case 'flexible':
                flexibilityGuidance = `
## TRADING PHILOSOPHY (FLEXIBLE MODE) ##
1. SYNTHESIZE all available information for optimal decisions
2. DYNAMIC confidence thresholds based on market conditions
3. ADAPTIVE risk management based on volatility and regime
4. CONSIDER contrarian opportunities when models disagree`;
                break;
        }

        const opportunitySection = `
## CURRENT OPPORTUNITY ASSESSMENT ##
Signal Strength: ${tradingOpportunity.strength.toUpperCase()}
Models Agreement: ${tradingOpportunity.conflictingSignals ? 'CONFLICTING' : 'ALIGNED'}
Recommended Action: ${tradingOpportunity.shouldTrade ? 'EVALUATE TRADE' : 'HOLD/MONITOR'}
Reasoning: ${tradingOpportunity.reasoning}`;

        let alternativeScenarios = '';
        if (bayesianAnalysis.alternativeScenarios) {
            alternativeScenarios = `
## ALTERNATIVE SCENARIOS ##
Bearish: ${bayesianAnalysis.alternativeScenarios.bearish.price.toFixed(2)} (${(bayesianAnalysis.alternativeScenarios.bearish.probability * 100).toFixed(1)}%)
Neutral: ${bayesianAnalysis.alternativeScenarios.neutral.price.toFixed(2)} (${(bayesianAnalysis.alternativeScenarios.neutral.probability * 100).toFixed(1)}%)
Bullish: ${bayesianAnalysis.alternativeScenarios.bullish.price.toFixed(2)} (${(bayesianAnalysis.alternativeScenarios.bullish.probability * 100).toFixed(1)}%)`;
        }

        const outputFormat = this.getOutputFormat(tradingOpportunity, bayesianAnalysis, technicalDecision);

        return `${baseRole}${flexibilityGuidance}${opportunitySection}${alternativeScenarios}

## TOKEN ADDRESSES ##
Stablecoin: ${this.stableToken}
Volatile: ${this.volatileToken}

${outputFormat}`;
    }

    private getOutputFormat(tradingOpportunity: any, bayesianAnalysis: EnhancedBayesianResult, technicalDecision: any): string {
        const suggestedAction = tradingOpportunity.shouldTrade ? technicalDecision.action : 'hold';
        const suggestedTokenIn = tradingOpportunity.shouldTrade ?
            (technicalDecision.action === 'buy' ? this.stableToken : this.volatileToken) :
            ZERO_ADDRESS;
        const suggestedTokenOut = tradingOpportunity.shouldTrade ?
            (technicalDecision.action === 'buy' ? this.volatileToken : this.stableToken) :
            ZERO_ADDRESS;

        if (this.flexibilityLevel === 'strict') {
            return `## REQUIRED OUTPUT FORMAT ##
{
  "decision": "${suggestedAction}",
  "tokenIn": "${suggestedTokenIn}",
  "tokenOut": "${suggestedTokenOut}",
  "amount": "0",
  "slippage": ${tradingOpportunity.shouldTrade ? (bayesianAnalysis.volatility > 0.03 ? 2.0 : 1.0) : 0},
  "stopLoss": ${technicalDecision.stopLoss.toFixed(2)},
  "takeProfit": ${technicalDecision.takeProfit.toFixed(2)},
  "reasoning": "${technicalDecision.reasoning.replace(/"/g, '\\"')}",
  "confidence": "${this.getConfidenceCategory(technicalDecision.confidence)}"
}`;
        } else {
            return `## SUGGESTED OUTPUT FORMAT ##
Based on analysis, consider this structure but adapt as needed:

{
  "decision": "${suggestedAction}", // or your reasoned decision
  "tokenIn": "${suggestedTokenIn}",
  "tokenOut": "${suggestedTokenOut}",
  "amount": "0",
  "slippage": ${tradingOpportunity.shouldTrade ? (bayesianAnalysis.volatility > 0.03 ? 2.0 : 1.0) : 0}, // adjust for conditions
  "stopLoss": ${technicalDecision.stopLoss.toFixed(2)}, // or calculated value
  "takeProfit": ${technicalDecision.takeProfit.toFixed(2)}, // or calculated value
  "reasoning": "Your comprehensive analysis incorporating all factors",
  "confidence": "${this.getConfidenceCategory(technicalDecision.confidence)}", // or assessed confidence
  "modelSynthesis": "How you weighted different model inputs",
  "riskAssessment": "Your risk evaluation for this decision"
}

## DECISION GUIDANCE ##
- SYNTHESIZE technical, Bayesian, and market regime information
- EXPLAIN your reasoning process clearly
- JUSTIFY confidence level based on signal strength and model agreement
- CONSIDER alternative scenarios in your risk assessment
- ADAPT parameters based on current market volatility and regime`;
        }
    }

    private buildInstructions(marketState: MarketDataState, technicalDecision: any, tradingOpportunity: any): string {
        const base = `MARKET: ${this.symbol.toUpperCase()}
PRICE: ${marketState.currentPrice}
TECHNICAL SIGNAL: ${technicalDecision.state}
REGIME: ${marketState.regime.toUpperCase()}`;

        if (this.flexibilityLevel === 'strict') {
            return `${base}

OUTPUT ONLY THE REQUIRED JSON OBJECT`;
        } else {
            return `${base}
OPPORTUNITY: ${tradingOpportunity.strength.toUpperCase()}

ANALYZE all provided information and make your best trading decision.
EXPLAIN your reasoning process clearly.
CONSIDER risk-reward optimization.
OUTPUT your decision as JSON with reasoning.`;
        }
    }

    private calculateDecisionFactors(bayesianAnalysis: EnhancedBayesianResult, technicalDecision: any): {
        technical_weight: number;
        bayesian_weight: number;
        risk_weight: number;
        market_regime_weight: number;
    } {
        // Base weights
        let weights = {
            technical_weight: 0.35,
            bayesian_weight: 0.35,
            risk_weight: 0.2,
            market_regime_weight: 0.1
        };

        // Adjust based on model confidence and market conditions
        if (bayesianAnalysis.modelConfidence && bayesianAnalysis.modelConfidence > 0.7) {
            weights.bayesian_weight += 0.1;
            weights.technical_weight -= 0.05;
            weights.risk_weight -= 0.05;
        }

        if (technicalDecision.confidence > 80) {
            weights.technical_weight += 0.1;
            weights.bayesian_weight -= 0.05;
            weights.risk_weight -= 0.05;
        }

        // Increase risk weight in volatile markets
        if (bayesianAnalysis.volatility > 0.04) {
            weights.risk_weight += 0.1;
            weights.technical_weight -= 0.05;
            weights.bayesian_weight -= 0.05;
        }

        return weights;
    }

    private getVolatilityTrend(marketState: MarketDataState): 'increasing' | 'decreasing' | 'stable' {
        if (marketState.prices.length < 10) return 'stable';

        const recentVol = this.calculateVolatility(marketState.prices.slice(-5));
        const priorVol = this.calculateVolatility(marketState.prices.slice(-10, -5));

        if (recentVol > priorVol * 1.1) return 'increasing';
        if (recentVol < priorVol * 0.9) return 'decreasing';
        return 'stable';
    }

    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;

        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    private getConfidenceCategory(confidence: number): string {
        return confidence > 75 ? 'high' : confidence > 60 ? 'medium' : 'low';
    }

    // Utility method to switch flexibility levels at runtime
    setFlexibilityLevel(level: 'strict' | 'moderate' | 'flexible'): void {
        this.flexibilityLevel = level;
    }

    // Method to get current flexibility level
    getFlexibilityLevel(): 'strict' | 'moderate' | 'flexible' {
        return this.flexibilityLevel;
    }
}