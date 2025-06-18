# Makefile for Venice Protocol automation

# Network configuration (adjust as needed)
RPC_URL := http://localhost:8545
PRIVATE_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CHAIN_ID := 31337
GAS_LIMIT := 300000

# Contract addresses (update after deployment)
VENICE_TRIGGER_ADDR ?= 0x5FbDB2315678afecb367f032d93F642f64180aa3
PRICE_SPIKE_ADDR ?= 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0

.PHONY: all deploy simulate check test listeners

all: deploy listeners

# Deployment targets
deploy-venice-trigger:
	forge script script/DeployVeniceUpkeep.s.sol:DeployVeniceUpkeep \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

deploy-price-trigger:
	forge script script/DeployPriceTrigger.s.sol:DeployPriceTrigger \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

deploy-trader-executor:
	forge script script/DeployTradeExecutor.s.sol:DeployTradeExecutor \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

deploy: deploy-venice-trigger deploy-price-trigger deploy-trader-executor

# Simulation and testing
simulate-price-spike:
	forge script script/SimulatePriceSpike.s.sol:SimulatePriceSpike \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

check-price-spike:
	cast send $(PRICE_SPIKE_ADDR) "checkPriceSpike()" \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--chain-id $(CHAIN_ID) \
		--gas-limit $(GAS_LIMIT)

test-upkeep:
	cast send $(VENICE_TRIGGER_ADDR) "performUpkeep(bytes)" 0x \
		--rpc-url $(RPC_URL) \
		--private-key $(PRIVATE_KEY) \
		--chain-id $(CHAIN_ID) \
		--gas-limit $(GAS_LIMIT)

# Listener services
run-upkeep-listener:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/veniceListenerMemory.ts

run-price-trigger-listener:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts

run-trader:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/traderExecutor.ts

listeners: run-upkeep-listener run-price-trigger-listener run-trader

# Combined workflows
simulate: simulate-price-spike check-price-spike
test: test-upkeep