// utils/promptGenerator.ts
import { getFearAndGreedIndex } from '../utils/fgiService';
import { getOnBalanceVolume } from '../utils/obvService';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

// Define your test token addresses
const TOKEN_A = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const TOKEN_B = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
const DEFAULT_AMOUNT = "0.03";
const RL_LOG_PATH = path.resolve(__dirname, '../logs/rl-trainer-log.json'); // Adjust path as needed

interface TokenMapping {
    [symbol: string]: string;
}

interface PromptConfig {
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
    enforcement?: string;
    original_reasoning?: string;
}

// New function to load RL Trainer logs
function loadRLTrainerLogs(): any[] {
    try {
        if (fs.existsSync(RL_LOG_PATH)) {
            const rawData = fs.readFileSync(RL_LOG_PATH, 'utf-8');
            return JSON.parse(rawData);
        }
        console.warn('RL Trainer log not found, using empty strategy insights');
        return [];
    } catch (error) {
        console.error('Error loading RL Trainer logs:', error);
        return [];
    }
}

// Format RL logs for prompt inclusion
function formatStrategyInsights(logs: any[]): string {
    if (!logs.length) return "No recent strategy adjustments available";

    return logs.map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString();
        return `[${timestamp}] RISK:${log.riskLevel} | FOCUS:${log.strategyFocus} | POSITION:${log.positionSizing}
- ${log.insight}
- Actions: ${log.actions.join(', ')}`;
    }).join('\n\n');
}

export async function generatePromptConfig(): Promise<PromptConfig> {
    const [fgiResult, obvResult] = await Promise.allSettled([
        getFearAndGreedIndex(),
        getOnBalanceVolume()
    ]);

    const fgiData = fgiResult.status === 'fulfilled'
        ? fgiResult.value
        : { value: 50, classification: 'Neutral', lastUpdated: new Date().toISOString() };

    const obvData = obvResult.status === 'fulfilled'
        ? obvResult.value
        : { value: 0, trend: 'neutral', lastUpdated: new Date().toISOString() };

    const tradingGuidance = getFgiTradingGuidelines(fgiData.value);
    const rlLogs = loadRLTrainerLogs();
    const strategyInsights = formatStrategyInsights(rlLogs.slice(-3));

    // Add OBV interpretation to guidance
    const obvGuidance = obvData.trend === 'bullish'
        ? "Volume accumulation suggests bullish momentum"
        : obvData.trend === 'bearish'
            ? "Volume distribution indicates bearish pressure"
            : "Volume momentum is neutral";

    const actionMatrix = `
VOLUME-AWARE DECISION MATRIX:
┌───────────────┬───────────────┬───────────────┬───────────────────┐
│ FGI Range     │ Price Action  │ OBV Trend     │ Required Decision │
├───────────────┼───────────────┼───────────────┼───────────────────┤
│ <30 (ExtFear) │ Any           │ Any           │ BUY               │
│ >70 (ExtGreed)│ Any           │ Any           │ SELL              │
│ 30-70         │ Spike ≥2%     │ Bearish       │ STRONG SELL       │
│ 30-70         │ Spike ≥2%     │ Bullish       │ SELL (Caution)    │
│ 30-70         │ Drop ≥2%      │ Bullish       │ STRONG BUY        │
│ 30-70         │ Drop ≥2%      │ Bearish       │ BUY (Caution)     │
│ 30-70         │ Neutral       │ -             │ SELL if FGI≥55    │
│               │               │               │ BUY if FGI<55     │
└───────────────┴───────────────┴───────────────┴───────────────────┘`.trim();

    const baseConfig: PromptConfig = {
        system: `INSTITUTIONAL TRADING AGENT - LIVE MODE
Current Market:
- FGI: ${fgiData.value} (${fgiData.classification}) 
- OBV: ${formatNumber(obvData.value)} (${obvData.trend.toUpperCase()})
- Volume Analysis: ${obvGuidance}
- FGI Guidance: ${tradingGuidance}

STRATEGY INSIGHTS (RL TRAINER):
${strategyInsights}

Position Sizing Guide:
┌───────────────┬───────────────────────┐
│ OBV Trend     │ ETH Amount Range      │
├───────────────┼───────────────────────┤
│ BULLISH       │ 0.035 - 0.05          │
│ NEUTRAL       │ 0.02 - 0.035          │
│ BEARISH       │ 0.01 - 0.02           │
└───────────────┴───────────────────────┘

ABSOLUTE RULES:
1. OUTPUT MUST BE "buy" OR "sell" - "wait" IS INVALID
2. Trade amount MUST be within OBV-based range
3. Token pairs MUST be from mapping below
4. Follow Decision Matrix EXACTLY:

${actionMatrix}

FAILURE TO FOLLOW RULES WILL CAUSE SYSTEM ERRORS`.replace(/  +/g, ' '),

        instructions: `Output JSON with EXACTLY these fields:
- reasoning: "[FGI:${fgiData.value}] [OBV:${obvData.trend}] [Action] [Risk:<1-5>]" (max 15 words)
- decision: "buy" or "sell"
- tokenIn: Valid address from mapping
- tokenOut: Valid address from mapping
- amount: String (within OBV-based range)
- slippage: 1-5`,

        token_mapping: {
            "TKNA": "0xYourTokenAAddress",
            "TKNB": "0xYourTokenBAddress"
        },

        market_context: {
            fgi: fgiData.value,
            classification: fgiData.classification,
            obv: obvData.value,
            obv_trend: obvData.trend,
            timestamp: new Date().toISOString(),
            enforcement_level: "STRICT",
            rl_insights: rlLogs.slice(-3)
        }
    };

    return baseConfig;
}

// Helper functions
function getFgiTradingGuidelines(fgiValue: number): string {
    if (fgiValue < 30) return "Extreme Fear - Strong buy opportunity";
    if (fgiValue > 70) return "Extreme Greed - Consider taking profits";
    if (fgiValue > 55) return "Greed - Caution advised for new positions";
    if (fgiValue < 45) return "Fear - Potential buying opportunities";
    return "Neutral - Market in balance, follow technicals";
}

// Helper function to format large numbers
function formatNumber(value: number): string {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(2);
}


export function enforceTradeDecision(response: any, fgi: number): TradingDecision {
    // Parse response
    let rawDecision: any;
    try {
        rawDecision = typeof response === 'string' ? JSON.parse(response) : response;
    } catch (error) {
        return createFallbackDecision(fgi, "Invalid JSON format");
    }

    // Fallback configuration
    const fallbackAction = fgi > 55 ? "sell" : "buy";
    const fallbackConfig = createFallbackDecision(fgi, "Fallback applied");

    // 1. Validate decision type
    if (!rawDecision || !["buy", "sell"].includes(rawDecision.decision?.toLowerCase?.())) {
        return {
            ...fallbackConfig,
            original_reasoning: rawDecision?.reasoning || "Invalid decision type",
            enforcement: "INVALID_DECISION"
        };
    }

    // 2. Validate amount
    let amountValue = 0;
    try {
        amountValue = parseFloat(rawDecision.amount || "0");
    } catch (error) {
        return {
            ...fallbackConfig,
            original_reasoning: "Invalid amount format",
            enforcement: "INVALID_AMOUNT_FORMAT"
        };
    }

    if (isNaN(amountValue) || amountValue <= 0) {
        return {
            ...fallbackConfig,
            original_reasoning: `Amount must be positive number: ${rawDecision.amount}`,
            enforcement: "INVALID_AMOUNT_VALUE"
        };
    }

    if (amountValue < 0.01 || amountValue > 0.05) {
        return {
            ...fallbackConfig,
            amount: DEFAULT_AMOUNT,
            original_reasoning: `Amount out of range: ${amountValue}`,
            enforcement: "AMOUNT_OUT_OF_RANGE"
        };
    }

    // 3. Validate tokens
    const validTokens = [TOKEN_A, TOKEN_B];
    if (!validTokens.includes(rawDecision.tokenIn) || !validTokens.includes(rawDecision.tokenOut)) {
        return {
            ...fallbackConfig,
            original_reasoning: `Invalid tokens: ${rawDecision.tokenIn} or ${rawDecision.tokenOut}`,
            enforcement: "INVALID_TOKENS"
        };
    }

    // 4. Validate token pair logic
    const isBuy = rawDecision.decision.toLowerCase() === 'buy';
    if (isBuy && rawDecision.tokenIn !== TOKEN_B) {
        return {
            ...fallbackConfig,
            tokenIn: TOKEN_B,
            tokenOut: TOKEN_A,
            original_reasoning: "Corrected token pair for BUY",
            enforcement: "TOKEN_PAIR_CORRECTED"
        };
    }

    if (!isBuy && rawDecision.tokenIn !== TOKEN_A) {
        return {
            ...fallbackConfig,
            tokenIn: TOKEN_A,
            tokenOut: TOKEN_B,
            original_reasoning: "Corrected token pair for SELL",
            enforcement: "TOKEN_PAIR_CORRECTED"
        };
    }

    // Return valid decision
    return {
        decision: rawDecision.decision.toLowerCase() as 'buy' | 'sell',
        tokenIn: rawDecision.tokenIn,
        tokenOut: rawDecision.tokenOut,
        amount: amountValue.toFixed(2),
        slippage: rawDecision.slippage || 1,
        reasoning: rawDecision.reasoning || fallbackConfig.reasoning
    };
}

function createFallbackDecision(fgi: number, reason: string): TradingDecision {
    const isSell = fgi > 55;
    return {
        decision: isSell ? 'sell' : 'buy',
        tokenIn: isSell ? TOKEN_A : TOKEN_B,
        tokenOut: isSell ? TOKEN_B : TOKEN_A,
        amount: DEFAULT_AMOUNT,
        slippage: 1,
        reasoning: `ENFORCED: ${reason} | FGI-${fgi} ${isSell ? 'SELL' : 'BUY'}`,
        enforcement: "FALLBACK_APPLIED"
    };
}

// Utility to check contract balance (optional)
export async function checkExecutorBalance(): Promise<{ tokenA: string; tokenB: string }> {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545');

        const tokenAContract = new ethers.Contract(
            TOKEN_A,
            ['function balanceOf(address) view returns (uint256)'],
            provider
        );

        const tokenBContract = new ethers.Contract(
            TOKEN_B,
            ['function balanceOf(address) view returns (uint256)'],
            provider
        );

        const executorAddress = process.env.EXECUTOR_ADDRESS || '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6';

        const balanceA = await tokenAContract.balanceOf(executorAddress);
        const balanceB = await tokenBContract.balanceOf(executorAddress);

        return {
            tokenA: ethers.utils.formatUnits(balanceA, 18),
            tokenB: ethers.utils.formatUnits(balanceB, 18)
        };
    } catch (error) {
        console.error('❌ Balance check failed:', error);
        return { tokenA: '0', tokenB: '0' };
    }
}