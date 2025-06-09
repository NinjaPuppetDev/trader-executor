'use client';

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import MockTrader from "../app/abis/MockTrader.json";

interface Trade {
    id: string;
    action: 'buy' | 'sell';
    executor: string;
    timestamp: number;
    txHash: string;
}

interface Position {
    isOpen: boolean;
    size: number;
    entryPrice: number;
    timestamp: number;
}

export default function TraderDashboard() {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [position, setPosition] = useState<Position | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);

    useEffect(() => {
        const initDashboard = async () => {
            try {
                if (!process.env.NEXT_PUBLIC_RPC_URL ||
                    !process.env.NEXT_PUBLIC_TRADING_CONTRACT_ADDRESS) {
                    throw new Error("Missing required environment variables");
                }

                const provider = new ethers.providers.JsonRpcProvider(
                    process.env.NEXT_PUBLIC_RPC_URL
                );

                // Get current block number for event filtering
                const currentBlock = await provider.getBlockNumber();
                const fromBlock = Math.max(0, currentBlock - 10000); // Last ~10k blocks

                const contract = new ethers.Contract(
                    process.env.NEXT_PUBLIC_TRADING_CONTRACT_ADDRESS,
                    MockTrader,
                    provider
                );

                // Fetch historical trades
                const tradeExecutedFilter = contract.filters.TradeExecuted();
                const tradeEvents = await contract.queryFilter(tradeExecutedFilter, fromBlock);
                const processedTrades = tradeEvents.map((event: any) => ({
                    id: event.transactionHash,
                    action: event.args.action === 0 ? 'buy' : 'sell',
                    executor: event.args.executor,
                    timestamp: event.args.timestamp.toNumber(),
                    txHash: event.transactionHash
                })) as Trade[];

                // Sort by timestamp descending
                processedTrades.sort((a, b) => b.timestamp - a.timestamp);
                setTrades(processedTrades);

                // Get current position
                const positionData = await contract.positions(process.env.NEXT_PUBLIC_TRADING_CONTRACT_ADDRESS);
                setPosition({
                    isOpen: positionData.isOpen,
                    size: parseFloat(ethers.utils.formatUnits(positionData.size, 18)),
                    entryPrice: parseFloat(ethers.utils.formatUnits(positionData.entryPrice, 18)),
                    timestamp: positionData.timestamp.toNumber()
                });

                // Simulate current price (in a real app, this would come from an oracle)
                setCurrentPrice(3500 + Math.random() * 100);

                setError(null);
            } catch (err: any) {
                console.error("Dashboard initialization error:", err);
                setError(err.message || "Failed to load trading data");
            } finally {
                setLoading(false);
            }
        };

        initDashboard();

        // Refresh data every 30 seconds
        const interval = setInterval(initDashboard, 30000);
        return () => clearInterval(interval);
    }, []);

    const calculatePnL = () => {
        if (!position || !position.isOpen || !currentPrice) return null;
        const pnl = (currentPrice - position.entryPrice) * position.size;
        return {
            value: pnl,
            percentage: ((currentPrice - position.entryPrice) / position.entryPrice * 100).toFixed(2)
        };
    };

    const pnlData = calculatePnL();

    return (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Trading Dashboard
                {loading && (
                    <span className="ml-2">
                        <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </span>
                )}
            </h2>

            {error && (
                <div className="mb-4 p-3 bg-red-900/30 rounded-lg border border-red-800">
                    <div className="flex items-center text-red-400">
                        <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{error}</span>
                    </div>
                </div>
            )}

            {/* Position Summary */}
            <div className="mb-6">
                <h3 className="text-lg font-medium mb-3 text-gray-300">Current Position</h3>

                {loading ? (
                    <div className="bg-gray-800/30 rounded-lg p-4 flex justify-center">
                        <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                ) : position?.isOpen ? (
                    <div className="bg-gray-800/30 rounded-lg border border-gray-700 p-4">
                        <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                                <p className="text-sm text-gray-400">Status</p>
                                <div className="flex items-center">
                                    <div className="h-2 w-2 rounded-full bg-green-500 mr-2"></div>
                                    <p className="text-green-400">Open</p>
                                </div>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Size</p>
                                <p className="text-gray-200">{position.size.toFixed(4)} ETH</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Entry Price</p>
                                <p className="text-gray-200">${position.entryPrice.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Current Price</p>
                                <p className="text-gray-200">${currentPrice?.toFixed(2)}</p>
                            </div>
                        </div>

                        {pnlData && (
                            <div className={`mt-2 p-3 rounded-lg ${pnlData.value >= 0 ? 'bg-green-900/20 border border-green-800' : 'bg-red-900/20 border border-red-800'}`}>
                                <div className="flex justify-between items-center">
                                    <span className="text-sm">Profit/Loss:</span>
                                    <span className={`font-medium ${pnlData.value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {pnlData.value >= 0 ? '+' : ''}${pnlData.value.toFixed(2)} ({pnlData.percentage}%)
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="mt-3 text-sm text-gray-400">
                            Opened: {new Date(position.timestamp * 1000).toLocaleString()}
                        </div>
                    </div>
                ) : (
                    <div className="bg-gray-800/30 rounded-lg border border-gray-700 p-6 text-center">
                        <div className="text-gray-400 mb-2">No active position</div>
                        <div className="text-sm text-gray-500">Execute a trade to open a position</div>
                    </div>
                )}
            </div>

            {/* Trade History */}
            <div>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-lg font-medium text-gray-300">Trade History</h3>
                    <span className="text-sm text-gray-400">{trades.length} trades</span>
                </div>

                {trades.length === 0 ? (
                    <div className="bg-gray-800/30 rounded-lg border border-gray-700 p-6 text-center">
                        <div className="text-gray-400">No trades executed yet</div>
                    </div>
                ) : (
                    <div className="bg-gray-800/30 rounded-lg border border-gray-700 max-h-[300px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-700/50">
                            <thead className="bg-gray-750 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Size</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">TX</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700/30">
                                {trades.map((trade) => (
                                    <tr key={trade.id} className="hover:bg-gray-750/50 transition-colors">
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${trade.action === 'buy'
                                                ? 'bg-green-900/30 text-green-400 border border-green-800'
                                                : 'bg-red-900/30 text-red-400 border border-red-800'
                                                }`}>
                                                {trade.action.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-300">
                                            {/* Assuming fixed size for simplicity */}
                                            {trade.action === 'buy' ? '1.0000' : '1.0000'} ETH
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-300">
                                            {new Date(trade.timestamp * 1000).toLocaleTimeString()}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <a
                                                href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/tx/${trade.txHash}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center text-purple-400 hover:text-purple-300"
                                                title="View transaction"
                                            >
                                                <span className="truncate max-w-[60px]">
                                                    {trade.txHash.slice(0, 6)}...{trade.txHash.slice(-4)}
                                                </span>
                                                <svg className="ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}