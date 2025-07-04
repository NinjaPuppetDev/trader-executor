'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

export type ServiceStatus = 'connected' | 'connecting' | 'error' | 'disconnected';

interface ServiceConfig {
    name: string;
    serviceKey: string;
    status: ServiceStatus;
    healthUrl: string;
    details?: Record<string, any>; // For additional health info
}

// Shared configuration for service endpoints
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
        status: 'disconnected',
        healthUrl: HEALTH_ENDPOINTS.GATEWAY
    },
    {
        name: 'Trade Executor',
        serviceKey: 'tradeExecutor',
        status: 'disconnected',
        healthUrl: HEALTH_ENDPOINTS.TRADE_EXECUTOR
    },
    {
        name: 'Price Trigger',
        serviceKey: 'priceTrigger',
        status: 'disconnected',
        healthUrl: HEALTH_ENDPOINTS.PRICE_TRIGGER
    }
];

export default function ConnectionStatusBar() {
    const [services, setServices] = useState<ServiceConfig[]>(BASE_SERVICES);
    const [lastChecked, setLastChecked] = useState<string>('');
    const servicesRef = useRef(BASE_SERVICES);
    const abortControllers = useRef<Map<string, AbortController>>(new Map());
    const isMounted = useRef(false);

    // Sync ref with current services
    useEffect(() => {
        isMounted.current = true;
        servicesRef.current = services;
        return () => {
            isMounted.current = false;
        };
    }, [services]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            abortControllers.current.forEach(controller => controller.abort());
        };
    }, []);

    const performHealthCheck = useCallback(async () => {
        if (!isMounted.current) return;

        const now = new Date();
        setLastChecked(now.toLocaleTimeString());

        const updatedServices = await Promise.all(
            servicesRef.current.map(async (service) => {
                const controller = new AbortController();
                abortControllers.current.set(service.serviceKey, controller);
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

                try {
                    // Update status to connecting
                    setServices(prev => prev.map(s =>
                        s.serviceKey === service.serviceKey
                            ? { ...s, status: 'connecting' }
                            : s
                    ));

                    const response = await fetch(service.healthUrl, {
                        cache: 'no-store',
                        headers: { 'Cache-Control': 'no-cache' },
                        signal: controller.signal
                    });

                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    const healthData = await response.json();

                    return {
                        ...service,
                        status: (healthData.status === 'ok'
                            ? 'connected'
                            : 'error') as ServiceStatus,
                        details: healthData
                    };
                } catch (error) {
                    const err = error as any;
                    return {
                        ...service,
                        status: ((err instanceof TypeError || err.name === 'AbortError')
                            ? 'disconnected'
                            : 'error') as ServiceStatus
                    };
                } finally {
                    clearTimeout(timeoutId);
                    abortControllers.current.delete(service.serviceKey);
                }
            })
        );

        if (isMounted.current) {
            setServices(updatedServices);
        }
    }, []);

    useEffect(() => {
        performHealthCheck();
        const interval = setInterval(performHealthCheck, 5000);
        return () => {
            clearInterval(interval);
            abortControllers.current.forEach(controller => controller.abort());
        };
    }, [performHealthCheck]);

    const recheckStatus = useCallback(() => {
        abortControllers.current.forEach(controller => controller.abort());
        abortControllers.current.clear();
        performHealthCheck();
    }, [performHealthCheck]);

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

    // Calculate overall system status
    const allConnected = services.every(s => s.status === 'connected');
    const anyError = services.some(s => s.status === 'error');
    const anyDisconnected = services.some(s => s.status === 'disconnected');

    const systemStatus = allConnected
        ? 'Operational'
        : anyError
            ? 'Degraded'
            : anyDisconnected
                ? 'Partially Connected'
                : 'Connecting...';

    return (
        <div className="mb-6 p-4 bg-gray-800 rounded-xl border border-gray-700">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div className="flex items-center mb-3 sm:mb-0">
                    <div className="mr-3">
                        <div className={`w-4 h-4 rounded-full ${allConnected ? 'bg-green-500' :
                                anyError ? 'bg-red-500 animate-pulse' :
                                    anyDisconnected ? 'bg-yellow-500' : 'bg-gray-500'
                            }`}></div>
                    </div>
                    <div>
                        <h3 className="font-medium text-gray-300">Service Connections</h3>
                        <div className="text-xs text-gray-500 mt-1">
                            System Status: <span className={
                                allConnected ? 'text-green-400' :
                                    anyError ? 'text-red-400' :
                                        anyDisconnected ? 'text-yellow-400' : 'text-gray-400'
                            }>
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

                                {/* Additional health details for Gateway */}
                                {isGateway && service.details && (
                                    <div className="mt-1 text-xs">
                                        <span className="text-gray-500">DB: </span>
                                        <span className={
                                            service.details.database === 'connected'
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                        }>
                                            {service.details.database}
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
                    {allConnected ? (
                        <span className="text-green-400">All systems operational</span>
                    ) : anyError ? (
                        <span className="text-red-400">Some services unavailable</span>
                    ) : anyDisconnected ? (
                        <span className="text-yellow-400">Partial connectivity</span>
                    ) : (
                        <span className="text-yellow-400">Establishing connections...</span>
                    )}
                </div>
                <button
                    onClick={recheckStatus}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded transition-colors flex items-center"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Recheck Status
                </button>
            </div>
        </div>
    );
}