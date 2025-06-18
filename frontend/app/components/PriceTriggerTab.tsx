// PriceTriggerTab.tsx
'use client';
import React from 'react';
import { LogEntry, PriceTriggerLogEntry } from './types';
import LogsTable from './LogsTable';
import { TradeExecutionLog } from "./types";

interface PriceTriggerTabProps {
    lastPriceSpike: string | null;
    logs: LogEntry[];
    tradeExecutions: TradeExecutionLog[]; // Add this
    loadingLogs: boolean;
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    formatDecision: (decision: string) => string;
}

export default function PriceTriggerTab({
    lastPriceSpike,
    logs,
    loadingLogs,
    expandedLogId,
    toggleLogExpansion,
    formatDecision
}: PriceTriggerTabProps) {
    return (
        <div className="space-y-8">
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">📈 Price Trigger System</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">System Status</h3>
                        <div className="flex items-center text-green-400">
                            <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Active and monitoring
                        </div>
                    </div>

                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">Last Detected Spike</h3>
                        {lastPriceSpike ? (
                            <div className="flex items-center text-yellow-400">
                                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {lastPriceSpike}
                            </div>
                        ) : (
                            <div className="text-gray-400">No spikes detected yet</div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                    <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Price Trigger Logs
                </h2>

                <LogsTable
                    logs={logs}
                    expandedLogId={expandedLogId}
                    toggleLogExpansion={toggleLogExpansion}
                    columns={[
                        {
                            header: "Time",
                            accessor: (log) => new Date(log.createdAt).toLocaleTimeString()
                        },
                        {
                            header: "Price Context",
                            accessor: (log) => (
                                <span className="max-w-[120px] truncate" title={(log as PriceTriggerLogEntry).priceContext}>
                                    {(log as PriceTriggerLogEntry).priceContext}
                                </span>
                            )
                        },
                        {
                            header: "Status",
                            accessor: (log) => (
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
                            accessor: (log) => log.txHash ? (
                                <span className="inline-flex items-center text-purple-400">
                                    <span className="truncate max-w-[80px]">
                                        {log.txHash.slice(0, 6)}...{log.txHash.slice(-4)}
                                    </span>
                                </span>
                            ) : <span className="text-gray-500">-</span>
                        }
                    ]}
                    renderExpandedRow={(log) => (
                        <div className="text-sm">
                            <div>
                                <div className="font-medium text-gray-300 mb-1">Price Context:</div>
                                <div className="text-gray-200">{(log as PriceTriggerLogEntry).priceContext}</div>
                            </div>
                            {(log as PriceTriggerLogEntry).spikePercent && (
                                <div className="mt-3">
                                    <div className="font-medium text-gray-300 mb-1">Spike Percentage:</div>
                                    <div className="text-gray-200">{(log as PriceTriggerLogEntry).spikePercent?.toFixed(2)}%</div>
                                </div>
                            )}
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
                                Source: {log.source} | ID: {log.id} | Created: {new Date(log.createdAt).toLocaleString()} | Length: {log.decision ? log.decision.length : 0} chars
                            </div>
                        </div>
                    )}
                />
            </div>
        </div>
    );
}