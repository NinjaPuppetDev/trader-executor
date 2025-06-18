// LogsTable.tsx
'use client';
import React from 'react';
import { LogEntry } from './types';

interface LogsTableProps {
    logs: LogEntry[];
    expandedLogId: string | null;
    toggleLogExpansion: (id: string) => void;
    columns: {
        header: string;
        accessor: (log: LogEntry) => React.ReactNode;
    }[];
    renderExpandedRow: (log: LogEntry) => React.ReactNode;
}

export default function LogsTable({
    logs,
    expandedLogId,
    toggleLogExpansion,
    columns,
    renderExpandedRow
}: LogsTableProps) {
    const renderTxHash = (txHash: string) => (
        <span className="inline-flex items-center text-purple-400">
            <span className="truncate max-w-[80px]">
                {txHash.slice(0, 6)}...{txHash.slice(-4)}
            </span>
        </span>
    );

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
                        {columns.map((column, index) => (
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
                                className="hover:bg-gray-750/50 transition-colors cursor-pointer"
                                onClick={() => toggleLogExpansion(log.id)}
                            >
                                {columns.map((column, index) => (
                                    <td key={index} className="px-4 py-3 text-sm text-gray-300">
                                        {column.accessor(log)}
                                    </td>
                                ))}
                            </tr>
                            {expandedLogId === log.id && (
                                <tr className="bg-gray-750/50">
                                    <td colSpan={columns.length} className="px-4 py-3">
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