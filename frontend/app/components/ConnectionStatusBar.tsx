'use client';
import { useState, useEffect, useCallback } from 'react';

export type ServiceStatus = 'connected' | 'connecting' | 'error' | 'disconnected';

interface ServiceConfig {
    name: string;
    serviceKey: string;
    status: ServiceStatus;
    healthUrl: string;
    details?: Record<string, any>;
}

const SERVICE_PORTS = {
    GATEWAY: 4000,
    TRADE_EXECUTOR: 3001,
    PRICE_TRIGGER: 3002
};

const HEALTH_ENDPOINTS = {
    GATEWAY: `http://localhost:${SERVICE_PORTS.GATEWAY}/health`,
    TRADE_EXECUTOR: `http://localhost:${SERVICE_PORTS.TRADE_EXECUTOR}/health`,
    PRICE_TRIGGER: `http://localhost:${SERVICE_PORTS.PRICE_TRIGGER}/health`
};

const BASE_SERVICES: ServiceConfig[] = [
    {
        name: 'GraphQL Gateway',
        serviceKey: 'graphql-gateway',
        status: 'connecting',
        healthUrl: HEALTH_ENDPOINTS.GATEWAY
    },
    {
        name: 'Trade Executor',
        serviceKey: 'tradeExecutor',
        status: 'connecting',
        healthUrl: HEALTH_ENDPOINTS.TRADE_EXECUTOR
    },
    {
        name: 'Price Trigger',
        serviceKey: 'priceTrigger',
        status: 'connecting',
        healthUrl: HEALTH_ENDPOINTS.PRICE_TRIGGER
    }
];

export default function ConnectionStatusBar() {
    const [services, setServices] = useState<ServiceConfig[]>(BASE_SERVICES);
    const [lastChecked, setLastChecked] = useState<string>('');
    const [isChecking, setIsChecking] = useState(false);
    const [systemStatus, setSystemStatus] = useState<string>('Initializing...');
    const [checkCounter, setCheckCounter] = useState(0); // For refresh tracking


    const getStatusProperties = (status: ServiceStatus) => {
        switch (status) {
            case 'connected': return {
                color: 'bg-green-500',
                text: 'Connected',
                icon: '🟢'
            };
            case 'connecting': return {
                color: 'bg-yellow-500 animate-pulse',
                text: 'Connecting...',
                icon: '🟡'
            };
            case 'error': return {
                color: 'bg-red-500',
                text: 'Connection Error',
                icon: '🔴'
            };
            case 'disconnected': return {
                color: 'bg-gray-500',
                text: 'Disconnected',
                icon: '⚪'
            };
            default: return {
                color: 'bg-gray-500',
                text: 'Unknown',
                icon: '❓'
            };
        }
    };

    const performHealthCheck = useCallback(async () => {

        setIsChecking(true);
        const now = new Date();
        setLastChecked(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

        try {
            const updatedServices = await Promise.all(
                services.map(async (service) => {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 2500);

                        const response = await fetch(service.healthUrl, {
                            cache: 'no-store',
                            headers: { 'Cache-Control': 'no-cache' },
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }

                        const healthData = await response.json();

                        // Fix: Explicitly type status as ServiceStatus
                        const status: ServiceStatus = healthData.status === 'ok'
                            ? 'connected'
                            : 'error';

                        return {
                            ...service,
                            status,
                            details: healthData
                        };
                    } catch (error) {
                        // Fix: Explicitly type status as ServiceStatus
                        return {
                            ...service,
                            status: 'disconnected' as ServiceStatus,
                            details: { error: error instanceof Error ? error.message : 'Unknown error' }
                        };
                    }
                })
            );

            setServices(updatedServices);
        } catch (error) {
            console.error('Health check failed:', error);
        } finally {
            setIsChecking(true);
            setCheckCounter(prev => prev + 1);
        }
    }, [services]);

    useEffect(() => {
        // Calculate system status whenever services change
        const allConnected = services.every(s => s.status === 'connected');
        const anyError = services.some(s => s.status === 'error');
        const anyDisconnected = services.some(s => s.status === 'disconnected');
        const anyConnecting = services.some(s => s.status === 'connecting');

        setSystemStatus(
            allConnected ? 'Operational' :
                anyError ? 'Degraded' :
                    anyDisconnected ? 'Partially Connected' :
                        anyConnecting ? 'Connecting...' : 'Unknown'
        );
    }, [services, checkCounter]);

    useEffect(() => {
        // Initial health check
        performHealthCheck();

        // Set up periodic health checks
        const interval = setInterval(performHealthCheck, 10000);
        return () => clearInterval(interval);
    }, [performHealthCheck]);

    const recheckStatus = () => {
        if (!isChecking) {
            // Reset all services to connecting state for visual feedback
            setServices(prev =>
                prev.map(s => ({ ...s, status: 'connecting' }))
            );
            performHealthCheck();
        }
    };

    // Calculate status colors
    const systemStatusColor = systemStatus === 'Operational'
        ? 'bg-green-500'
        : systemStatus === 'Degraded'
            ? 'bg-red-500'
            : systemStatus === 'Partially Connected'
                ? 'bg-yellow-500'
                : 'bg-blue-500 animate-pulse';

    const systemStatusTextColor = systemStatus === 'Operational'
        ? 'text-green-400'
        : systemStatus === 'Degraded'
            ? 'text-red-400'
            : systemStatus === 'Partially Connected'
                ? 'text-yellow-400'
                : 'text-blue-400';

    return (
        <div className="mb-6 p-4 bg-gray-800 rounded-xl border border-gray-700">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div className="flex items-center mb-3 sm:mb-0">
                    <div className="mr-3">
                        <div className={`w-4 h-4 rounded-full ${systemStatusColor}`}></div>
                    </div>
                    <div>
                        <h3 className="font-medium text-gray-300">Service Connections</h3>
                        <div className="text-xs text-gray-500 mt-1">
                            System Status: <span className={systemStatusTextColor}>
                                {systemStatus}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="text-xs text-gray-500">
                    Last checked: {lastChecked || 'Never'}
                </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {services.map((service, index) => {
                    const statusProps = getStatusProperties(service.status);
                    const isGateway = service.serviceKey === 'graphql-gateway';
                    const isError = service.status === 'error' || service.status === 'disconnected';

                    return (
                        <div
                            key={index}
                            className={`p-3 rounded-lg flex items-center transition-all ${service.status === 'connected' ? 'bg-gray-900' :
                                service.status === 'error' ? 'bg-red-900/20' :
                                    service.status === 'disconnected' ? 'bg-gray-900/50' : 'bg-yellow-900/20'
                                }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center mb-1">
                                    <div className="mr-2">
                                        {statusProps.icon}
                                    </div>
                                    <span className="font-medium text-gray-200 truncate">
                                        {service.name}
                                    </span>
                                </div>
                                <div className="text-xs text-gray-500 truncate">
                                    {service.healthUrl.replace('http://', '')}
                                </div>

                                {/* Additional health details */}
                                {service.details && (
                                    <div className="mt-1 text-xs">
                                        {isGateway && (
                                            <>
                                                <span className="text-gray-500">DB: </span>
                                                <span className={
                                                    service.details.database === 'connected'
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                }>
                                                    {service.details.database || 'unknown'}
                                                </span>
                                                <span className="mx-2">|</span>
                                            </>
                                        )}
                                        <span className="text-gray-500">Status: </span>
                                        <span className={isError ? 'text-red-400' : 'text-green-400'}>
                                            {service.details.status || service.status}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className={`ml-2 text-sm font-medium ${service.status === 'connected' ? 'text-green-400' :
                                service.status === 'error' ? 'text-red-400' :
                                    service.status === 'disconnected' ? 'text-gray-400' : 'text-yellow-400'
                                }`}>
                                {statusProps.text}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-4 flex justify-between items-center">
                <div className="text-xs text-gray-500">
                    {systemStatus === 'Operational' ? (
                        <span className="text-green-400">All systems operational</span>
                    ) : systemStatus === 'Degraded' ? (
                        <span className="text-red-400">Critical services unavailable</span>
                    ) : systemStatus === 'Partially Connected' ? (
                        <span className="text-yellow-400">Partial connectivity</span>
                    ) : (
                        <span className="text-blue-400">Establishing connections...</span>
                    )}
                </div>
                <button
                    onClick={recheckStatus}
                    disabled={isChecking}
                    className={`text-xs px-3 py-1 rounded transition-colors flex items-center ${isChecking
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                        }`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {isChecking ? 'Checking...' : 'Recheck Status'}
                </button>
            </div>
        </div>
    );
}