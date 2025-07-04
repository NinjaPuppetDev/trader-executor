'use client';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { PriceDetectionLogEntry, isPriceDetectionLog } from './types';
import LogsTable from './LogsTable';
import { useTokenMetadata } from '../contexts/TokenMetadataContext';
import { gql, useQuery, useApolloClient, ApolloError } from '@apollo/client';

// Utility functions
const formatDate = (date: Date | string | number) => {
    const d = new Date(date);
    return isNaN(d.getTime()) ? 'Invalid Date' :
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (date: Date | string | number) => {
    const d = new Date(date);
    return isNaN(d.getTime()) ? 'Invalid Date' :
        d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

interface PriceTriggerTabProps {
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
}

const GET_PRICE_DETECTIONS = gql`
  query GetPriceDetections($limit: Int) {
    recentDetections(limit: $limit) {
      id
      spikePercent
      tokenIn
      tokenOut
      confidence
      amount
      createdAt
      eventTxHash
      eventBlockNumber
      status
      decision
      fgi
      fgiClassification
    }
  }
`;

const getTableColumns = (getTokenSymbol: (address: string) => string) => [
    {
        header: "Time",
        accessor: (log: PriceDetectionLogEntry) => formatDate(log.timestamp || log.createdAt)
    },
    {
        header: "Spike %",
        accessor: (log: PriceDetectionLogEntry) => (
            <span className={`font-bold ${(log.spikePercent || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {log.spikePercent?.toFixed(2)}%
            </span>
        )
    },
    {
        header: "Token Pair",
        accessor: (log: PriceDetectionLogEntry) => (
            <span>
                {getTokenSymbol(log.tokenIn || '')} → {getTokenSymbol(log.tokenOut || '')}
            </span>
        )
    },
    {
        header: "Status",
        accessor: (log: PriceDetectionLogEntry) => (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.status === 'completed' ? 'bg-green-900/30 text-green-400 border border-green-800' :
                log.status === 'failed' ? 'bg-red-900/30 text-red-400 border border-red-800' :
                    'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                }`}>
                {log.status}
            </span>
        )
    },
    {
        header: "Event Tx",
        accessor: (log: PriceDetectionLogEntry) => (
            log.eventTxHash ? (
                <a
                    href={`https://localhost/explorer/tx/${log.eventTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300"
                >
                    {log.eventTxHash.slice(0, 6)}...{log.eventTxHash.slice(-4)}
                </a>
            ) : <span className="text-gray-500">-</span>
        )
    }
];

export default function PriceTriggerTab({
    expandedLogId,
    toggleLogExpansion
}: PriceTriggerTabProps) {
    // State management
    const [priceTriggerLogs, setPriceTriggerLogs] = useState<PriceDetectionLogEntry[]>([]);
    const [lastUpdated, setLastUpdated] = useState(0);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { getTokenMetadata } = useTokenMetadata();
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Proper hook usage
    const apolloClient = useApolloClient();

    // Enhanced error handler
    const handleError = useCallback((error: ApolloError) => {
        console.error('GraphQL error:', error);
        setConnectionStatus('error');

        // Extract meaningful error message
        const messages = error.graphQLErrors?.map(e => e.message) || [];
        if (error.networkError) {
            messages.push(`Network error: ${error.networkError.message}`);
        }
        if (error.clientErrors?.length) {
            messages.push(...error.clientErrors.map(e => e.message));
        }

        setErrorMessage(messages.join('\n') || 'An unknown error occurred');
    }, []);

    // Fetch price detections
    const { loading, refetch } = useQuery(GET_PRICE_DETECTIONS, {
        variables: { limit: 50 },
        fetchPolicy: 'network-only',
        onCompleted: (data) => {
            setConnectionStatus('connected');
            setErrorMessage(null); // Clear previous errors on success

            if (data?.recentDetections) {
                try {
                    setPriceTriggerLogs(prev => {
                        const existingLogsMap = new Map(prev.map(log => [log.id, log]));
                        const newLogs = data.recentDetections.filter(
                            (newLog: PriceDetectionLogEntry) => !existingLogsMap.has(newLog.id)
                        );

                        if (newLogs.length > 0) {
                            const mergedLogs = [...newLogs, ...prev]
                                .sort((a, b) =>
                                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                                )
                                .slice(0, 50);
                            return mergedLogs;
                        }
                        return prev;
                    });
                    setLastUpdated(Date.now());
                } catch (e) {
                    console.error('Data processing error:', e);
                    setConnectionStatus('error');
                    setErrorMessage('Failed to process server response');
                }
            }
        },
        onError: handleError
    });

    // Setup polling with error handling
    useEffect(() => {
        const startPolling = () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }

            pollingIntervalRef.current = setInterval(() => {
                refetch().catch(err => {
                    console.error('Polling error:', err);
                    setConnectionStatus('disconnected');
                });
            }, 5000);
        };

        startPolling();
        refetch(); // Initial fetch

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [refetch]);

    // Memoized values
    const getTokenSymbol = useCallback((address: string): string => {
        try {
            return getTokenMetadata(address)?.symbol || 'UNKNOWN';
        } catch {
            return 'UNKNOWN';
        }
    }, [getTokenMetadata]);

    const latestLog = useMemo(() => priceTriggerLogs[0] || null, [priceTriggerLogs]);
    const columns = useMemo(() => getTableColumns(getTokenSymbol), [getTokenSymbol]);

    const parseDecision = useCallback((decision: string) => {
        if (!decision) return null;

        try {
            return JSON.parse(decision);
        } catch {
            try {
                // Try to extract JSON from the string
                const jsonMatch = decision.match(/\{[\s\S]*\}/);
                if (jsonMatch) return JSON.parse(jsonMatch[0]);

                // Try to clean and parse as JSON
                const cleaned = decision
                    .replace(/None/g, 'null')
                    .replace(/'/g, '"');
                return JSON.parse(cleaned);
            } catch (e) {
                console.error('Failed to parse decision:', e);
                return null;
            }
        }
    }, []);

    // Connection status component
    const renderConnectionStatus = () => {
        const statusColor = connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500';

        return (
            <div className="fixed top-4 left-4 flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm z-50 shadow-lg">
                <span className={`w-3 h-3 rounded-full ${statusColor} animate-pulse`}></span>
                <span>
                    {connectionStatus === 'connected' ? 'Live' :
                        connectionStatus === 'error' ? 'Error' : 'Connecting...'}
                </span>
            </div>
        );
    };

    // Reset errors and reconnect
    const handleRetry = useCallback(() => {
        setErrorMessage(null);
        setConnectionStatus('disconnected');
        refetch();
    }, [refetch]);

    // Loading state
    if (loading && priceTriggerLogs.length === 0) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-400">Loading price detections...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {renderConnectionStatus()}

            {/* Error display with retry option */}
            {errorMessage && (
                <div className="bg-red-900/50 p-4 rounded-lg border border-red-800">
                    <div className="flex justify-between items-start mb-2">
                        <h3 className="text-red-300 font-bold">Connection Error</h3>
                        <button
                            onClick={handleRetry}
                            className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                    <pre className="text-red-200 text-sm overflow-auto max-h-40">
                        {errorMessage}
                    </pre>
                </div>
            )}

            {/* System Status Section */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                <div className="flex justify-between items-start">
                    <h2 className="text-xl font-semibold mb-4 flex items-center">
                        <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Price Trigger System
                    </h2>
                    <div className="text-sm text-gray-400">
                        <span className="text-blue-400">http://localhost:4000/graphql</span>
                    </div>
                </div>

                <div className="flex justify-between items-center mb-4">
                    <div className="text-sm text-gray-400">
                        Connection: <span className={connectionStatus === 'connected' ? 'text-green-400' :
                            connectionStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}>
                            {connectionStatus === 'connected' ? 'Connected' :
                                connectionStatus === 'error' ? 'Error' : 'Connecting...'}
                        </span>
                    </div>
                    <div className="text-sm text-gray-400">
                        Last updated: {formatDate(lastUpdated)}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">System Status</h3>
                        <div className={`flex items-center ${connectionStatus === 'connected' ? 'text-green-400' :
                            connectionStatus === 'error' ? 'text-red-400' : 'text-yellow-400'
                            }`}>
                            <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {connectionStatus === 'connected' ? 'Active and monitoring' :
                                connectionStatus === 'error' ? 'Connection issues' : 'Establishing connection...'}
                        </div>
                    </div>

                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">Last Detected Spike</h3>
                        {latestLog ? (
                            <div className="flex items-center text-yellow-400">
                                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {formatDateTime(latestLog.timestamp || latestLog.createdAt)}
                            </div>
                        ) : (
                            <div className="text-gray-400">No spikes detected yet</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Price Trigger Logs Section */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                    <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Price Trigger Logs (Polling)
                </h2>

                {priceTriggerLogs.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        {connectionStatus === 'disconnected' ? (
                            <div className="flex flex-col items-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mb-2"></div>
                                Connecting to server...
                            </div>
                        ) : connectionStatus === 'error' ? (
                            <div className="text-red-400">Failed to load logs. Try again.</div>
                        ) : (
                            'No price detection logs found'
                        )}
                    </div>
                ) : (
                    <LogsTable
                        logs={priceTriggerLogs}
                        expandedLogId={expandedLogId}
                        toggleLogExpansion={toggleLogExpansion}
                        columns={columns}
                        renderExpandedRow={(log) => {
                            if (!isPriceDetectionLog(log)) return null;

                            let decision = null;
                            try {
                                decision = log.decision ? parseDecision(log.decision) : null;
                            } catch (e) {
                                console.error('Decision parsing error:', e);
                            }

                            return (
                                <div className="text-sm space-y-3">
                                    {/* FGI Data */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Spike Percentage:</div>
                                            <div className="text-gray-200">{log.spikePercent?.toFixed(2) ?? 'N/A'}%</div>
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Confidence:</div>
                                            <div className="text-gray-200">{log.confidence || 'medium'}</div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Token In:</div>
                                            <div className="text-gray-200">
                                                {getTokenSymbol(log.tokenIn || '')} ({log.tokenIn || 'N/A'})
                                            </div>
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Token Out:</div>
                                            <div className="text-gray-200">
                                                {getTokenSymbol(log.tokenOut || '')} ({log.tokenOut || 'N/A'})
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="font-medium text-gray-300 mb-1">Amount:</div>
                                        <div className="text-gray-200">{log.amount || '0'}</div>
                                    </div>

                                    {/* FGI Display */}
                                    {log.fgi !== undefined && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <div className="font-medium text-gray-300 mb-1">Fear & Greed Index:</div>
                                                <div className="text-gray-200">
                                                    {log.fgi} ({log.fgiClassification || 'N/A'})
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {decision && (
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">AI Decision:</div>
                                            <div className="text-gray-200 grid grid-cols-1 md:grid-cols-4 gap-2">
                                                <span className="bg-gray-800/50 p-2 rounded">
                                                    <span className="text-gray-400">Action:</span>
                                                    <span className={`ml-2 font-bold ${decision.decision?.toLowerCase() === 'buy' ? 'text-green-400' :
                                                            decision.decision?.toLowerCase() === 'sell' ? 'text-red-400' :
                                                                'text-yellow-400'
                                                        }`}>
                                                        {decision.decision?.toUpperCase() || 'N/A'}
                                                    </span>
                                                </span>
                                                <span className="bg-gray-800/50 p-2 rounded">
                                                    <span className="text-gray-400">Slippage:</span>
                                                    {decision.slippage ? `${decision.slippage}%` : 'N/A'}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <div className="font-medium text-gray-300 mb-1">Reasoning:</div>
                                        <div className="text-gray-200 bg-gray-800/50 p-3 rounded-lg">
                                            {decision?.reasoning || log.decision || "No reasoning provided"}
                                        </div>
                                    </div>

                                    <div className="pt-2 text-gray-400 text-xs">
                                        ID: {log.id || 'N/A'} | Created: {formatDateTime(log.createdAt || Date.now())} |
                                        Block: {log.eventBlockNumber || 'N/A'}
                                    </div>
                                </div>
                            );
                        }}
                    />
                )}
            </div>
        </div>
    );
}