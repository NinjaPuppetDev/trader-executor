## Hackathon 

Enable a better way to power onchain finance or AI.

Cross chain liquidity, new derivatives or peps porotcol that uses data streams and automation and ccip

elizaOs by category Defi and web3 agents, productivity and operations, muti-agent & orchestration

actions based on oracles, smart key managment, risk management, swarms of agents that look at proposals, frameworks and benchmarking performance.

## Ideas
agent that based on a trading signal push a proposal on a dao to place a trade cross chain.
liquidity is about accumulation and distribution, this is important for the agent to keep liquidity and manage cross chain 

Amazon bedrock and amazon bedrock agents is integrated with elizaOs

3-5 minute video publicly viewable 
publicly accessible source code
project description that also covers stack architecture
optional: link to live deployed demo

## Steps

```
anvil
```


## DeployVeniceTriggerAutomation

```
forge script script/DeployVeniceUpkeep.s.sol:DeployVeniceUpkeep   --rpc-url http://127.0.0.1:8545   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   --broadcast
```

## Deploy PriceTrigger 

```
forge script script/DeployPriceTrigger.s.sol:DeployPriceTrigger --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```

## Deploy TraderExecutor

```
forge script script/DeployTradeExecutor.s.sol:DeployTradeExecutor --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  --rpc-url http://localhost:8545   --broadcast  
```

## Deploy PriceSpikeSimulation

```
forge script script/SimulatePriceSpike.s.sol:SimulatePriceSpike --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```
## Check Price Spike

```
cast send 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0   "checkPriceSpike()"   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   --rpc-url http://127.0.0.1:8545   --chain-id 31337   --gas-limit 300000
```

## Run upKeepListener

```
cd frontend
npx ts-node --project tsconfig.backend.json backend/veniceListenerMemory.ts
```
## Run PriceTriggerListener

```
cd frontend
npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts
```





## Run Trader

```
cd frontend
npx ts-node --project tsconfig.backend.json backend/traderExecutor.ts
```

## Test Upkeep

```
cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3   "performUpkeep(bytes)" 0x   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   --rpc-url http://127.0.0.1:8545   --chain-id 31337   --gas-limit 300000
```

## Deploy Frontend

```
cd frontend
npm run dev
```

## MAKEFILE

# Run anvil

anvil

# Full deployment

make deploy

# Run all listeners

make run-upkeep-listener

make run-price-trigger-listener

make run-trader

# Simulate price spike and check

make simulate

# Test upkeep manually

make test-upkeep

# Deploy single component

make deploy-venice-trigger

# Start trader executor only

make run-trader