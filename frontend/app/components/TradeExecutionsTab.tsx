'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { TradeExecutionLog } from "./types";
import { ethers } from "ethers";

type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

interface TradeExecutionsTabProps {
    initialLogs: TradeExecutionLog[];
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    updateConnectionStatus: (status: ConnectionStatus) => void;
}

const TRADE_WS_URL = process.env.NEXT_PUBLIC_TRADE_WS_URL || 'ws://127.0.0.1:8081';
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 3000;
const HEARTBEAT_INTERVAL = 20000;
const HEARTBEAT_TIMEOUT = HEARTBEAT_INTERVAL * 2;

const TOKEN_ADDRESSES = {
    STABLE: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    VOLATILE: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};

const STATUS_CONFIG = {
    executed: { text: 'Executed', color: 'bg-green-500', className: 'text-green-400' },
    skipped: { text: 'Skipped', color: 'bg-yellow-500', className: 'text-yellow-400' },
    pending: { text: 'Pending', color: 'bg-yellow-500', className: 'text-yellow-400' },
    failed: { text: 'Failed', color: 'bg-red-500', className: 'text-red-400' },
    default: { text: 'Unknown', color: 'bg-gray-500', className: 'text-gray-400' },
};

const CONNECTION_STATUS_CONFIG = {
    connecting: { color: 'bg-yellow-500', text: 'Connecting...' },
    connected: { color: 'bg-green-500 animate-pulse', text: 'Live' },
    reconnecting: { color: 'bg-yellow-500', text: 'Reconnecting...' },
    closed: { color: 'bg-red-500', text: 'Disconnected' },
    error: { color: 'bg-red-500', text: 'Error' },
    default: { color: 'bg-gray-500', text: 'Unknown' },
};

const formatUTCTime = (dateInput: string | number | Date): string => {
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

export default function TradeExecutionsTab({
    initialLogs,
    expandedLogId,
    toggleLogExpansion,
    updateConnectionStatus
}: TradeExecutionsTabProps) {
    const [logs, setLogs] = useState<TradeExecutionLog[]>(Array.isArray(initialLogs) ? initialLogs : []);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
    const [lastUpdated, setLastUpdated] = useState(0);
    const reconnectAttempts = useRef(0);
    const websocketRef = useRef<WebSocket | null>(null);
    const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);
    const lastHeartbeat = useRef(Date.now());
    const isMountedRef = useRef(true);

    const getTokenSymbol = useCallback((address: string): string => {
        if (!address) return '';
        const addrLower = address.toLowerCase();
        if (addrLower === TOKEN_ADDRESSES.STABLE.toLowerCase()) return 'STABLE';
        if (addrLower === TOKEN_ADDRESSES.VOLATILE.toLowerCase()) return 'VOLATILE';
        return 'UNKNOWN';
    }, []);

    const formatAmount = useCallback((amount: string, decimals: number = 18): string => {
        if (!amount || amount === '0') return '0.0000';
        try {
            return parseFloat(ethers.utils.formatUnits(amount, decimals)).toFixed(4);
        } catch {
            return amount;
        }
    }, []);

    const getStatusProperties = useCallback((status: string) => {
        return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.default;
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        let reconnectTimeout: NodeJS.Timeout | null = null;

        const connectWebSocket = () => {
            if (websocketRef.current?.readyState === WebSocket.OPEN ||
                websocketRef.current?.readyState === WebSocket.CONNECTING) {
                return;
            }

            console.log(`🔌 Connecting to WebSocket: ${TRADE_WS_URL}`);
            websocketRef.current = new WebSocket(TRADE_WS_URL, ['v1.trade-executor']);
            setConnectionStatus('connecting');
            updateConnectionStatus('connecting');

            websocketRef.current.onopen = () => {
                if (!isMountedRef.current) return;
                console.log('✅ WebSocket connected');
                setConnectionStatus('connected');
                updateConnectionStatus('connected');
                reconnectAttempts.current = 0;
                lastHeartbeat.current = Date.now();

                // Start heartbeat
                heartbeatTimer.current = setInterval(() => {
                    if (websocketRef.current?.readyState === WebSocket.OPEN) {
                        websocketRef.current.send(JSON.stringify({ type: 'ping' }));
                    }
                }, HEARTBEAT_INTERVAL);
            };

            websocketRef.current.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    lastHeartbeat.current = Date.now();

                    if (message.type === 'pong') {
                        return;
                    }

                    if (message.type === 'tradeExecution' && message.data) {
                        const logData = message.data;
                        if (!logData.createdAt) {
                            logData.createdAt = new Date().toISOString();
                        }

                        setLogs(prev => [logData, ...prev.slice(0, 49)]);
                        setLastUpdated(Date.now());
                    } else if (message.type === 'initialTrades' && Array.isArray(message.data)) {
                        setLogs(message.data);
                    }
                } catch (error) {
                    console.error('Error parsing message:', event.data);
                }
            };

            websocketRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            websocketRef.current.onclose = (event) => {
                if (!isMountedRef.current) return;

                if (heartbeatTimer.current) {
                    clearInterval(heartbeatTimer.current);
                    heartbeatTimer.current = null;
                }

                if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
                    const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts.current);
                    console.log(`♻️ Reconnecting in ${Math.round(delay / 1000)}s (${reconnectAttempts.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

                    setConnectionStatus('reconnecting');
                    updateConnectionStatus('reconnecting');
                    reconnectAttempts.current++;

                    reconnectTimeout = setTimeout(() => {
                        connectWebSocket();
                    }, delay);
                } else {
                    console.error('❌ Max reconnection attempts reached');
                    setConnectionStatus('closed');
                    updateConnectionStatus('closed');
                }
            };
        };

        connectWebSocket();

        // Heartbeat checker
        const heartbeatCheck = setInterval(() => {
            if (Date.now() - lastHeartbeat.current > HEARTBEAT_TIMEOUT) {
                console.warn('⌛ Heartbeat timeout, reconnecting...');
                if (websocketRef.current) {
                    websocketRef.current.close();
                }
            }
        }, HEARTBEAT_TIMEOUT);

        return () => {
            isMountedRef.current = false;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
            clearInterval(heartbeatCheck);
            if (websocketRef.current) websocketRef.current.close();
        };
    }, [updateConnectionStatus]);

    const renderConnectionStatus = () => {
        const { color, text } = CONNECTION_STATUS_CONFIG[connectionStatus] || CONNECTION_STATUS_CONFIG.default;

        return (
            <div className="fixed top-4 left-4 flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm z-50">
                <span className={`w-3 h-3 rounded-full ${color}`}></span>
                <span>{text}</span>
                {connectionStatus === 'reconnecting' && (
                    <span className="text-gray-400 text-xs">
                        ({reconnectAttempts.current}/{MAX_RECONNECT_ATTEMPTS})
                    </span>
                )}
            </div>
        );
    };

    const [sortConfig, setSortConfig] = useState<{
        key: keyof TradeExecutionLog;
        direction: 'asc' | 'desc'
    }>({
        key: 'createdAt',
        direction: 'desc'
    });

    const sortedLogs = useMemo(() => {
        return [...logs].sort((a, b) => {
            const aValue = a[sortConfig.key] || '';
            const bValue = b[sortConfig.key] || '';

            if (sortConfig.key === 'createdAt') {
                const dateA = new Date(aValue).getTime();
                const dateB = new Date(bValue).getTime();
                return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
            }

            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
            }

            return sortConfig.direction === 'asc'
                ? String(aValue).localeCompare(String(bValue))
                : String(bValue).localeCompare(String(aValue));
        });
    }, [logs, sortConfig]);

    const requestSort = useCallback((key: keyof TradeExecutionLog) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    }, []);

    return (
        <div className="bg-gray-800 rounded-lg p-4 shadow-lg">
            {renderConnectionStatus()}

            <div className="mb-4 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold">Trade Execution History</h2>
                    <div className="text-sm text-gray-400 flex items-center mt-1">
                        <span className="flex items-center mr-4">
                            <span className={`h-2 w-2 rounded-full mr-1 ${connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                            WebSocket: {CONNECTION_STATUS_CONFIG[connectionStatus]?.text} | {TRADE_WS_URL}
                        </span>
                        {lastUpdated > 0 && (
                            <span>Updated: {formatUTCTime(lastUpdated)}</span>
                        )}
                    </div>
                </div>
                <div className="text-sm text-gray-400">
                    Showing {sortedLogs.length} executions
                </div>
            </div>

            {sortedLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                    {connectionStatus === 'connected' ? 'Waiting for trades...' : 'No trade executions found'}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-750">
                            <tr>
                                <th
                                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer"
                                    onClick={() => requestSort('createdAt')}
                                >
                                    <div className="flex items-center">
                                        Timestamp
                                        {sortConfig.key === 'createdAt' && (
                                            <span className="ml-1">
                                                {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                            </span>
                                        )}
                                    </div>
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Pair
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Amount
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Details
                                </th>
                            </tr>
                        </thead>

                        <tbody className="bg-gray-800 divide-y divide-gray-700">
                            {sortedLogs.map((log) => {
                                const statusProps = getStatusProperties(log.status || 'unknown');
                                const tokenInDecimals = log.tokenInDecimals || 18;
                                const tokenOutDecimals = log.tokenOutDecimals || 18;

                                return (
                                    <tr key={log.id} className="hover:bg-gray-750 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">
                                            {formatUTCTime(log.createdAt)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                                            <div className="flex items-center">
                                                <span className="text-gray-300">
                                                    {getTokenSymbol(log.tokenIn)}
                                                </span>
                                                <span className="mx-1 text-gray-500">→</span>
                                                <span className="text-gray-300">
                                                    {getTokenSymbol(log.tokenOut)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">
                                            <div className="flex flex-col">
                                                <span>In: {formatAmount(log.amountIn, tokenInDecimals)}</span>
                                                {log.actualAmountOut && (
                                                    <span>Out: {formatAmount(log.actualAmountOut, tokenOutDecimals)}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <span className={`inline-block w-3 h-3 rounded-full ${statusProps.color}`}></span>
                                                <span className={`ml-2 text-sm ${statusProps.className}`}>
                                                    {statusProps.text}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                                            <button
                                                onClick={() => toggleLogExpansion(log.id)}
                                                className="text-purple-400 hover:text-purple-300 transition-colors"
                                            >
                                                {expandedLogId === log.id ? 'Hide' : 'Show'} Details
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Expanded log details */}
                    {sortedLogs.map((log) => {
                        if (expandedLogId !== log.id) return null;
                        const statusProps = getStatusProperties(log.status || 'unknown');

                        return (
                            <div key={`detail-${log.id}`} className="mt-4 p-4 bg-gray-750 rounded-lg">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <h3 className="font-bold text-gray-300 mb-2">Transaction Details</h3>
                                        <div className="space-y-1 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Status:</span>
                                                <span className="text-gray-300">
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
                                                        className="text-purple-400 hover:underline break-all ml-2"
                                                    >
                                                        {log.txHash.slice(0, 12)}...{log.txHash.slice(-10)}
                                                    </a>
                                                </div>
                                            )}
                                            {log.blockNumber && (
                                                <div className="flex justify-between">
                                                    <span className="text-gray-400">Block:</span>
                                                    <span className="text-gray-300">{log.blockNumber}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="font-bold text-gray-300 mb-2">Trade Parameters</h3>
                                        <div className="space-y-1 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Token In:</span>
                                                <span className="text-gray-300">
                                                    {getTokenSymbol(log.tokenIn)} ({log.tokenIn?.slice(0, 8)}...)
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Token Out:</span>
                                                <span className="text-gray-300">
                                                    {getTokenSymbol(log.tokenOut)} ({log.tokenOut?.slice(0, 8)}...)
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-gray-400">Amount In:</span>
                                                <span className="text-gray-300">
                                                    {formatAmount(log.amountIn, log.tokenInDecimals)}
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

                                <div className="mt-4">
                                    <button
                                        onClick={() => toggleLogExpansion(log.id)}
                                        className="text-sm text-gray-400 hover:text-gray-300"
                                    >
                                        Close Details
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}