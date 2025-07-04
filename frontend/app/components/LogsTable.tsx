'use client';
import React from 'react';
import { LogEntry, VeniceLogEntry, isTradeExecutionLog, isPriceDetectionLog } from './types';


const getLogDate = (log: LogEntry) => {
    if (isPriceDetectionLog(log)) {
        return new Date(log.timestamp || log.createdAt);
    }
    return new Date(log.createdAt);
};

interface LogsTableProps<T extends LogEntry> {
    logs: T[];
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    columns: {
        header: string;
        accessor: (log: T) => React.ReactNode;
    }[];
    renderExpandedRow: (log: T) => React.ReactNode;
}

export default function LogsTable<T extends LogEntry>(props: LogsTableProps<T>) {
    const {
        logs,
        expandedLogId,
        toggleLogExpansion,
        columns,
        renderExpandedRow
    } = props;
    // Helper function to get log type
    const getLogType = (log: LogEntry) => {
        if (isPriceTriggerLogEntry(log)) return 'price-detections';
        if (isVeniceLogEntry(log)) return 'venice';
        if (isTradeExecutionLog(log)) return 'trade-execution';
        return 'unknown';
    };

    // Render appropriate icon based on log type
    const renderLogTypeIcon = (log: LogEntry) => {
        const type = getLogType(log);

        switch (type) {
            case 'price-detections':
                return (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-900/30 text-purple-400">
                        📈 Trigger
                    </span>
                );
            case 'venice':
                return (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-900/30 text-blue-400">
                        🤖 AI
                    </span>
                );
            case 'trade-execution':
                return (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-900/30 text-green-400">
                        💰 Trade
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-400">
                        ❓ Unknown
                    </span>
                );
        }
    };

    // Add log type as the first column
    const enhancedColumns = [
        {
            header: "Type",
            accessor: (log: LogEntry) => renderLogTypeIcon(log)
        },
        ...columns
    ];

    if (logs.length === 0) {
        return (
            <div className="text-center py-8 bg-gray-800/30 rounded-lg border border-gray-700">
                <p className="text-gray-400">No logs available</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-800/30 rounded-lg border border-gray-700 max-h-[500px] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-700/50">
                <thead className="bg-gray-750 sticky top-0">
                    <tr>
                        {enhancedColumns.map((column, index) => (
                            <th key={index} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                {column.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/30">
                    {logs.map((log) => (
                        <React.Fragment key={log.id}>
                            <tr
                                className={`hover:bg-gray-750/50 transition-colors cursor-pointer ${isPriceTriggerLogEntry(log) ? 'bg-purple-900/10' :
                                    isVeniceLogEntry(log) ? 'bg-blue-900/10' :
                                        isTradeExecutionLog(log) ? 'bg-green-900/10' : ''
                                    }`}
                                onClick={() => toggleLogExpansion(log.id)}
                            >
                                {enhancedColumns.map((column, index) => (
                                    <td key={index} className="px-4 py-3 text-sm text-gray-300">
                                        {column.accessor(log)}
                                    </td>
                                ))}
                            </tr>
                            {expandedLogId === log.id && (
                                <tr className={`
                                    ${isPriceTriggerLogEntry(log) ? 'bg-purple-900/20' :
                                        isVeniceLogEntry(log) ? 'bg-blue-900/20' :
                                            isTradeExecutionLog(log) ? 'bg-green-900/20' : 'bg-gray-750/50'}
                                `}>
                                    <td colSpan={enhancedColumns.length} className="px-4 py-3">
                                        {renderExpandedRow(log)}
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function isPriceTriggerLogEntry(log: LogEntry): boolean {
    // Replace this logic with the actual condition for a price trigger log entry
    return (log as any).type === 'price-trigger';
}
function isVeniceLogEntry(log: LogEntry): boolean {
    // Replace this logic with the actual condition for a Venice log entry
    return (log as any).type === 'venice';
}

