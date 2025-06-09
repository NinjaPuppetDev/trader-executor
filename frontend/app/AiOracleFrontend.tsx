'use client';

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import contractABI from "./abis/VeniceAutomation.json";
import React from "react";
import TraderDashboard from "./TraderFrontend";

interface LogEntry {
    id: string;
    timestamp: string;
    prompt: string;
    decision: string;
    decisionLength: number;
    status: 'pending' | 'completed' | 'failed';
    txHash?: string;
    blockNumber?: number;
    error?: string;
    createdAt: string;
}

export default function TestVenicePage() {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");
    const [loading, setLoading] = useState(false);
    const [lastChainTrigger, setLastChainTrigger] = useState<string | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    // Enhanced fetch with error handling and retries
    const fetchLogs = async () => {
        try {
            const res = await fetch('/api/logs', {
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }

            const data: LogEntry[] = await res.json();

            // Sort by newest first and filter invalid entries
            const processedLogs = data
                .filter(log => log?.id && log.createdAt)
                .sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );

            setLogs(processedLogs);
            setError(null);
        } catch (err) {
            console.error('Failed to fetch logs:', err);
            setError('Failed to load logs. Retrying...');
            setTimeout(fetchLogs, 5000); // Retry after 5 seconds
        } finally {
            setLoadingLogs(false);
        }
    };

    useEffect(() => {
        // Initialize Ethereum provider
        const initEthereum = async () => {
            try {
                if (!process.env.NEXT_PUBLIC_RPC_URL || !process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) {
                    throw new Error("Missing required environment variables");
                }

                const provider = new ethers.providers.JsonRpcProvider(
                    process.env.NEXT_PUBLIC_RPC_URL
                );

                // Verify connection
                await provider.getBlockNumber();

                const contract = new ethers.Contract(
                    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
                    contractABI,
                    provider
                );

                const handleEvent = (timestamp: ethers.BigNumber) => {
                    const date = new Date(timestamp.toNumber() * 1000);
                    setLastChainTrigger(date.toLocaleString());
                    fetchLogs(); // Refresh logs on new event
                };

                contract.on("RequestAnalysis", handleEvent);

                return () => {
                    contract.off("RequestAnalysis", handleEvent);
                };
            } catch (err) {
                console.error("Ethereum initialization error:", err);
                setError("Failed to connect to blockchain");
            }
        };

        initEthereum();
        fetchLogs(); // Initial load

        const interval = setInterval(fetchLogs, 10000); // Refresh every 10 seconds

        return () => clearInterval(interval);
    }, []);

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

            if (!res.ok) {
                throw new Error(await res.text());
            }

            const data = await res.json();
            setResponse(data.signal);
            await fetchLogs(); // Refresh logs after submission
        } catch (err: any) {
            console.error("Prompt submission error:", err);
            setResponse("❌ Error: " + (err.message || "Failed to process request"));
        } finally {
            setLoading(false);
        }
    };

    const toggleLogExpansion = (id: string) => {
        setExpandedLogId(expandedLogId === id ? null : id);
    };

    const formatDecision = (decision: string) => {
        try {
            const parsed = JSON.parse(decision);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return decision;
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold mb-2">🧠 Venice TraderAI</h1>
                    <p className="text-gray-400">AI-powered trading signal analysis</p>
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

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Column - Input Section */}
                    <div className="space-y-6">
                        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                            <h2 className="text-xl font-semibold mb-4">📝 Trading Prompt</h2>
                            <textarea
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-purple-600 text-gray-100 placeholder-gray-500 transition-colors"
                                rows={6}
                                placeholder="Example: 'Analyze ETH/USD 4-hour chart for potential entry points considering RSI below 30 and MACD crossover'"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        sendPrompt();
                                    }
                                }}
                            />
                            <div className="flex justify-between items-center mt-2 text-sm text-gray-400">
                                <span>{prompt.length}/1000 characters</span>
                                <span>Shift+Enter for new line</span>
                            </div>
                        </div>

                        <button
                            onClick={sendPrompt}
                            disabled={loading || !prompt.trim()}
                            className={`w-full py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center ${loading || !prompt.trim()
                                ? 'bg-gray-700 cursor-not-allowed'
                                : 'bg-purple-600 hover:bg-purple-500 active:bg-purple-400'
                                }`}
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                    </svg>
                                    Get Trading Signal
                                </>
                            )}
                        </button>

                        {response && (
                            <div className="mt-6 p-5 rounded-lg bg-gray-800/50 border border-gray-700">
                                <div className="flex items-start">
                                    <div className={`flex-shrink-0 p-2 rounded-lg ${response.startsWith("❌") ? 'bg-red-900/20' : 'bg-green-900/20'
                                        }`}>
                                        {response.startsWith("❌") ? (
                                            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        ) : (
                                            <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        )}
                                    </div>
                                    <div className="ml-4">
                                        <h3 className="text-lg font-medium text-gray-200">
                                            {response.startsWith("❌") ? "Error" : "AI Trading Signal"}
                                        </h3>
                                        <div className="mt-2 text-gray-300 whitespace-pre-wrap">
                                            {response}
                                        </div>

                                    </div>
                                </div>
                            </div>
                        )}

                        {lastChainTrigger && (
                            <div className="mt-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                                <div className="flex items-center text-sm text-green-400">
                                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Last Chainlink trigger: {lastChainTrigger}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column - System Logs */}
                    <div>
                        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 h-full">
                            <h2 className="text-xl font-semibold mb-4 flex items-center">
                                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                System Logs
                                {loadingLogs && (
                                    <span className="ml-2">
                                        <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    </span>
                                )}
                            </h2>

                            {logs.length === 0 ? (
                                <div className="text-center py-8 bg-gray-800/30 rounded-lg border border-gray-700">
                                    {loadingLogs ? (
                                        <div className="flex items-center justify-center">
                                            <svg className="animate-spin h-5 w-5 mr-2 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Loading logs...
                                        </div>
                                    ) : (
                                        <p className="text-gray-400">No activity logs available</p>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-gray-800/30 rounded-lg border border-gray-700 max-h-[500px] overflow-y-auto">
                                    <table className="min-w-full divide-y divide-gray-700/50">
                                        <thead className="bg-gray-750 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Prompt</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Details</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-700/30">
                                            {logs.map((log) => (
                                                <React.Fragment key={log.id}>
                                                    <tr
                                                        className="hover:bg-gray-750/50 transition-colors cursor-pointer"
                                                        onClick={() => toggleLogExpansion(log.id)}
                                                    >
                                                        <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                                                            {new Date(log.createdAt).toLocaleTimeString()}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm text-gray-300 max-w-[120px] truncate" title={log.prompt}>
                                                            {log.prompt}
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.status === 'completed'
                                                                ? 'bg-green-900/30 text-green-400 border border-green-800'
                                                                : log.status === 'failed'
                                                                    ? 'bg-red-900/30 text-red-400 border border-red-800'
                                                                    : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                                                                }`}>
                                                                {log.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-sm">
                                                            {log.txHash ? (
                                                                <a
                                                                    href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/tx/${log.txHash}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center text-purple-400 hover:text-purple-300"
                                                                    title="View transaction"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <span className="truncate max-w-[80px]">
                                                                        {log.txHash.slice(0, 6)}...{log.txHash.slice(-4)}
                                                                    </span>
                                                                    <svg className="ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                    </svg>
                                                                </a>
                                                            ) : (
                                                                <span className="text-gray-500">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {expandedLogId === log.id && (
                                                        <tr className="bg-gray-750/50">
                                                            <td colSpan={4} className="px-4 py-3">
                                                                <div className="text-sm">
                                                                    <div className="font-medium text-gray-300 mb-1">Decision:</div>
                                                                    <pre className="text-gray-200 bg-gray-800/50 p-3 rounded-lg overflow-x-auto text-xs">
                                                                        {formatDecision(log.decision)}
                                                                    </pre>

                                                                    {log.error && (
                                                                        <div className="mt-2">
                                                                            <div className="font-medium text-gray-300 mb-1">Error:</div>
                                                                            <div className="text-red-400 text-xs bg-red-900/20 p-2 rounded">
                                                                                {log.error}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    <div className="mt-2 text-gray-400 text-xs">
                                                                        ID: {log.id} | Created: {new Date(log.createdAt).toLocaleString()} | Length: {log.decisionLength} chars
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}