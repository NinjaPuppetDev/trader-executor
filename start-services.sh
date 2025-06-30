#!/bin/bash

# Get the absolute path to the project root
PROJECT_ROOT=$(dirname "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")

# Stop any existing services
pkill -f "veniceListenerMemory.ts"
pkill -f "priceTriggerListener.ts"
pkill -f "traderExecutor.ts"
pkill -f "portfolioMonitorService.ts"
pkill -f "runRLTrainingService.ts"
pkill -f "priceUpdaterService.ts"
pkill -f "npm run dev"

# Create a new tmux session
tmux new-session -d -s venice-services -c "$PROJECT_ROOT"

# Split window into panes
tmux split-window -h -c "$PROJECT_ROOT"
tmux split-window -v -c "$PROJECT_ROOT"
tmux split-window -v -c "$PROJECT_ROOT"
tmux select-pane -t 0
tmux split-window -v -c "$PROJECT_ROOT"
tmux select-pane -t 2
tmux split-window -v -c "$PROJECT_ROOT"
tmux select-pane -t 4
tmux split-window -v -c "$PROJECT_ROOT"

# Run services in each pane using absolute paths
tmux send-keys -t 0 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/veniceListenerMemory.ts" C-m
tmux send-keys -t 1 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/priceTriggerListener.ts" C-m
tmux send-keys -t 2 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/traderExecutor.ts" C-m
tmux send-keys -t 3 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/portfolioMonitorService.ts" C-m
tmux send-keys -t 4 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/runRLTrainingService.ts" C-m
tmux send-keys -t 5 "npx ts-node --project $PROJECT_ROOT/frontend/tsconfig.backend.json $PROJECT_ROOT/frontend/backend/priceUpdaterService.ts" C-m
tmux send-keys -t 6 "cd $PROJECT_ROOT/frontend && npm run dev" C-m

# Attach to the session
tmux attach-session -t venice-services