LOCAL TEST ONLY ANVIL

Trading can be risky and complex, I believe automation systems can address this while enhancing transparency. The original concept involved connecting an agent to public development databases to trigger signals when changes occur, thereby optimizing resources, preventing bad actors, and building a zero-corruption ecosystem.


Since the initial objective involves complex multi-stakeholder coordination, I simplified the project to a trader executor that maintains the core concept while utilizing blockchain public resources.


A **Trader Agent** that:
1. Activates via **Chainlink Automation** upon detecting price spikes (using Chainlink Price Feeds)
2. Triggers a **Venice Wrapper API** to execute role-based prompts (configured as a trader executor)
3. Performs market analysis using:
   - Fear and Greed Index API
   - On-Balance Volume (OBV) calculations via CoinGecko API
4. Executes Buy/Sell/Hold decisions through a **Trader Executor Smart Contract** that:
   - Generates verifiable randomness via Chainlink VRF
   - Places exchange trades using Chainlink Price Feeds
5. Incorporates a **parallel performance watcher** (Google API Wrapper) that:
   - Analyzes trade results
   - Provides feedback to reinforce agent learning

### Tech Stack
- **Smart Contracts**: Foundry
- **Frontend**: Next.js
- **Oracle Services**: Chainlink (Automation, VRF, Price Feeds)



## Steps


## MAKEFILE

# -- Deploy Commands --
anvil

make deploy

# -- websocket --

make run-trade-ws-server

make run-price-ws-server


# -- Services --

make run-upkeep-listener // do not use this soon to be deprecated

make run-price-trigger-listener

make run-trader

make run-portfolio-monitor

make run-trainer

make run-price-updater

# -- Development Tools --

make deploy-frontend


