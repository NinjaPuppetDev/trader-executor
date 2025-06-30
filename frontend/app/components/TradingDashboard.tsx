'use client';
import { useState, useCallback } from "react";
import VeniceTraderTab from "./VeniceTraderTab";
import PriceTriggerTab from "./PriceTriggerTab";
import TradeExecutionsTab from "./TradeExecutionsTab";
import ConnectionStatusBar from "./ConnectionStatusBar";

export default function TradingDashboard() {
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [connectionStatus, setConnectionStatus] = useState({
        venice: 'connecting',
        priceTrigger: 'connecting',
        tradeExecutor: 'connecting'
    });
    const [activeTab, setActiveTab] = useState('venice'); // State for active tab

    const toggleLogExpansion = useCallback((id: string) => {
        setExpandedLogId(prev => prev === id ? null : id);
    }, []);

    const updateConnectionStatus = useCallback((service: 'venice' | 'priceTrigger' | 'tradeExecutor', status: string) => {
        setConnectionStatus(prev => ({
            ...prev,
            [service]: status
        }));
    }, []);

    // Tab configuration with emoji icons
    const tabs = [
        {
            id: 'venice',
            label: 'Venice AI',
            icon: '⚡', // Lightning bolt emoji
            component: (
                <VeniceTraderTab
                    expandedLogId={expandedLogId}
                    toggleLogExpansion={toggleLogExpansion}
                    updateConnectionStatus={(status) => updateConnectionStatus('venice', status)} prompt={""} setPrompt={function (value: string): void {
                        throw new Error("Function not implemented.");
                    }} response={""} loading={false} lastVeniceTrigger={null} logs={[]} tradeExecutions={[]} loadingLogs={false} sendPrompt={function (): void {
                        throw new Error("Function not implemented.");
                    }} formatDecision={function (decision: string): string {
                        throw new Error("Function not implemented.");
                    }} />
            )
        },
        {
            id: 'price-trigger',
            label: 'Price Triggers',
            icon: '📊', // Chart emoji
            component: (
                <PriceTriggerTab
                    expandedLogId={expandedLogId}
                    toggleLogExpansion={toggleLogExpansion}
                    updateConnectionStatus={(status) => updateConnectionStatus('priceTrigger', status)}
                />
            )
        },
        {
            id: 'executions',
            label: 'Trade Executions',
            icon: '🔄', // Refresh/swap emoji
            component: (
                <TradeExecutionsTab
                    expandedLogId={expandedLogId}
                    toggleLogExpansion={toggleLogExpansion}
                    updateConnectionStatus={(status) => updateConnectionStatus('tradeExecutor', status)} initialLogs={[]} />
            )
        }
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-gray-100 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-10">
                    <div className="flex justify-center mb-4">
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-700 p-2 rounded-lg">
                            <div className="bg-gray-900 rounded-md p-4">
                                <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-300">
                                    Trading Automation Dashboard
                                </h1>
                            </div>
                        </div>
                    </div>
                    <p className="text-gray-400 max-w-2xl mx-auto">
                        AI-powered trading with real-time market triggers and execution monitoring
                    </p>
                </div>

                {/* Connection Status Bar */}
                <ConnectionStatusBar status={connectionStatus} />

                {/* Custom Tab Implementation */}
                <div className="mb-6">
                    {/* Tab Navigation */}
                    <div className="flex space-x-1 rounded-xl bg-gray-800 p-1">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center justify-center py-3 px-4 text-sm font-medium rounded-lg transition-all duration-200 ${activeTab === tab.id
                                    ? 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white shadow-lg'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                            >
                                <span className="mr-2 text-lg">{tab.icon}</span>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    <div className="mt-4">
                        {tabs.map((tab) => (
                            <div
                                key={tab.id}
                                className={activeTab === tab.id ? 'block' : 'hidden'}
                            >
                                {tab.component}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Live Status Footer */}
                <div className="mt-8 pt-6 border-t border-gray-800">
                    <div className="flex flex-col md:flex-row justify-between items-center">
                        <div className="flex items-center text-sm text-gray-500 mb-4 md:mb-0">
                            <div className="flex items-center mr-6">
                                <div className="w-3 h-3 rounded-full bg-green-500 mr-2 animate-pulse"></div>
                                <span>Real-time data</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div>
                                <span>Reconnecting</span>
                            </div>
                        </div>

                        <div className="flex space-x-4">
                            <button className="text-sm text-gray-400 hover:text-gray-300">
                                Documentation
                            </button>
                            <button className="text-sm text-gray-400 hover:text-gray-300">
                                Settings
                            </button>
                            <button className="text-sm text-gray-400 hover:text-gray-300">
                                Support
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}