'use client';

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import contractABI from "../app/abis/VeniceAutomation.json"; // Update path if needed

export default function TestVenicePage() {
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");
    const [loading, setLoading] = useState(false);
    const [lastChainTrigger, setLastChainTrigger] = useState<string | null>(null);

    useEffect(() => {
        const provider = new ethers.providers.JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
        const contract = new ethers.Contract(
            process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!,
            contractABI,
            provider
        );

        const handleEvent = (timestamp: ethers.BigNumber) => {
            const date = new Date(timestamp.toNumber() * 1000);
            setLastChainTrigger(date.toLocaleString());
            console.log("📡 Chainlink RequestAnalysis at:", date.toISOString());
        };

        contract.on("RequestAnalysis", handleEvent);
        return () => {
            contract.off("RequestAnalysis", handleEvent);
        };
    }, []);

    async function sendPrompt() {
        if (!prompt.trim()) return;

        setLoading(true);
        setResponse("");

        try {
            const res = await fetch("/api/venice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
            });

            if (!res.ok) throw new Error("Failed to fetch Venice response");

            const data = await res.json();
            setResponse(data.signal);
        } catch (err: any) {
            setResponse("❌ Error: " + err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-xl mx-auto">
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold mb-2">🧠 TraderAI</h1>
                    <p className="text-gray-400">Test the AI trading assistant</p>
                </div>

                <div className="space-y-6">
                    <div>
                        <textarea
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-gray-600 text-gray-100 placeholder-gray-500 transition-colors"
                            rows={5}
                            placeholder="Enter your trading prompt, e.g. 'Give a signal for BTC/USDT based on current market conditions'"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    sendPrompt();
                                }
                            }}
                        />
                        <div className="flex justify-between items-center mt-1 text-sm text-gray-500">
                            <span>{prompt.length}/1000</span>
                            <span>Shift+Enter for new line</span>
                        </div>
                    </div>

                    <button
                        onClick={sendPrompt}
                        className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${loading || !prompt.trim() ? 'bg-gray-700 cursor-not-allowed' : 'bg-gray-600 hover:bg-gray-500 active:bg-gray-400'}`}
                        disabled={loading || !prompt.trim()}
                    >
                        {loading ? (
                            <span className="flex items-center justify-center">
                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                            </span>
                        ) : "Get Trading Signal"}
                    </button>

                    {response && (
                        <div className="mt-6 p-5 rounded-lg bg-gray-800 border border-gray-700">
                            <div className="flex items-start">
                                <div className="flex-shrink-0 text-gray-300">
                                    {response.startsWith("❌") ? "⚠️" : "📊"}
                                </div>
                                <div className="ml-3">
                                    <h3 className="text-lg font-medium text-gray-200">
                                        {response.startsWith("❌") ? "Error" : "AI Signal"}
                                    </h3>
                                    <div className="mt-2 text-gray-300 whitespace-pre-wrap">
                                        {response}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {lastChainTrigger && (
                        <div className="mt-4 text-sm text-green-400">
                            ⏱️ Last Chainlink trigger: {lastChainTrigger}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
