'use client';
import React from 'react';
import { formatUnits } from 'ethers/lib/utils';
import { TradeExecutionLog } from "./types";

interface TradeExecutionsTabProps {
    logs: TradeExecutionLog[];
    expandedLogId: string | null; // Add this
    toggleLogExpansion: (id: string) => void; // Add this
}
export default function TradeExecutionsTab({ logs }: TradeExecutionsTabProps) {
    const formatToken = (amount: string, decimals = 18) => {
        return parseFloat(formatUnits(amount, decimals)).toFixed(4);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-900/30 text-green-400 border border-green-800';
            case 'failed': return 'bg-red-900/30 text-red-400 border border-red-800';
            default: return 'bg-yellow-900/30 text-yellow-400 border border-yellow-800';
        }
    };

    const getSourceColor = (source: string) => {
        switch (source) {
            case 'venice': return 'bg-purple-900/30 text-purple-400 border border-purple-800';
            case 'price-trigger': return 'bg-blue-900/30 text-blue-400 border border-blue-800';
            default: return 'bg-gray-700 text-gray-300';
        }
    };

    return (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Trade Executions
            </h2>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-700/50">
                    <thead className="bg-gray-750">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Source</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Tokens</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">TX Hash</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/30">
                        {logs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-750/50">
                                <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                                    {new Date(log.createdAt).toLocaleTimeString()}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getSourceColor(log.sourceType)}`}>
                                        {log.sourceType}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-300 uppercase">
                                    {JSON.parse(log.decision).decision}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-300">
                                    {formatToken(log.amountIn)} {log.tokenIn} →
                                    {log.actualAmountOut ? ` ${formatToken(log.actualAmountOut)} ${log.tokenOut}` : ' ???'}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(log.status)}`}>
                                        {log.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-sm">
                                    {log.txHash ? (
                                        <a
                                            href={`https://etherscan.io/tx/${log.txHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-purple-400 hover:text-purple-300 transition-colors"
                                        >
                                            {log.txHash.slice(0, 6)}...{log.txHash.slice(-4)}
                                        </a>
                                    ) : (
                                        <span className="text-gray-500">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {logs.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                    No trade executions found
                </div>
            )}
        </div>
    );
}