import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile, watch } from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';

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

    constructor(apiKey: string, logsDir: string) {
        this.ai = new GoogleGenAI({ apiKey });
        this.logsDir = logsDir;
        this.rlLogPath = path.join(logsDir, 'rl-trainer-log.json');
        this.portfolioLogPath = path.join(logsDir, 'portfolio-logs.json');
    }

    public async startWatching(): Promise<void> {
        console.log('👀 Starting RL Training Watcher');

        // Create AbortController for graceful shutdown
        const controller = new AbortController();
        this.activeWatchers.push(controller);
        const { signal } = controller;

        try {
            const filesToWatch = [
                "price-trigger-logs.json",
                "trade-executions.json",
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
            await this.generateFeedback();
        } catch (error) {
            console.error('Automatic RL training failed:', error);
        }
    }

    public async generateFeedback(): Promise<RLFeedback> {
        try {
            // Load all required logs
            const [priceLogs, tradeLogs, portfolioLogs] = await Promise.all([
                this.loadLogs("price-trigger-logs.json"),
                this.loadLogs("trade-executions.json"),
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
                model: 'gemini-2.0-flash-001',
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

        return `
Comprehensive Trading Strategy Analysis

PORTFOLIO STATUS:
${portfolioSummary}

RECENT MARKET EVENTS (last 10):
${recentPriceLogs}

RECENT TRADE EXECUTIONS (last 10):
${recentTradeLogs}

ANALYSIS TASK:
1. Evaluate execution quality of recent trades
2. Identify patterns in successful/failed trades
3. Assess portfolio performance and risk exposure
4. Recommend specific strategy adjustments
5. Provide 3 actionable improvement steps

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
            return JSON.parse(text.substring(jsonStart, jsonEnd));
        } catch {
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
}