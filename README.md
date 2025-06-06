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

Run anvil


Then run 

```forge script script/Deploy.s.sol:DeployVeniceAutomation   --rpc-url http://127.0.0.1:8545   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   --broadcast
```

## run listener

```cd frontend
npx ts-node --project tsconfig.backend.json backend/veniceListener.ts
```

## Test 

```cast send 0x5FbDB2315678afecb367f032d93F642f64180aa3   "performUpkeep(bytes)" 0x   --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   --rpc-url http://127.0.0.1:8545   --chain-id 31337   --gas-limit 300000
```



