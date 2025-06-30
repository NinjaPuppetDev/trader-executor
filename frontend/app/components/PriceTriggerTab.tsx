'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PriceDetectionLogEntry, isPriceDetectionLog } from './types';
import LogsTable from './LogsTable';

// Define connection status type
type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

interface PriceTriggerTabProps {
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    updateConnectionStatus: (status: ConnectionStatus) => void;
}

const WS_URL = process.env.NEXT_PUBLIC_PRICE_WS_URL || 'ws://127.0.0.1:8082';
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;
const HEARTBEAT_INTERVAL = 20000;
const MAX_LOG_AGE = 3600000; // 1 hour
const PROTOCOL_VERSION = 'v1.price-trigger';

export default function PriceTriggerTab({
    expandedLogId,
    toggleLogExpansion,
    updateConnectionStatus
}: PriceTriggerTabProps) {
    const [priceTriggerLogs, setPriceTriggerLogs] = useState<PriceDetectionLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(0);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
    const [latency, setLatency] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const reconnectAttempts = useRef(0);
    const websocketRef = useRef<WebSocket | null>(null);
    const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);
    const lastHeartbeat = useRef(0);
    const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
    const isMounted = useRef(true);

    // Parse decision data
    const parseDecision = useCallback((decision: string) => {
        if (!decision) return null;

        try {
            return JSON.parse(decision);
        } catch {
            try {
                const jsonMatch = decision.match(/\{[\s\S]*\}/);
                return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            } catch {
                return null;
            }
        }
    }, []);

    // Initialize WebSocket connection
    const initWebSocket = useCallback(() => {
        if (!isMounted.current) return;

        // Cleanup previous connection
        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }

        if (heartbeatTimer.current) {
            clearInterval(heartbeatTimer.current);
            heartbeatTimer.current = null;
        }

        if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
        }

        try {
            websocketRef.current = new WebSocket(WS_URL, [PROTOCOL_VERSION]);
            setConnectionStatus('connecting');
            updateConnectionStatus('connecting');
            setError(null);

            websocketRef.current.onopen = () => {
                if (!isMounted.current) return;
                console.log('✅ Connected to WebSocket server');
                setConnectionStatus('connected');
                updateConnectionStatus('connected');
                lastHeartbeat.current = Date.now();
                reconnectAttempts.current = 0;

                // Start heartbeat
                heartbeatTimer.current = setInterval(() => {
                    const now = Date.now();
                    if (websocketRef.current?.readyState === WebSocket.OPEN) {
                        websocketRef.current.send(JSON.stringify({
                            type: 'ping',
                            timestamp: now
                        }));
                    }
                }, HEARTBEAT_INTERVAL);
            };

            websocketRef.current.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    lastHeartbeat.current = Date.now();

                    switch (message.type) {
                        case 'pong':
                            setLatency(Date.now() - message.timestamp);
                            break;

                        case 'initialLogs':
                            if (Array.isArray(message.data)) {
                                setPriceTriggerLogs(message.data);
                                setLastUpdated(Date.now());
                                setIsLoading(false);
                            }
                            break;

                        case 'logUpdate':
                            setPriceTriggerLogs(prev => {
                                const withoutExisting = prev.filter(log => log.id !== message.data.id);
                                return [message.data, ...withoutExisting].slice(0, 49);
                            });
                            setLastUpdated(Date.now());
                            break;

                        case 'error':
                            console.error('Server error:', message.message);
                            setError(`Server error: ${message.message}`);
                            break;

                        default:
                            console.warn('Unknown message type:', message.type);
                    }
                } catch (parseError) {
                    console.error('Message handling error:', parseError);
                }
            };

            websocketRef.current.onerror = (event) => {
                console.error('WebSocket error:', event);
                setConnectionStatus('error');
                updateConnectionStatus('error');
                setError('WebSocket connection error');
            };

            websocketRef.current.onclose = (event) => {
                if (!isMounted.current) return;

                if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
                    const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current);
                    console.log(`♻️ Reconnecting in ${Math.round(delay / 1000)}s (${reconnectAttempts.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

                    setConnectionStatus('reconnecting');
                    updateConnectionStatus('reconnecting');
                    reconnectAttempts.current += 1;

                    reconnectTimer.current = setTimeout(() => {
                        initWebSocket();
                    }, delay);
                } else {
                    setConnectionStatus('closed');
                    updateConnectionStatus('closed');
                    setError(`Connection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
                }
            };
        } catch (err) {
            setConnectionStatus('error');
            updateConnectionStatus('error');
            setError('Failed to initialize WebSocket connection');
        }
    }, [updateConnectionStatus]);

    // Manage WebSocket lifecycle
    useEffect(() => {
        isMounted.current = true;
        initWebSocket();

        return () => {
            isMounted.current = false;
            if (websocketRef.current) websocketRef.current.close();
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        };
    }, [initWebSocket]);

    // Prune old logs periodically
    useEffect(() => {
        const pruneOldLogs = () => {
            const now = Date.now();
            setPriceTriggerLogs(prev => prev.filter(log => {
                const logTime = new Date(log.timestamp || log.createdAt).getTime();
                return now - logTime < MAX_LOG_AGE;
            }));
        };

        const pruneInterval = setInterval(pruneOldLogs, 300000);
        return () => clearInterval(pruneInterval);
    }, []);

    // Format date safely
    const formatDate = useCallback((date: Date | string | number) => {
        try {
            return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'Invalid Date';
        }
    }, []);

    // Format date and time safely
    const formatDateTime = useCallback((date: Date | string | number) => {
        try {
            return new Date(date).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return 'Invalid Date';
        }
    }, []);

    // Connection status UI
    const renderConnectionStatus = () => {
        const statusConfig = {
            connecting: { color: 'bg-yellow-500', text: 'Connecting...' },
            connected: { color: 'bg-green-500 animate-pulse', text: 'Live' },
            reconnecting: { color: 'bg-yellow-500', text: 'Reconnecting...' },
            closed: { color: 'bg-red-500', text: 'Disconnected' },
            error: { color: 'bg-red-500', text: 'Connection Error' }
        };

        const { color, text } = statusConfig[connectionStatus];

        return (
            <div className="fixed top-4 left-4 flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm z-50">
                <span className={`w-3 h-3 rounded-full ${color}`}></span>
                <span>{text}</span>
                {connectionStatus === 'connected' && latency !== null && (
                    <span className="text-gray-400 text-xs">
                        {latency > 1000 ? `${(latency / 1000).toFixed(1)}s` : `${latency}ms`}
                    </span>
                )}
                {connectionStatus === 'reconnecting' && (
                    <span className="text-gray-400 text-xs">
                        ({reconnectAttempts.current}/{MAX_RECONNECT_ATTEMPTS})
                    </span>
                )}
            </div>
        );
    };

    if (error) {
        return (
            <div className="p-6 bg-red-900/20 rounded-lg border border-red-800/50">
                <h2 className="text-xl font-bold text-red-400 mb-2">
                    {connectionStatus === 'error' ? 'Connection Failed' : 'System Error'}
                </h2>

                <div className="mb-4 p-3 bg-red-900/30 rounded">
                    <code className="text-red-300 break-all">{error}</code>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <h3 className="font-medium text-red-300 mb-1">Connection Details</h3>
                        <p className="text-red-200">
                            URL: {WS_URL}<br />
                            Protocol: {PROTOCOL_VERSION}<br />
                            Status: {connectionStatus}<br />
                            Attempts: {reconnectAttempts.current}/{MAX_RECONNECT_ATTEMPTS}
                        </p>
                    </div>

                    <div>
                        <h3 className="font-medium text-red-300 mb-1">Troubleshooting</h3>
                        <ul className="text-red-200 text-sm list-disc pl-5">
                            <li>Check backend WebSocket server status</li>
                            <li>Verify the server is running at: {WS_URL}</li>
                            <li>Refresh the page to reconnect</li>
                        </ul>
                    </div>
                </div>

                <button
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2"
                    onClick={() => window.location.reload()}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                    </svg>
                    Reload Application
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {renderConnectionStatus()}

            {isLoading && (
                <div className="fixed top-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Connecting to server...
                </div>
            )}

            {/* System Status Section */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">📈 Price Trigger System</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">System Status</h3>
                        <div className={`flex items-center ${connectionStatus === 'connected' ? 'text-green-400' : 'text-yellow-400'}`}>
                            <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {connectionStatus === 'connected' ? 'Active and monitoring' : 'Connection issues'}
                        </div>
                    </div>

                    <div className="bg-gray-800/30 p-4 rounded-lg border border-gray-700">
                        <h3 className="font-medium text-gray-300 mb-2">Last Detected Spike</h3>
                        {priceTriggerLogs.length > 0 && priceTriggerLogs[0]?.timestamp ? (
                            <div className="flex items-center text-yellow-400">
                                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {formatDateTime(priceTriggerLogs[0].timestamp)}
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
                    Price Trigger Logs (Real-time)
                </h2>

                <div className="text-sm text-gray-400 mb-4">
                    Last updated: {formatDate(lastUpdated)}
                    {connectionStatus === 'reconnecting' && (
                        <span className="ml-2 text-yellow-400">
                            • Attempting reconnect ({reconnectAttempts.current}/{MAX_RECONNECT_ATTEMPTS})
                        </span>
                    )}
                </div>

                {priceTriggerLogs.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        {isLoading ? 'Loading logs...' : 'No price detection logs found'}
                    </div>
                ) : (
                    <LogsTable
                        logs={priceTriggerLogs}
                        expandedLogId={expandedLogId}
                        toggleLogExpansion={toggleLogExpansion}
                        columns={[
                            {
                                header: "Time",
                                accessor: (log) => formatDate(log.timestamp || log.createdAt)
                            },
                            {
                                header: "Spike %",
                                accessor: (log) => {
                                    if (!isPriceDetectionLog(log)) return null;
                                    return (
                                        <span className={`font-bold ${(log.spikePercent || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {log.spikePercent?.toFixed(2)}%
                                        </span>
                                    );
                                }
                            },
                            {
                                header: "Price Context",
                                accessor: (log) => {
                                    if (!isPriceDetectionLog(log)) return null;
                                    return (
                                        <span className="max-w-[120px] truncate" title={log.priceContext}>
                                            {log.priceContext?.substring(0, 30)}...
                                        </span>
                                    );
                                }
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
                                header: "Event Tx",
                                accessor: (log) => {
                                    if (!isPriceDetectionLog(log)) return <span className="text-gray-500">-</span>;
                                    return log.eventTxHash ? (
                                        <a
                                            href={`https://localhost/explorer/tx/${log.eventTxHash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-400 hover:text-blue-300"
                                        >
                                            {log.eventTxHash.slice(0, 6)}...{log.eventTxHash.slice(-4)}
                                        </a>
                                    ) : <span className="text-gray-500">-</span>;
                                }
                            }
                        ]}
                        renderExpandedRow={(log) => {
                            if (!isPriceDetectionLog(log)) return null;

                            const decision = log.decision ? parseDecision(log.decision) : null;

                            return (
                                <div className="text-sm space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Price Context:</div>
                                            <div className="text-gray-200">{log.priceContext}</div>
                                        </div>

                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Spike Percentage:</div>
                                            <div className="text-gray-200">{log.spikePercent?.toFixed(2)}%</div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">FGI Index:</div>
                                            <div className="text-gray-200">
                                                {log.fgi} {log.fgiClassification && `(${log.fgiClassification})`}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Decision Length:</div>
                                            <div className="text-gray-200">{log.decision?.length || 0} chars</div>
                                        </div>
                                    </div>

                                    {decision && (
                                        <>
                                            <div>
                                                <div className="font-medium text-gray-300 mb-1">AI Decision:</div>
                                                <div className="text-gray-200 grid grid-cols-1 md:grid-cols-4 gap-2">
                                                    <span className="bg-gray-800/50 p-2 rounded">
                                                        <span className="text-gray-400">Action:</span>
                                                        <span className={`ml-2 font-bold ${decision.decision === 'buy' ? 'text-green-400' :
                                                            decision.decision === 'sell' ? 'text-red-400' : 'text-yellow-400'
                                                            }`}>
                                                            {decision.decision?.toUpperCase()}
                                                        </span>
                                                    </span>
                                                    <span className="bg-gray-800/50 p-2 rounded">
                                                        <span className="text-gray-400">Amount:</span> {decision.amount}
                                                    </span>
                                                    <span className="bg-gray-800/50 p-2 rounded">
                                                        <span className="text-gray-400">Slippage:</span> {decision.slippage}%
                                                    </span>
                                                    <span className="bg-gray-800/50 p-2 rounded">
                                                        <span className="text-gray-400">Tokens:</span>
                                                        <div className="truncate">
                                                            {log.tokenIn || decision.tokenIn} → {log.tokenOut || decision.tokenOut}
                                                        </div>
                                                    </span>
                                                </div>
                                            </div>

                                            <div>
                                                <div className="font-medium text-gray-300 mb-1">Reasoning:</div>
                                                <div className="text-gray-200 bg-gray-800/50 p-3 rounded-lg">
                                                    {log.reasoning || decision.reasoning || "No reasoning provided"}
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {decision?.error && (
                                        <div className="bg-red-900/20 p-3 rounded-lg">
                                            <div className="font-medium text-red-300 mb-1">System Alert:</div>
                                            <div className="text-red-400">{decision.errorMessage}</div>
                                        </div>
                                    )}

                                    {log.txHash && (
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Execution Tx:</div>
                                            <a
                                                href={`https://localhost/explorer/tx/${log.txHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-purple-400 hover:text-purple-300"
                                            >
                                                {log.txHash}
                                            </a>
                                        </div>
                                    )}

                                    {log.error && (
                                        <div>
                                            <div className="font-medium text-gray-300 mb-1">Error:</div>
                                            <div className="text-red-400 bg-red-900/20 p-2 rounded">
                                                {log.error}
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-2 text-gray-400 text-xs">
                                        ID: {log.id} | Created: {formatDateTime(log.createdAt)} |
                                        Block: {log.blockNumber || 'N/A'}
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