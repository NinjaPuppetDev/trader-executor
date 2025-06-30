// backend/rltraining/RLTrainingService.ts
import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile, watch } from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';

// State and Action Definitions
interface TradingState {
    timestamp: string | number | Date;
    portfolioValueUSD: number;
    stableBalance: number;
    volatileBalance: number;
    fgi: number; // Fear & Greed Index
    volatility: number; // 0-1 scale
    dominantTrend: 'bullish' | 'bearish' | 'neutral';
}

type TradingAction = 'BUY' | 'SELL' | 'HOLD';

interface RLFeedback {
    riskLevel: number;
    strategyFocus: "recovery" | "growth" | "stability";
    positionSizing: "increase" | "decrease" | "maintain";
    insight: string;
    actions: string[];
    portfolioMetrics?: {
        valueUSD: number;
        stableBalance: number;
        volatileBalance: number;
        fgi: number;
    };
}

export class RLTrainingService {
    private ai: GoogleGenAI;
    private logsDir: string;
    private rlLogPath: string;
    private portfolioLogPath: string;
    private activeWatchers: AbortController[] = [];
    private lastRunTime: number = 0;
    private minRunInterval: number = 5 * 60 * 1000; // 5 minutes

    // RL Components
    private qTable: Map<string, number> = new Map();
    private learningRate: number = 0.1;
    private discountFactor: number = 0.95;
    private qTablePath: string;
    private stateHistory: TradingState[] = [];

    constructor(apiKey: string, logsDir: string) {
        this.ai = new GoogleGenAI({ apiKey });
        this.logsDir = logsDir;
        this.rlLogPath = path.join(logsDir, 'rl-trainer-log.json');
        this.portfolioLogPath = path.join(logsDir, 'portfolio-logs.json');
        this.qTablePath = path.join(logsDir, 'qtable.json');
        this.loadQTable().catch(console.error);
    }

    // =====================
    // RL Core Functionality
    // =====================

    private async loadQTable(): Promise<void> {
        try {
            const data = await readFile(this.qTablePath, 'utf-8');
            this.qTable = new Map(JSON.parse(data));
            console.log(`📊 Loaded Q-table with ${this.qTable.size} entries`);
        } catch (error) {
            console.log('Initializing new Q-table');
            this.qTable = new Map();
        }
    }

    public async saveQTable(): Promise<void> {
        try {
            const data = JSON.stringify(Array.from(this.qTable.entries()));
            await writeFile(this.qTablePath, data);
            console.log('💾 Q-table saved');
        } catch (error) {
            console.error('Failed to save Q-table:', error);
        }
    }

    private serializeState(state: TradingState): string {
        // Simplified state representation for Q-table keys
        return [
            Math.round(state.portfolioValueUSD / 100), // Bucket by $100
            Math.round(state.stableBalance),
            Math.round(state.volatileBalance * 10), // Preserve 1 decimal precision
            Math.round(state.fgi / 5) * 5, // Bucket FGI by 5-point increments
            state.volatility > 0.6 ? 'high_vol' : 'low_vol',
            state.dominantTrend.substring(0, 3) // First 3 chars
        ].join('_');
    }

    private calculateReward(prevState: TradingState, action: TradingAction, currentState: TradingState): number {
        // 1. Profit component (40%)
        const valueChange = currentState.portfolioValueUSD - prevState.portfolioValueUSD;
        const profit = valueChange / prevState.portfolioValueUSD;

        // 2. Risk penalty (30%)
        const riskPenalty = -0.3 * Math.min(
            currentState.volatility *
            (currentState.volatileBalance / currentState.portfolioValueUSD),
            1
        );

        // 3. Action alignment (30%)
        let actionScore = 0;
        if (action === 'BUY' && currentState.dominantTrend === 'bullish') {
            actionScore = 0.3;
        } else if (action === 'SELL' && currentState.dominantTrend === 'bearish') {
            actionScore = 0.3;
        } else if (action === 'HOLD' && currentState.volatility > 0.6) {
            actionScore = 0.2;
        }

        return profit + riskPenalty + actionScore;
    }

    private updateQValue(prevState: TradingState, action: TradingAction, currentState: TradingState): void {
        const prevStateKey = this.serializeState(prevState);
        const compositeKey = `${prevStateKey}|${action}`;

        const reward = this.calculateReward(prevState, action, currentState);
        const currentQ = this.qTable.get(compositeKey) || 0;

        // Get max Q-value for next state
        const nextStateKey = this.serializeState(currentState);
        const nextActions = ['BUY', 'SELL', 'HOLD'] as TradingAction[];
        const maxNextQ = Math.max(...nextActions.map(a =>
            this.qTable.get(`${nextStateKey}|${a}`) || 0
        ));

        // Q-learning update
        const newQ = currentQ + this.learningRate *
            (reward + this.discountFactor * maxNextQ - currentQ);

        this.qTable.set(compositeKey, newQ);
    }

    public async processRecentTradesForRL(): Promise<number> {
        try {
            const [tradeLogs, portfolioLogs] = await Promise.all([
                this.loadLogs("executed-trades.json"),
                this.loadLogs("portfolio-logs.json")
            ]);

            // Cache portfolio states for faster lookup
            const portfolioStates: TradingState[] = portfolioLogs.map(p => ({
                timestamp: p.timestamp,
                portfolioValueUSD: p.portfolioValueUSD,
                stableBalance: p.stableBalance,
                volatileBalance: p.volatileBalance,
                fgi: p.fgi,
                volatility: p.volatility || 0.5,
                dominantTrend: p.dominantTrend || 'neutral'
            }));

            let processedCount = 0;

            // Process each trade to update Q-values
            for (const trade of tradeLogs.slice(-100)) { // Last 100 trades
                if (!trade.timestamp) continue;

                // Find closest portfolio states
                const tradeTime = new Date(trade.timestamp).getTime();
                const prevState = this.findClosestState(portfolioStates, tradeTime, -1);
                const nextState = this.findClosestState(portfolioStates, tradeTime, 1);

                if (prevState && nextState) {
                    this.updateQValue(
                        prevState,
                        trade.action as TradingAction,
                        nextState
                    );
                    processedCount++;
                }
            }

            // Save updated Q-table periodically
            if (processedCount > 0) {
                await this.saveQTable();
            }

            return processedCount;

        } catch (error) {
            console.error('RL trade processing failed:', error);
            return 0;
        }
    }

    private findClosestState(states: TradingState[], timestamp: number, direction: -1 | 1): TradingState | null {
        const tradeTime = new Date(timestamp).getTime();

        // Filter states by direction (before or after trade)
        const filtered = states.filter(s =>
            direction === -1
                ? new Date(s.timestamp).getTime() <= tradeTime
                : new Date(s.timestamp).getTime() >= tradeTime
        );

        if (filtered.length === 0) return null;

        // Find closest by time difference
        return filtered.reduce((closest, current) => {
            const closestTime = new Date(closest.timestamp).getTime();
            const currentTime = new Date(current.timestamp).getTime();
            const closestDiff = Math.abs(closestTime - tradeTime);
            const currentDiff = Math.abs(currentTime - tradeTime);

            return currentDiff < closestDiff ? current : closest;
        });
    }

    // =====================
    // Existing Functionality
    // =====================

    public async startWatching(): Promise<void> {
        console.log('👀 Starting RL Training Watcher');
        const controller = new AbortController();
        this.activeWatchers.push(controller);
        const { signal } = controller;

        try {
            const filesToWatch = [
                "price-detections.json",
                "executed-trades.json",
                "portfolio-logs.json"
            ];

            for (const file of filesToWatch) {
                const filePath = path.join(this.logsDir, file);
                (async () => {
                    try {
                        const watcher = watch(filePath, { signal });
                        for await (const event of watcher) {
                            if (event.eventType === 'change') {
                                this.onLogChange(file);
                            }
                        }
                    } catch (err: any) {
                        if (err.name !== 'AbortError') {
                            console.error(`File watch error for ${file}:`, err);
                        }
                    }
                })();
            }

            console.log('✅ Watching log files for changes');
        } catch (error) {
            console.error('Failed to start file watchers:', error);
        }
    }

    public stopWatching(): void {
        console.log('🛑 Stopping RL Training Watcher');
        this.activeWatchers.forEach(controller => controller.abort());
        this.activeWatchers = [];
    }

    private async onLogChange(fileChanged: string): Promise<void> {
        const now = performance.now();
        if (now - this.lastRunTime < this.minRunInterval) {
            console.log('Skipping RL training (too frequent)');
            return;
        }

        console.log(`📝 Log changed: ${fileChanged} - Triggering RL training`);
        this.lastRunTime = now;

        try {
            // Process new trades for RL
            const processed = await this.processRecentTradesForRL();
            console.log(`🔄 Processed ${processed} trades for RL update`);

            // Generate new feedback
            await this.generateFeedback();
        } catch (error) {
            console.error('Automatic RL training failed:', error);
        }
    }

    public async generateFeedback(): Promise<RLFeedback> {
        try {
            // Load all required logs
            const [priceLogs, tradeLogs, portfolioLogs] = await Promise.all([
                this.loadLogs("price-detection.json"),
                this.loadLogs("executed-trades.json"),
                this.loadLogs("portfolio-logs.json")
            ]);

            // Get latest portfolio metrics
            const portfolioMetrics = portfolioLogs.length > 0
                ? portfolioLogs[portfolioLogs.length - 1]
                : null;

            // Build enhanced prompt with portfolio data
            const prompt = this.buildPrompt(priceLogs, tradeLogs, portfolioMetrics);

            // Get AI response
            const response = await this.ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: prompt
            });

            // Parse response
            const feedback = this.parseResponse(response.text ?? "");

            // Add portfolio metrics to feedback
            if (portfolioMetrics) {
                feedback.portfolioMetrics = {
                    valueUSD: portfolioMetrics.portfolioValueUSD,
                    stableBalance: portfolioMetrics.stableBalance,
                    volatileBalance: portfolioMetrics.volatileBalance,
                    fgi: portfolioMetrics.fgi
                };
            }

            // Store feedback
            await this.storeFeedback(feedback);

            return feedback;
        } catch (error) {
            console.error("RL training failed:", error);
            return this.getFallbackFeedback();
        }
    }

    private async loadLogs(filename: string): Promise<any[]> {
        try {
            const filePath = path.join(this.logsDir, filename);
            const content = await readFile(filePath, "utf-8");
            return JSON.parse(content);
        } catch {
            return [];
        }
    }

    private buildPrompt(
        priceLogs: any[],
        tradeLogs: any[],
        portfolioMetrics: any | null
    ): string {
        // Process price logs
        const recentPriceLogs = priceLogs.slice(-10).map(log => {
            try {
                const decision = log.decision ? JSON.parse(log.decision).decision : 'none';
                return `- [${log.timestamp}] ${log.id}: ${log.spikePercent}% spike @ FGI ${log.fgi} → ${decision} (${log.status})`;
            } catch {
                return `- [${log.id}]: Invalid decision format`;
            }
        }).join('\n') || 'No price events';

        // Process trade logs
        const recentTradeLogs = tradeLogs.slice(-10).map(log => {
            const errorPreview = log.error ?
                log.error.substring(0, 100) + (log.error.length > 100 ? "..." : "") :
                'success';
            return `- [${log.timestamp}] ${log.id}: ${log.status} (source: ${log.sourceLogId}) → ${errorPreview}`;
        }).join('\n') || 'No trade executions';

        // Portfolio summary
        let portfolioSummary = 'No portfolio data available';
        if (portfolioMetrics) {
            portfolioSummary = `Current Portfolio:
- Value: $${portfolioMetrics.portfolioValueUSD.toFixed(2)}
- Stable: ${portfolioMetrics.stableBalance.toFixed(2)}
- Volatile: ${portfolioMetrics.volatileBalance.toFixed(4)}
- FGI: ${portfolioMetrics.fgi}`;
        }

        // Add RL insights if available
        let rlInsights = '';
        if (this.qTable.size > 0) {
            rlInsights = `\nRL MODEL INSIGHTS:
- States tracked: ${this.qTable.size}
- Recent updates: ${this.stateHistory.slice(-3).map(s =>
                `[$${s.portfolioValueUSD.toFixed(0)}|${s.dominantTrend.substring(0, 3)}]`
            ).join(' → ')}`;
        }

        return `
Comprehensive Trading Strategy Analysis

PORTFOLIO STATUS:
${portfolioSummary}
${rlInsights}

RECENT MARKET EVENTS (last 10):
${recentPriceLogs}

RECENT TRADE EXECUTIONS (last 10):
${recentTradeLogs}

ANALYSIS TASK:
1. Evaluate execution quality of recent trades
2. Identify patterns in successful/failed trades
3. Assess portfolio performance and risk exposure
4. Incorporate RL model insights where available
5. Recommend specific strategy adjustments
6. Provide 3 actionable improvement steps

OUTPUT AS VALID JSON:
{
  "riskLevel": 1-5, // 1=conservative, 5=aggressive
  "strategyFocus": "recovery", "growth", or "stability",
  "positionSizing": "increase", "decrease", or "maintain",
  "insight": "<50 character summary>",
  "actions": ["action1", "action2", "action3"]
}
`.trim();
    }

    private parseResponse(text: string): RLFeedback {
        try {
            // Extract JSON from response
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}') + 1;
            if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found');

            return JSON.parse(text.substring(jsonStart, jsonEnd));
        } catch (error) {
            console.error('Failed to parse response:', error);
            return this.getFallbackFeedback();
        }
    }

    private async storeFeedback(feedback: RLFeedback): Promise<void> {
        try {
            let allFeedback: any[] = [];

            try {
                const content = await readFile(this.rlLogPath, "utf-8");
                allFeedback = JSON.parse(content);
            } catch { }

            allFeedback.push({
                ...feedback,
                timestamp: new Date().toISOString()
            });

            await writeFile(this.rlLogPath, JSON.stringify(allFeedback, null, 2));
        } catch (error) {
            console.error("Failed to store feedback:", error);
        }
    }

    private getFallbackFeedback(): RLFeedback {
        return {
            riskLevel: 3,
            strategyFocus: "stability",
            positionSizing: "maintain",
            insight: "System initialization",
            actions: [
                "Maintain current strategy",
                "Collect more data",
                "Monitor system performance"
            ]
        };
    }

    // =====================
    // RL Utility Functions
    // =====================

    public getBestAction(currentState: TradingState): TradingAction {
        const stateKey = this.serializeState(currentState);
        const actions = ['BUY', 'SELL', 'HOLD'] as TradingAction[];

        let bestAction: TradingAction = 'HOLD';
        let bestQ = -Infinity;

        for (const action of actions) {
            const qValue = this.qTable.get(`${stateKey}|${action}`) || 0;
            if (qValue > bestQ) {
                bestQ = qValue;
                bestAction = action;
            }
        }

        // Track state history for insights
        this.stateHistory.push(currentState);
        if (this.stateHistory.length > 10) this.stateHistory.shift();

        return bestAction;
    }

    public getExploratoryAction(currentState: TradingState, epsilon = 0.2): TradingAction {
        if (Math.random() < epsilon) {
            // Random exploration
            const actions = ['BUY', 'SELL', 'HOLD'] as TradingAction[];
            return actions[Math.floor(Math.random() * actions.length)];
        }
        // Exploitation
        return this.getBestAction(currentState);
    }
}