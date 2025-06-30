import React from 'react';

interface ConnectionStatusBarProps {
    status: {
        venice: string;
        priceTrigger: string;
        tradeExecutor: string;
    };
}

const ConnectionStatusBar: React.FC<ConnectionStatusBarProps> = ({ status }) => {
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'connected': return 'bg-green-500';
            case 'connecting': return 'bg-yellow-500';
            case 'reconnecting': return 'bg-yellow-500';
            default: return 'bg-red-500';
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'connected': return 'Live';
            case 'connecting': return 'Connecting...';
            case 'reconnecting': return 'Reconnecting...';
            default: return 'Disconnected';
        }
    };

    return (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center p-3 bg-gray-800 rounded-lg">
                <div className={`w-3 h-3 rounded-full mr-2 ${getStatusColor(status.venice)}`}></div>
                <div>
                    <div className="text-sm font-medium">Venice AI</div>
                    <div className="text-xs text-gray-400">{getStatusText(status.venice)}</div>
                </div>
            </div>
            
            <div className="flex items-center p-3 bg-gray-800 rounded-lg">
                <div className={`w-3 h-3 rounded-full mr-2 ${getStatusColor(status.priceTrigger)}`}></div>
                <div>
                    <div className="text-sm font-medium">Price Trigger</div>
                    <div className="text-xs text-gray-400">{getStatusText(status.priceTrigger)}</div>
                </div>
            </div>
            
            <div className="flex items-center p-3 bg-gray-800 rounded-lg">
                <div className={`w-3 h-3 rounded-full mr-2 ${getStatusColor(status.tradeExecutor)}`}></div>
                <div>
                    <div className="text-sm font-medium">Trade Executor</div>
                    <div className="text-xs text-gray-400">{getStatusText(status.tradeExecutor)}</div>
                </div>
            </div>
        </div>
    );
};

export default ConnectionStatusBar;