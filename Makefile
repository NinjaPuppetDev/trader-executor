.PHONY: all deploy anvil run-* simulate* test-upkeep deploy-frontend clean run-all stop-all logs tail-all

# Default target
all: deploy

# -- Environment Setup --
ANVIL_RPC := http://127.0.0.1:8545
PRIVATE_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
VENICE_UPKEEP_ADDR ?= 0x5FbDB2315678afecb367f032d93F642f64180aa3
SCRIPT_DIR := $(shell pwd)
LOGS_DIR := logs

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
run-graphql-gateway:
	@echo "Starting GraphQL Gateway..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/graphql-gateway.ts

run-upkeep-listener:
	@echo "Starting upkeep listener..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/veniceListenerMemory.ts

run-price-trigger-listener:
	@echo "Starting price trigger listener..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/priceTriggerListener.ts

run-trader run-trader-only:
	@echo "Starting trader executor..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/traderExecutor.ts

run-portfolio-monitor:
	@echo "Starting portfolio monitor..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/portfolioMonitorService.ts

run-trainer:
	@echo "Starting RL trainer..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/runRLTrainingService.ts

run-price-updater:
	@echo "Starting price updater..."
	cd frontend && npx ts-node --project tsconfig.backend.json backend/priceUpdaterService.ts

# -- Simulations --
simulate-up:
	forge script script/spiketesters/SimulateUpSpike.s.sol:SimulateUpSpike \
		--rpc-url $(ANVIL_RPC) \
		--private-key $(PRIVATE_KEY) \
		--broadcast

simulate-down:
	forge script script/spiketesters/SimulateDownSpike.s.sol:SimulateDownSpike \
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
	@echo "Starting frontend..."
	cd frontend && npm run dev

clean:
	@echo "Cleaning build artifacts..."
	@forge clean

# -- Service Management --
run-all: run-graphql-gateway run-upkeep-listener run-price-trigger-listener run-trader run-portfolio-monitor run-trainer run-price-updater