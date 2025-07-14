'use client';
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { TradeExecutionLog } from "./types";
import LogsTable from "./LogsTable";
import { useTokenMetadata } from "../contexts/TokenMetadataContext";
import { gql, useQuery } from '@apollo/client';

// Utility functions
const formatUTCTime = (dateInput: string | number | Date): string => {
    if (!dateInput) return 'Invalid date';

    try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return 'Invalid date';

        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'UTC',
            hour12: false
        }) + ' UTC';
    } catch {
        return 'Invalid date';
    }
};

// Status configuration
const STATUS_CONFIG = {
    executed: { className: 'text-green-400', color: 'bg-green-500', text: 'Executed' },
    skipped: { className: 'text-yellow-400', color: 'bg-yellow-500', text: 'Skipped' },
    invalid: { className: 'text-red-400', color: 'bg-red-500', text: 'Invalid' },
    pending: { className: 'text-blue-400', color: 'bg-blue-500', text: 'Pending' },
    failed: { className: 'text-red-400', color: 'bg-red-500', text: 'Failed' },
    default: { className: 'text-gray-400', color: 'bg-gray-500', text: 'Unknown' },
};

// GraphQL query
const GET_TRADE_EXECUTIONS = gql`
    query GetTradeExecutions {
        trades {
            id
            sourceLogId
            status
            tokenIn
            tokenOut
            amountIn
            tokenInDecimals
            tokenOutDecimals
            txHash
            gasUsed
            minAmountOut
            actualAmountOut
            priceImpact
            error
            createdAt
        }
    }
`;

// Column definitions
const getTableColumns = (
    getTokenSymbol: (address: string) => string,
    formatAmount: (amount: string, decimals?: number) => string,
    getStatusProperties: (status: string) => any,
    toggleLogExpansion: (id: string) => void,
    expandedLogId: string | null
) => [
        {
            header: "Time",
            accessor: (log: TradeExecutionLog) => formatUTCTime(log.createdAt)
        },
        {
            header: "Pair",
            accessor: (log: TradeExecutionLog) => (
                <div className="flex items-center">
                    <span className="text-gray-300">
                        {getTokenSymbol(log.tokenIn)}
                    </span>
                    <span className="mx-1 text-gray-500">→</span>
                    <span className="text-gray-300">
                        {getTokenSymbol(log.tokenOut)}
                    </span>
                </div>
            )
        },
        {
            header: "Amount",
            accessor: (log: TradeExecutionLog) => (
                <div className="flex flex-col">
                    <span>In: {formatAmount(log.amountIn, log.tokenInDecimals)}</span>
                    {log.actualAmountOut && (
                        <span className="flex items-center">
                            Out: {formatAmount(log.actualAmountOut, log.tokenOutDecimals)}
                            {log.priceImpact > 5 && (
                                <span className="text-xs text-red-400 ml-2">
                                    ⚠️ High Impact
                                </span>
                            )}
                        </span>
                    )}
                </div>
            )
        },
        {
            header: "Status",
            accessor: (log: TradeExecutionLog) => {
                const statusProps = getStatusProperties(log.status || 'unknown');
                return (
                    <div className="flex items-center">
                        <span className={`inline-block w-3 h-3 rounded-full ${statusProps.color}`}></span>
                        <span className={`ml-2 text-sm ${statusProps.className}`}>
                            {statusProps.text}
                        </span>
                    </div>
                );
            }
        },
        {
            header: "Details",
            accessor: (log: TradeExecutionLog) => (
                <button
                    className="text-purple-400 hover:text-purple-300 transition-colors"
                    onClick={() => toggleLogExpansion(log.id)}
                >
                    {expandedLogId === log.id ? 'Hide Details' : 'Show Details'}
                </button>
            )
        }
    ];

interface TradeExecutionsTabProps {
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
}

export default function TradeExecutionsTab({
    expandedLogId,
    toggleLogExpansion
}: TradeExecutionsTabProps) {
    const [logs, setLogs] = useState<TradeExecutionLog[]>([]);
    const [lastUpdated, setLastUpdated] = useState<number>(0);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const { getTokenMetadata } = useTokenMetadata();

    // Apollo query with polling
    const { loading, error, data } = useQuery(GET_TRADE_EXECUTIONS, {
        pollInterval: 5000,
        fetchPolicy: "network-only",
        onCompleted: () => setConnectionStatus('connected'),
        onError: () => setConnectionStatus('disconnected'),
    });

    // Update logs when new data arrives
    useEffect(() => {
        if (data?.trades) {
            setLogs(prev => {
                const existingIds = new Set(prev.map(log => log.id));
                const newLogs = data.trades.filter(
                    (newLog: TradeExecutionLog) => !existingIds.has(newLog.id)
                );

                if (newLogs.length > 0) {
                    return [...newLogs, ...prev];
                }
                return prev;
            });
            setLastUpdated(Date.now());
        }
    }, [data]);

    // Handle connection status
    useEffect(() => {
        if (loading) setConnectionStatus('connecting');
        if (error) setConnectionStatus('disconnected');
    }, [loading, error]);

    // Memoized functions
    const getTokenSymbol = useCallback((address: string): string => {
        return getTokenMetadata(address)?.symbol || 'UNKNOWN';
    }, [getTokenMetadata]);

    // Fixed amount formatting
    const formatAmount = useCallback((amount: string, decimals: number = 18): string => {
        if (!amount || amount === '0') return '0';

        try {
            // Convert to BigInt safely
            const amountBigInt = BigInt(amount);
            const divisor = BigInt(10 ** decimals);

            const whole = amountBigInt / divisor;
            const fraction = amountBigInt % divisor;

            if (fraction === BigInt(0)) {
                return whole.toString();
            }

            // Format fractional part with 4 decimal places
            const fractionStr = fraction.toString()
                .padStart(decimals, '0')
                .substring(0, 4)
                .replace(/0+$/, '');

            return `${whole.toString()}.${fractionStr}`;
        } catch {
            return amount.slice(0, 8); // Fallback for large numbers
        }
    }, []);

    const getStatusProperties = useCallback((status: string) => {
        return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.default;
    }, []);

    const columns = useMemo(() =>
        getTableColumns(
            getTokenSymbol,
            formatAmount,
            getStatusProperties,
            toggleLogExpansion,
            expandedLogId
        ),
        [getTokenSymbol, formatAmount, getStatusProperties, toggleLogExpansion, expandedLogId]
    );

    // Simplified sorting
    const sortedLogs = useMemo(() => {
        return [...logs].sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }, [logs]);

    // Connection status indicator
    const renderConnectionStatus = () => {
        const statusProps = connectionStatus === 'connected'
            ? STATUS_CONFIG.executed
            : connectionStatus === 'disconnected'
                ? STATUS_CONFIG.failed
                : STATUS_CONFIG.pending;

        return (
            <div className="fixed top-4 left-4 flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm z-50 shadow-lg">
                <span className={`w-3 h-3 rounded-full ${statusProps.color}`}></span>
                <span>
                    {connectionStatus === 'connecting'
                        ? 'Connecting to GraphQL...'
                        : connectionStatus === 'connected'
                            ? 'Connected to GraphQL'
                            : 'Disconnected'}
                </span>
            </div>
        );
    };

    return (
        <div className="bg-gray-800 rounded-lg p-4 shadow-lg">
            {renderConnectionStatus()}

            <div className="mb-4 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold">Trade Execution History</h2>
                    <div className="text-sm text-gray-400 flex items-center mt-1">
                        {lastUpdated > 0 && (
                            <span>Updated: {formatUTCTime(lastUpdated)}</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center">
                    <span className="text-sm text-gray-400">
                        Showing {sortedLogs.length} executions
                    </span>
                </div>
            </div>

            {sortedLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    {connectionStatus === 'connected' ? 'Waiting for trades...' : 'No trade executions found'}
                </div>
            ) : (
                <LogsTable
                    logs={sortedLogs}
                    expandedLogId={expandedLogId}
                    toggleLogExpansion={toggleLogExpansion}
                    columns={columns}
                    renderExpandedRow={(log) => {
                        const statusProps = getStatusProperties(log.status || 'unknown');
                        const tokenInSymbol = getTokenSymbol(log.tokenIn);
                        const tokenOutSymbol = getTokenSymbol(log.tokenOut);

                        return (
                            <div className="text-sm space-y-4 p-4 bg-gray-750 rounded-lg">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <h3 className="font-bold text-gray-300 mb-2">Transaction Details</h3>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Status:</span>
                                                <span className={`${statusProps.className} flex items-center`}>
                                                    <span className={`w-2 h-2 rounded-full ${statusProps.color} mr-2`}></span>
                                                    {statusProps.text}
                                                </span>
                                            </div>
                                            {log.txHash && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">TX Hash:</span>
                                                    <a
                                                        href={`https://localhost/explorer/tx/${log.txHash}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-purple-400 hover:underline break-all"
                                                    >
                                                        {log.txHash.slice(0, 8)}...{log.txHash.slice(-6)}
                                                    </a>
                                                </div>
                                            )}
                                            {log.gasUsed && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">Gas Used:</span>
                                                    <span className="text-gray-300">{log.gasUsed}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Source Log:</span>
                                                <span className="text-gray-300 break-all">{log.sourceLogId}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="font-bold text-gray-300 mb-2">Trade Parameters</h3>
                                        <div className="space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Token In:</span>
                                                <div className="text-right">
                                                    <div className="text-gray-300">{tokenInSymbol}</div>
                                                    <div className="text-xs text-gray-500 break-all">{log.tokenIn}</div>
                                                </div>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Token Out:</span>
                                                <div className="text-right">
                                                    <div className="text-gray-300">{tokenOutSymbol}</div>
                                                    <div className="text-xs text-gray-500 break-all">{log.tokenOut}</div>
                                                </div>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Amount In:</span>
                                                <span className="text-gray-300">
                                                    {formatAmount(log.amountIn, log.tokenInDecimals)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Amount Out:</span>
                                                <span className="text-gray-300">
                                                    {log.actualAmountOut ?
                                                        formatAmount(log.actualAmountOut, log.tokenOutDecimals) : 'N/A'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Min Amount Out:</span>
                                                <span className="text-gray-300">
                                                    {log.minAmountOut ?
                                                        formatAmount(log.minAmountOut, log.tokenOutDecimals) : 'N/A'}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Price Impact:</span>
                                                <span className={log.priceImpact > 5 ? "text-red-300" : "text-gray-300"}>
                                                    {log.priceImpact ? `${log.priceImpact.toFixed(2)}%` : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {log.error && (
                                    <div className="mt-4 p-3 bg-red-900/30 rounded-lg">
                                        <h4 className="font-bold text-red-400 mb-1">Error</h4>
                                        <p className="text-sm text-red-300 break-all">{log.error}</p>
                                    </div>
                                )}

                                <div className="mt-4 flex justify-end">
                                    <button
                                        onClick={() => toggleLogExpansion(log.id)}
                                        className="text-sm text-gray-400 hover:text-gray-300 px-3 py-1 bg-gray-700 rounded"
                                    >
                                        Close Details
                                    </button>
                                </div>
                            </div>
                        );
                    }}
                />
            )}
        </div>
    );
}