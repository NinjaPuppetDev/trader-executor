'use client';
import React from 'react';
import { LogEntry, VeniceLogEntry, TradeExecutionLog } from './types';
import LogsTable from './LogsTable';

interface VeniceTraderTabProps {
    prompt: string;
    setPrompt: (value: string) => void;
    response: string;
    loading: boolean;
    lastVeniceTrigger: string | null;
    logs: LogEntry[];
    tradeExecutions: TradeExecutionLog[];
    loadingLogs: boolean;
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    sendPrompt: () => void;
    formatDecision: (decision: string) => string;
}

export default function VeniceTraderTab({
    prompt,
    setPrompt,
    response,
    loading,
    lastVeniceTrigger,
    logs,
    tradeExecutions,
    loadingLogs,
    expandedLogId,
    toggleLogExpansion,
    sendPrompt,
    formatDecision
}: VeniceTraderTabProps) {
    // Define columns with access to tradeExecutions
    const columns = [
        {
            header: "Time",
            accessor: (log: LogEntry) => new Date(log.createdAt).toLocaleTimeString()
        },
        {
            header: "Prompt",
            accessor: (log: LogEntry) => (
                <span className="max-w-[120px] truncate" title={(log as VeniceLogEntry).prompt}>
                    {(log as VeniceLogEntry).prompt}
                </span>
            )
        },
        {
            header: "Executed",
            accessor: (log: LogEntry) => {
                if (log.source !== 'venice') return <span className="text-gray-500">-</span>;

                const execution = tradeExecutions.find(e =>
                    e.sourceType === 'venice' && e.sourceLogId === log.id
                );

                if (!execution) return <span className="text-gray-500">Pending</span>;

                return (
                    <span className={`inline-flex items-center ${execution.status === 'completed'
                        ? 'text-green-400'
                        : 'text-red-400'
                        }`}>
                        {execution.status === 'completed' ? 'Executed' : 'Failed'}
                    </span>
                );
            }
        },
        {
            header: "Status",
            accessor: (log: LogEntry) => (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.status === 'completed'
                    ? 'bg-green-900/30 text-green-400 border border-green-800'
                    : log.status === 'failed'
                        ? 'bg-red-900/30 text-red-400 border border-red-800'
                        : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                    }`}>
                    {log.status}
                </span>
            )
        },
        {
            header: "Tx Hash",
            accessor: (log: LogEntry) => log.txHash ? (
                <span className="inline-flex items-center text-purple-400">
                    <span className="truncate max-w-[80px]">
                        {log.txHash.slice(0, 6)}...{log.txHash.slice(-4)}
                    </span>
                </span>
            ) : <span className="text-gray-500">-</span>
        }
    ];

    const renderExpandedRow = (log: LogEntry) => (
        <div className="text-sm">
            <div>
                <div className="font-medium text-gray-300 mb-1">Prompt:</div>
                <div className="text-gray-200">{(log as VeniceLogEntry).prompt}</div>
            </div>
            <div className="mt-3">
                <div className="font-medium text-gray-300 mb-1">Decision:</div>
                <pre className="text-gray-200 bg-gray-800/50 p-3 rounded-lg overflow-x-auto text-xs">
                    {formatDecision(log.decision)}
                </pre>
            </div>
            {log.error && (
                <div className="mt-3">
                    <div className="font-medium text-gray-300 mb-1">Error:</div>
                    <div className="text-red-400 text-xs bg-red-900/20 p-2 rounded">
                        {log.error}
                    </div>
                </div>
            )}
            <div className="mt-3 text-gray-400 text-xs">
                Source: {log.source} | ID: {log.id} | Created: {new Date(log.createdAt).toLocaleString()} | Length: {log.decisionLength} chars
            </div>
        </div>
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column */}
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
                            <div className={`flex-shrink-0 p-2 rounded-lg ${response.startsWith("❌")
                                ? 'bg-red-900/20'
                                : 'bg-green-900/20'
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

                {lastVeniceTrigger && (
                    <div className="mt-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700">
                        <div className="flex items-center text-sm text-green-400">
                            <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Last Venice trigger: {lastVeniceTrigger}
                        </div>
                    </div>
                )}
            </div>

            {/* Right Column */}
            <div>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 h-full">
                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                        <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Venice System Logs
                    </h2>

                    <LogsTable
                        logs={logs}
                        expandedLogId={expandedLogId}
                        toggleLogExpansion={toggleLogExpansion}
                        columns={columns}
                        renderExpandedRow={renderExpandedRow}
                    />
                </div>
            </div>
        </div>
    );
}