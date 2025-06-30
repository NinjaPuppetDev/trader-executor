import { getFearAndGreedIndex } from '../utils/fgiService';
import { getOnBalanceVolume } from '../utils/obvService';
import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';

const TOKEN_A = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const TOKEN_B = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const RL_LOG_PATH = path.resolve(__dirname, '../logs/rl-trainer-log.json');

const TOKEN_A_CHECKSUM = ethers.utils.getAddress(TOKEN_A);
const TOKEN_B_CHECKSUM = ethers.utils.getAddress(TOKEN_B);

interface PromptConfig {
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
    confidence?: 'high' | 'medium' | 'low';
}

function loadRLTrainerLogs(): any[] {
    try {
        if (fs.existsSync(RL_LOG_PATH)) {
            return JSON.parse(fs.readFileSync(RL_LOG_PATH, 'utf-8'));
        }
        return [];
    } catch (error) {
        console.error('Error loading RL logs:', error);
        return [];
    }
}

function formatStrategyInsights(logs: any[]): string {
    if (!logs.length) return "No recent strategy adjustments";

    return logs.slice(-3).map(log => {
        return `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.strategyFocus} strategy:
- ${log.insight}
- Actions: ${log.actions.join(', ')}`;
    }).join('\n\n');
}

export async function generatePromptConfig(): Promise<PromptConfig> {
    const [fgiResult, obvResult] = await Promise.allSettled([
        getFearAndGreedIndex(),
        getOnBalanceVolume('ETH')
    ]);

    const fgiData = fgiResult.status === 'fulfilled' ? fgiResult.value :
        { value: 50, classification: 'Neutral' };

    const obvData = obvResult.status === 'fulfilled' ? obvResult.value :
        {
            value: 0,
            trend: 'neutral',
            currentPrice: 0,
            priceChange24h: 0,
            priceChangePercent: 0
        };

    const rlLogs = loadRLTrainerLogs();
    const strategyInsights = formatStrategyInsights(rlLogs);

    const priceDirection = obvData.priceChange24h >= 0 ? '↑' : '↓';
    const priceChangeDisplay = obvData && typeof obvData.priceChange24h === 'number' && typeof obvData.priceChangePercent === 'number'
        ? `${priceDirection}${Math.abs(obvData.priceChange24h).toFixed(2)} (${Math.abs(obvData.priceChangePercent).toFixed(2)}%)`
        : 'N/A';

    const marketContext = `
## MARKET CONTEXT ##
Current Price: $${obvData.currentPrice.toFixed(2)}
24h Change: ${priceChangeDisplay}
Fear & Greed Index: ${fgiData.value} (${fgiData.classification})
On-Balance Volume: ${obvData.value.toLocaleString('en-US', {
        maximumFractionDigits: 0
    })} (${obvData.trend.toUpperCase()})
${getMarketSentiment(fgiData.value, obvData.trend, obvData.priceChangePercent)}
`.trim();

    const decisionFramework = `
## DECISION FRAMEWORK ##
Consider these factors holistically:
1. PRICE ACTION & VOLUME:
   - Current: $${obvData.currentPrice.toFixed(2)} (${priceChangeDisplay})
   - OBV: ${obvData.trend === 'bullish' ? '↑ Accumulation' : obvData.trend === 'bearish' ? '↓ Distribution' : '→ Neutral'}

2. MARKET SENTIMENT (FGI): 
   - <30 Extreme Fear: Potential buying opportunities
   - 30-45 Fear: Cautious accumulation
   - 45-55 Neutral: Technical-driven decisions
   - 55-70 Greed: Consider profit-taking
   - >70 Extreme Greed: Potential selling opportunities

3. VOLUME-PRICE CONFIRMATION:
   - Bullish + Rising OBV = Strong confirmation
   - Bullish + Falling OBV = Warning sign
   - Bearish + Falling OBV = Strong confirmation
   - Bearish + Rising OBV = Potential reversal

4. RECENT PERFORMANCE:
${strategyInsights || "   - No recent performance data available"}

5. RISK MANAGEMENT:
   - Avoid trading during high volatility (>5% 24h moves)
   - Require 2:1 reward/risk ratio minimum
   - Position size based on confidence level
`.trim();

    const positionGuide = `
## POSITION GUIDE ##
┌───────────────────┬───────────────────────┐
│ Confidence Level  │ ETH Amount            │
├───────────────────┼───────────────────────┤
│ High Confidence   │ 0.025 - 0.04          │
│ Medium Confidence │ 0.01 - 0.025          │
│ Low Confidence    │ 0 - 0.01 (or HOLD)    │
└───────────────────┴───────────────────────┘
* Only trade when technicals and fundamentals align
* High volatility (>5% moves): Reduce position size by 50%
`.trim();

    // ENHANCED: Added explicit output formatting instructions
    return {

        // In generatePromptConfig()
        system: `ROLE: Senior Cryptocurrency Analyst
// ... existing content ...
CRITICAL OUTPUT REQUIREMENTS:
1. After <think> analysis, output ONLY valid JSON
2. JSON must:
   - Use double quotes for all properties and string values
   - Contain these exact properties:
        "decision", "tokenIn", "tokenOut", "amount", 
        "slippage", "reasoning", "confidence"
3. Example valid output:
<think>
Market shows bullish indicators with rising OBV...
Recommend buying with medium confidence.
</think>
{
  "decision": "buy",
  "tokenIn": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "tokenOut": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "amount": "0.025",
  "slippage": 1.0,
  "reasoning": "Bullish indicators with volume confirmation",
  "confidence": "medium"
}
`.trim(),

        instructions: `Generate trading recommendation as JSON with these fields:
{
  "reasoning": "Brief analysis (max 25 words) including confidence level",
  "decision": "buy|sell|hold",
  "tokenIn": "Token address or 0x0 for hold",
  "tokenOut": "Token address or 0x0 for hold",
  "amount": "Trade amount in ETH (0 for hold)",
  "slippage": 1-3,
  "confidence": "high|medium|low"
}`,

        token_mapping: {
            "STABLECOIN": TOKEN_A_CHECKSUM,
            "VOLATILE": TOKEN_B_CHECKSUM
        },

        market_context: {
            current_price: obvData.currentPrice,
            price_change_24h: obvData.priceChange24h,
            price_change_percent: obvData.priceChangePercent,
            fgi: fgiData.value,
            fgi_classification: fgiData.classification,
            obv_value: obvData.value,
            obv_trend: obvData.trend,
            rl_insights: rlLogs.slice(-3),
            timestamp: new Date().toISOString()
        }
    };
}

function getMarketSentiment(
    fgi: number,
    obvTrend: string,
    priceChangePercent: number
): string {
    const sentiment = fgi < 30 ? "EXTREME FEAR - Potential buying opportunity" :
        fgi < 45 ? "FEAR - Market undervalued" :
            fgi < 55 ? "NEUTRAL - Balanced market" :
                fgi < 70 ? "GREED - Overvaluation concerns" :
                    "EXTREME GREED - Bubble risk";

    const volumeContext = obvTrend === 'bullish' ? " with volume accumulation" :
        obvTrend === 'bearish' ? " with volume distribution" :
            " with neutral volume flow";

    let priceSentiment = "";
    if (Math.abs(priceChangePercent) > 5) {
        priceSentiment = priceChangePercent > 0
            ? " STRONG UPTREND"
            : " STRONG DOWNTREND";
    } else if (Math.abs(priceChangePercent) > 2) {
        priceSentiment = priceChangePercent > 0
            ? " MODERATE UPTREND"
            : " MODERATE DOWNTREND";
    }

    return `Market Sentiment: ${sentiment}${volumeContext}${priceSentiment}`;
}