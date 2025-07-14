help me generate a separate prompt for testing buys and sells only I will switch when needed, the price is triggered every 0.1% so we can use that or even oblige the AI to choose each indicator and act upon it, also we have lots of indicators which could be the reason, but I am also not monitoring the trade analyzer so I cant see what is doing, so big part of the context is missing, yet let's first tackle the prompt.



trade suggestion success still needs to place the trade, ' make run-price-trigger-listener
Starting price trigger listener...
cd frontend && npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts
✅ Price Trigger health server running on port 3002
[2025-07-11T01:07:04.896Z] ✅ Database connected
🔌 Connecting to Binance ethusdt stream...
🚀 Started Market Data Collector for ethusdt
[2025-07-11T01:07:05.904Z] 🔌 Connected to ethusdt market data stream
[2025-07-11T01:07:05.905Z] 🚀 Starting Price Trigger Listener
[2025-07-11T01:07:05.907Z] 🔔 Listening for price spikes to trigger AI analysis
[2025-07-11T01:07:05.908Z] 🔑 Stable Token: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
[2025-07-11T01:07:05.911Z] 🔑 Volatile Token: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
[2025-07-11T01:07:05.911Z] 🔑 Exchange Address: 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707
[2025-07-11T01:07:05.932Z] ⛓️ Connected to: unknown (ID: 31337)
[2025-07-11T01:07:05.940Z] 👂 Listening for PriceSpikeDetected events...
✅ Connected to Binance ethusdt stream
❤️ WebSocket heartbeat confirmed
[2025-07-11T01:07:43.406Z] 📡 Calling Venice API with populated prompt...
[2025-07-11T01:07:43.411Z] DEBUG: Prompt: {"system":"ROLE: Senior Cryptocurrency Analyst\nTASK: Make strategic trading decisions for ETHUSDT pair using price action analysis\n\n## PRICE ACTION ANALYSIS ##\n- Recommended Action: BUY\n- Confide...
[2025-07-11T01:07:49.861Z] DEBUG: Full API response: {
  "decision": "buy",
  "tokenIn": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "tokenOut": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "amount": "0.025",
  "slippage": 1.5,
  "stopLoss": 2905.25,
  "takeProfit": 3002.50,
  "reasoning": "Price spike up with medium volatility, bullish signal",
  "confidence": "high"
}
[2025-07-11T01:07:51.026Z] DEBUG: 📝 Debug log saved: spike-16-0
[2025-07-11T01:07:51.037Z] DEBUG: Raw signal (326 chars): {
  "decision": "buy",
  "tokenIn": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "tokenOut": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "amount": "0.025",
  "slippage": 1.5,
  "stopLoss": 2905.25,
  "takeProfit": 3002.50,
  "reasoning": "Price spike up with medium volatility, bullish signal"...
[2025-07-11T01:07:51.038Z] DEBUG: ✅ Successfully parsed JSON
[2025-07-11T01:07:51.041Z] DEBUG: ❌ JSON parse failed: Stop loss must be between 0.5% and 30%
[2025-07-11T01:07:51.041Z] DEBUG: ✅ Extracted JSON with bracket matching
[2025-07-11T01:07:51.042Z] DEBUG: Bracket matching failed
[2025-07-11T01:07:51.043Z] DEBUG: ✅ Extracted JSON with regex
[2025-07-11T01:07:51.044Z] DEBUG: Regex extraction failed
[2025-07-11T01:07:51.044Z] DEBUG: ❌ All parsing methods failed
[2025-07-11T01:07:51.780Z] DEBUG: 📝 Debug log saved: spike-16-0
[2025-07-11T01:07:51.781Z] 🟡 AI decision: Hold position
[2025-07-11T01:07:53.160Z] 📤 Logged detection to GraphQL: spike-16-0
[2025-07-11T01:07:53.161Z] ✅ Processing completed in 10668ms
❤️ WebSocket heartbeat confirmed
^C
🛑 Shutting down servers...
🛑 Price trigger listener stopped
make: *** [Makefile:39: run-price-trigger-listener] Interrupt
'