make run-price-trigger-listener
Starting price trigger listener...
cd frontend && npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts
✅ Price Trigger health server running on port 3002
[2025-07-29T18:57:28.652Z] ✅ Database connected at data/trigger-system.db
[2025-07-29T18:57:28.792Z] 🔌 Connected to ethusdt market data stream
[2025-07-29T18:57:28.792Z] 🚀 Starting Price Trigger Listener
[2025-07-29T18:57:28.792Z] 🔔 Listening for price spikes to trigger AI analysis
[2025-07-29T18:57:28.793Z] ⛓️ Connected to: unknown (ID: 31337)
[2025-07-29T18:57:28.807Z] 👂 Listening for PriceSpikeDetected events...
[2025-07-29T19:20:46.095Z] ⚠️ Initializing missing event cluster array
[2025-07-29T19:20:46.109Z] 📊 Collecting event 1/2 (▲ BUY 0.42% | Volatility: N/A (single event) | Bias: NaN▲/undefined▼)
[2025-07-29T19:49:12.619Z] 📊 Collecting event 2/3 (▼ SELL 0.36% | Volatility: 3.00% | Bias: NaN▲/NaN▼)
[2025-07-29T20:17:37.758Z] 📊 Collecting event 3/5 (▼ SELL 0.58% | Volatility: 9.29% | Bias: NaN▲/NaN▼)
[2025-07-29T21:14:31.130Z] 📊 Collecting event 4/5 (▲ BUY 0.42% | Volatility: 8.17% | Bias: NaN▲/NaN▼)
[2025-07-29T22:01:58.425Z] 📊 Price Spike Detected: 0.41% ▲ BUY | Current: 3779.2367 | Previous: 3763.6356 | Cluster: 5 events | Volatility: 7.44% | Bias: NaN▲/NaN▼
[2025-07-29T22:02:02.290Z] 📈 OPENED POSITION: long | Amount: 70.35 | SL: 3760.34055111605 | TP: 3798.1329184639494
[2025-07-29T22:02:02.290Z] ⚖️ Trading Decision: BUY | Action: OPEN | Confidence: medium | Amount: 70.35
[2025-07-29T22:02:02.290Z] 🛡️ Risk Management: SL: 3760.3406 | TP: 3798.1329
[2025-07-29T22:02:04.553Z] ✅ Spike processed in 6139ms | ID: spike-154-0
[2025-07-29T22:02:04.554Z] 🔄 Resetting cluster after processing 5 events
[2025-07-29T22:17:00.089Z] 📊 Collecting event 1/2 (▼ SELL 0.22% | Volatility: N/A (single event) | Bias: 0▲/1▼)
[2025-07-29T22:46:59.737Z] 📊 Collecting event 2/5 (▲ BUY 0.33% | Volatility: 5.50% | Bias: 1▲/1▼)
[2025-07-29T23:16:59.702Z] 📊 Collecting event 3/5 (▲ BUY 0.13% | Volatility: 8.18% | Bias: 2▲/1▼)
