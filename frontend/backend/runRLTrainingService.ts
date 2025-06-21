// backend/runRLTrainingService.ts
import { RLTrainingService } from './rltraining/RLTRainingService';
import dotenv from 'dotenv';
import path from 'path';
import { exit } from 'process';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const LOGS_DIR = path.resolve(__dirname, '../backend/logs');

async function main() {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    console.log('🚀 Starting RL Training Monitor');
    const service = new RLTrainingService(GEMINI_API_KEY, LOGS_DIR);

    // Initial training
    console.log('⏳ Running initial training');
    await runTraining(service);

    // Start watching for log changes
    await service.startWatching();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT - Stopping monitor');
        service.stopWatching();
        exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM - Stopping monitor');
        service.stopWatching();
        exit(0);
    });
}

async function runTraining(service: RLTrainingService) {
    try {
        const feedback = await service.generateFeedback();

        console.log('\n✅ RL FEEDBACK:');
        console.log(`🔄 Risk Level: ${feedback.riskLevel}/5`);
        console.log(`🎯 Strategy Focus: ${feedback.strategyFocus}`);
        console.log(`📊 Position Sizing: ${feedback.positionSizing}`);
        console.log(`💡 Insight: ${feedback.insight}`);

        if (feedback.portfolioMetrics) {
            console.log(`🏦 Portfolio: $${feedback.portfolioMetrics.valueUSD} | Stable: ${feedback.portfolioMetrics.stableBalance} | Volatile: ${feedback.portfolioMetrics.volatileBalance}`);
        }

        console.log('📝 Actions:');
        feedback.actions.forEach((action, i) => console.log(`  ${i + 1}. ${action}`));
    } catch (error) {
        console.error('❌ Training failed:', error);
    }
}

main().catch(error => {
    console.error('❌ RL Training Monitor Failed:', error);
    process.exit(1);
});