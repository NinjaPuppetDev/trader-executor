'use client';
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import contractABI from "../abis/VeniceUpkeep.json";
import priceTriggerABI from "../abis/PriceTrigger.json";
import { LogEntry, TradeExecutionLog } from "./types";
import VeniceTraderTab from "./VeniceTraderTab";
import PriceTriggerTab from "./PriceTriggerTab";
import TradeExecutionsTab from "./TradeExecutionsTab";

export default function TradingDashboard() {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");
    const [loading, setLoading] = useState(false);
    const [lastVeniceTrigger, setLastVeniceTrigger] = useState<string | null>(null);
    const [lastPriceSpike, setLastPriceSpike] = useState<string | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [tradeExecutions, setTradeExecutions] = useState<TradeExecutionLog[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'venice' | 'price-trigger' | 'executions'>('venice');

    // Fetch all logs from API
    const fetchAllLogs = async () => {
        setLoadingLogs(true);
        try {
            // Fetch all log types in parallel
            const [logsRes, executionsRes] = await Promise.all([
                fetch('/api/logs', { cache: 'no-store' }),
                fetch('/api/trade-executions', { cache: 'no-store' })
            ]);

            if (!logsRes.ok) throw new Error(`Logs error: ${logsRes.status}`);
            if (!executionsRes.ok) throw new Error(`Executions error: ${executionsRes.status}`);

            const logsData: any[] = await logsRes.json();
            const executionsData: TradeExecutionLog[] = await executionsRes.json();

            // Process and differentiate logs
            const processedLogs = logsData
                .filter(log => log?.id && log.createdAt)
                .map(log => {
                    if (log.prompt) {
                        return { ...log, source: "venice" };
                    } else if (log.priceContext) {
                        return { ...log, source: "price-trigger" };
                    }
                    return null;
                })
                .filter(Boolean) as LogEntry[];

            // Sort by newest first
            processedLogs.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            // Sort executions by newest first
            const sortedExecutions = [...executionsData].sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            setLogs(processedLogs);
            setTradeExecutions(sortedExecutions);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
            setError('Failed to load logs. Retrying...');
            setTimeout(fetchAllLogs, 5000);
        } finally {
            setLoadingLogs(false);
        }
    };

    // Initialize Ethereum listeners
    useEffect(() => {
        const initEthereum = async () => {
            try {
                if (!process.env.NEXT_PUBLIC_RPC_URL) {
                    throw new Error("Missing RPC_URL environment variable");
                }

                const provider = new ethers.providers.JsonRpcProvider(
                    process.env.NEXT_PUBLIC_RPC_URL
                );

                // Verify connection
                await provider.getBlockNumber();

                // Listen for Venice events
                if (process.env.NEXT_PUBLIC_VENICE_CONTRACT_ADDRESS) {
                    const veniceContract = new ethers.Contract(
                        process.env.NEXT_PUBLIC_VENICE_CONTRACT_ADDRESS,
                        contractABI,
                        provider
                    );

                    veniceContract.on("RequestAnalysis", (timestamp: ethers.BigNumber) => {
                        const date = new Date(timestamp.toNumber() * 1000);
                        setLastVeniceTrigger(date.toLocaleString());
                        fetchAllLogs();
                    });
                }

                // Listen for Price Trigger events
                if (process.env.NEXT_PUBLIC_PRICE_TRIGGER_ADDRESS) {
                    const priceContract = new ethers.Contract(
                        process.env.NEXT_PUBLIC_PRICE_TRIGGER_ADDRESS,
                        priceTriggerABI,
                        provider
                    );

                    priceContract.on("PriceSpikeDetected", (
                        currentPrice: ethers.BigNumber,
                        previousPrice: ethers.BigNumber,
                        changePercent: ethers.BigNumber
                    ) => {
                        const change = parseFloat(ethers.utils.formatUnits(changePercent, 2));
                        setLastPriceSpike(`${change.toFixed(2)}% change at ${new Date().toLocaleTimeString()}`);
                        fetchAllLogs();
                    });
                }

            } catch (err) {
                console.error("Ethereum initialization error:", err);
                setError("Failed to connect to blockchain");
            }
        };

        initEthereum();
        fetchAllLogs();

        const interval = setInterval(fetchAllLogs, 10000);
        return () => clearInterval(interval);
    }, []);

    // Submit prompt to API
    const sendPrompt = async () => {
        if (!prompt.trim()) return;

        setLoading(true);
        setResponse("");
        setError(null);

        try {
            const res = await fetch("/api/venice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
            });

            if (!res.ok) throw new Error(await res.text());

            const data = await res.json();
            setResponse(data.signal);
            await fetchAllLogs();
        } catch (err: any) {
            console.error("Prompt submission error:", err);
            setResponse("❌ Error: " + (err.message || "Failed to process request"));
        } finally {
            setLoading(false);
        }
    };

    // Toggle log details
    const toggleLogExpansion = (id: string) => {
        setExpandedLogId(expandedLogId === id ? null : id);
    };

    // Format JSON decisions
    const formatDecision = (decision: string) => {
        try {
            const parsed = JSON.parse(decision);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return decision;
        }
    };

    // Filter logs by active tab
    const veniceLogs = logs.filter(log => log.source === 'venice');
    const priceTriggerLogs = logs.filter(log => log.source === 'price-trigger');

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold mb-2">🚀 Trading Automation Dashboard</h1>
                    <p className="text-gray-400">AI-powered trading with real-time market triggers</p>
                </div>

                {/* Tab Navigation */}
                <div className="flex mb-6 border-b border-gray-700">
                    <button
                        className={`py-2 px-4 font-medium ${activeTab === 'venice'
                            ? 'text-purple-400 border-b-2 border-purple-400'
                            : 'text-gray-400 hover:text-gray-300'}`}
                        onClick={() => setActiveTab('venice')}
                    >
                        Venice AI Trader
                    </button>
                    <button
                        className={`py-2 px-4 font-medium ${activeTab === 'price-trigger'
                            ? 'text-purple-400 border-b-2 border-purple-400'
                            : 'text-gray-400 hover:text-gray-300'}`}
                        onClick={() => setActiveTab('price-trigger')}
                    >
                        Price Trigger System
                    </button>
                    <button
                        className={`py-2 px-4 font-medium ${activeTab === 'executions'
                            ? 'text-purple-400 border-b-2 border-purple-400'
                            : 'text-gray-400 hover:text-gray-300'}`}
                        onClick={() => setActiveTab('executions')}
                    >
                        Trade Executions
                    </button>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg">
                        <div className="flex items-center">
                            <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    </div>
                )}


                {activeTab === 'venice' ? (
                    <VeniceTraderTab
                        prompt={prompt}
                        setPrompt={setPrompt}
                        response={response}
                        loading={loading}
                        lastVeniceTrigger={lastVeniceTrigger}
                        logs={veniceLogs}
                        tradeExecutions={tradeExecutions} // Add this
                        loadingLogs={loadingLogs}
                        expandedLogId={expandedLogId}
                        toggleLogExpansion={toggleLogExpansion}
                        sendPrompt={sendPrompt}
                        formatDecision={formatDecision}
                    />
                ) : activeTab === 'price-trigger' ? (
                    <PriceTriggerTab
                        lastPriceSpike={lastPriceSpike}
                        logs={priceTriggerLogs}
                        tradeExecutions={tradeExecutions} // Add this
                        loadingLogs={loadingLogs}
                        expandedLogId={expandedLogId}
                        toggleLogExpansion={toggleLogExpansion}
                        formatDecision={formatDecision}
                    />
                ) : (
                    <TradeExecutionsTab
                        logs={tradeExecutions}
                        expandedLogId={expandedLogId} // Add this
                        toggleLogExpansion={toggleLogExpansion} // Add this
                    />
                )}
            </div>
        </div>
    );
}