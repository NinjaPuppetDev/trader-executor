# Makefile for Venice Protocol
.PHONY: all deploy anvil run-* simulate* test-upkeep deploy-frontend clean

# Default target
all: deploy

# -- Environment Setup --
ANVIL_RPC := http://127.0.0.1:8545
PRIVATE_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
VENICE_UPKEEP_ADDR ?= 0x5FbDB2315678afecb367f032d93F642f64180aa3

# -- Main Commands --
deploy: deploy-venice-trigger deploy-orchestrator

deploy-venice-trigger:
	forge script script/DeployVeniceUpkeep.s.sol:DeployVeniceUpkeep \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

deploy-orchestrator:
	forge script script/DeployOrchestratorExecutor.s.sol:DeployOrchestratorExecutor \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

# -- Services --
run-upkeep-listener:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/veniceListenerMemory.ts

run-price-trigger-listener:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts

run-trader run-trader-only:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/traderExecutor.ts

run-portfolio-monitor:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/portfolioMonitorService.ts

run-trainer:
	cd frontend && npx ts-node --project tsconfig.backend.json backend/runRLTrainingService.ts

# -- Simulations --
simulate-up:
	forge script script/SimulateUpSpike.s.sol:SimulateUpSpike \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

simulate-down:
	forge script script/SimulateDownSpike.s.sol:SimulateDownSpike \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

simulate: simulate-up simulate-down

# -- Testing --
test-upkeep:
	cast send $(VENICE_UPKEEP_ADDR) "performUpkeep(bytes)" 0x \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--chain-id 31337 \
		--gas-limit 300000

# -- Development Tools --
anvil:
	anvil

deploy-frontend:
	cd frontend && npm run dev

clean:
	rm -rf cache out