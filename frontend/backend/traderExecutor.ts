import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import executorAbi from '../app/abis/MockTrader.json';
// Types
interface VeniceLog {
    id: string;
    timestamp: string;
    prompt: string;
    decision: string;
    decisionLength: number;
    status: 'completed' | 'pending' | 'failed' | 'error';
    createdAt: string;
    txHash?: string;
    blockNumber?: number;
}

interface TradingDecision {
    decision: 'buy' | 'sell' | 'hold' | 'wait';
    tokenIn?: string;
    tokenOut?: string;
    amount?: string;
    slippage?: number;
}

// ANVIL CONFIGURATION (Update with your deployment addresses)
const CONFIG = {
    rpcUrl: 'http://localhost:8545',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil default private key
    executorAddress: '0x0165878A594ca255338adfa4d48449f69242Eb8F', // From your deployment
    tokenA: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', // TKNA
    tokenB: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', // TKNB
    routerAddress: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', // Mock router
    defaultAmount: '100', // Default trade amount in TKNA (18 decimals)
    slippagePercent: 1, // 1% slippage
    poolFee: 3000 // 0.3% pool fee
};

// Setup
const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
const wallet = new ethers.Wallet(CONFIG.privateKey, provider);


// File paths
const LOGS_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'venice-logs.json');
const PROCESSED_FILE = path.join(LOGS_DIR, 'processed.json');



// Initialize environment
async function setupEnvironment() {
    if (!existsSync(LOGS_DIR)) {
        await mkdir(LOGS_DIR, { recursive: true });
        await writeFile(LOG_FILE, '[]', 'utf-8');
        await writeFile(PROCESSED_FILE, '[]', 'utf-8');
        console.log(`📁 Created logs directory at ${LOGS_DIR}`);
    }
    console.log('✅ Environment setup complete');
}

// Execute trade using TradeExecutor contract
async function executeOnChainTrade(decision: TradingDecision): Promise<VeniceLog> {
    try {
        const executor = new ethers.Contract(
            CONFIG.executorAddress,
            executorAbi,
            wallet
        );

        // Determine trade parameters for Anvil
        const isBuy = decision.decision === 'buy';
        const tokenIn = isBuy ? CONFIG.tokenA : CONFIG.tokenB;
        const tokenOut = isBuy ? CONFIG.tokenB : CONFIG.tokenA;
        const amount = decision.amount || CONFIG.defaultAmount;

        const amountIn = ethers.utils.parseUnits(amount, 18);
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        // Calculate minAmountOut with slippage (1 TKNA = 100 TKNB)
        const baseRate = isBuy ? 100 : 0.01; // 1 TKNA = 100 TKNB
        const expectedOut = amountIn.mul(ethers.utils.parseUnits(baseRate.toString(), 18));
        const minAmountOut = expectedOut.mul(100 - CONFIG.slippagePercent).div(100);

        console.log(`⚡ Executing ${isBuy ? 'BUY' : 'SELL'} trade:`);
        console.log(`  From: ${tokenIn} (${amount} tokens)`);
        console.log(`  To:   ${tokenOut}`);
        console.log(`  Min Output: ${ethers.utils.formatUnits(minAmountOut, 18)} tokens`);
        try {
            console.log(`📊 Executing ${decision.decision.toUpperCase()} trade`);
            console.log(`   Token In:  ${decision.tokenIn}`);
            console.log(`   Token Out: ${decision.tokenOut}`);
            console.log(`   Amount:    ${decision.amount}`);
            console.log(`   Slippage:  ${decision.slippage}%`);

            // Rest of the function...
        } catch (error: any) {
            console.error('❌ Trade Execution Error:');
            console.error('   Message:', error.message);
            console.error('   Stack:', error.stack);
            throw error;
        }
        // Check token approval
        const tokenContract = new ethers.Contract(
            tokenIn,
            ['function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'],
            wallet
        );

        const allowance = await tokenContract.allowance(wallet.address, CONFIG.executorAddress);
        if (allowance.lt(amountIn)) {
            console.log('⏳ Approving tokens...');
            const approveTx = await tokenContract.approve(CONFIG.executorAddress, amountIn);
            await approveTx.wait();
            console.log(`✅ Approved ${amount} tokens`);
        }

        // Execute trade
        console.log('🚀 Executing trade...');
        const tx = await executor.executeTrade(
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            CONFIG.poolFee,
            deadline,
            { gasLimit: 500000 }
        );

        const receipt = await tx.wait();
        console.log(`✅ Trade executed! TX hash: ${receipt.transactionHash}`);

        // Parse events
        const tradeEvent = receipt.events?.find((e: any) => e.event === 'TradeExecuted');
        let amountOut = ethers.BigNumber.from(0);
        if (tradeEvent) {
            amountOut = tradeEvent.args.amountOut;
            console.log(`🔄 Traded ${amount} ${isBuy ? 'TKNA' : 'TKNB'} for ${ethers.utils.formatUnits(amountOut, 18)} ${isBuy ? 'TKNB' : 'TKNA'}`);
        }

        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            prompt: `Execute ${decision.decision} trade`,
            decision: JSON.stringify(decision),
            decisionLength: decision.decision.length,
            status: 'completed',
            createdAt: new Date().toISOString(),
            txHash: tx.hash,
            blockNumber: receipt.blockNumber
        };
    } catch (error: any) {
        console.error(`❌ Trade execution failed:`, error);
        throw error;
    }
}

// Update extractDecision function
function extractDecision(decisionStr: string): TradingDecision | null {
    try {
        // Extract JSON from potentially wrapped text
        const jsonStart = decisionStr.indexOf('{');
        const jsonEnd = decisionStr.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1) return null;

        const jsonString = decisionStr.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonString);

        // Validate decision type
        if (!['buy', 'sell', 'hold', 'wait'].includes(parsed.decision)) return null;

        return {
            decision: parsed.decision,
            tokenIn: parsed.tokenIn || CONFIG.tokenA,
            tokenOut: parsed.tokenOut || CONFIG.tokenB,
            amount: parsed.amount || CONFIG.defaultAmount,
            slippage: parsed.slippage || CONFIG.slippagePercent
        };
    } catch (e) {
        if (e instanceof Error) {
            console.warn('Decision parse error:', e.message);
        } else {
            console.warn('Decision parse error:', e);
        }
        return null;
    }
}

// Process Venice logs
async function processVeniceLogs() {
    try {
        // Load logs
        const logs: VeniceLog[] = JSON.parse(await readFile(LOG_FILE, 'utf-8').catch(() => '[]'));
        const processedIds: Set<string> = new Set(
            JSON.parse(await readFile(PROCESSED_FILE, 'utf-8').catch(() => '[]'))
        );

        let newProcessed = false;

        for (const log of logs) {
            if (log.status !== 'completed' || processedIds.has(log.id)) continue;

            const decision = extractDecision(log.decision);
            if (!decision || decision.decision === 'hold' || decision.decision === 'wait') {
                console.log(`⏭️ Skipping log ${log.id}: ${decision?.decision || 'no action'}`);
                processedIds.add(log.id);
                newProcessed = true;
                continue;
            }

            try {
                console.log(`🔍 Processing ${decision.decision} trade from log ${log.id}`);
                const tradeLog = await executeOnChainTrade(decision);

                // Update original log
                log.txHash = tradeLog.txHash;
                log.blockNumber = tradeLog.blockNumber;

                // Add new execution log
                logs.unshift(tradeLog);
                console.log(`📝 Logged trade execution: ${tradeLog.txHash}`);
            } catch (error) {
                log.status = 'failed';
                console.error(`❌ Trade execution failed for log ${log.id}:`, error);
            }

            processedIds.add(log.id);
            newProcessed = true;
        }

        if (newProcessed) {
            await writeFile(LOG_FILE, JSON.stringify(logs, null, 2));
            await writeFile(PROCESSED_FILE, JSON.stringify([...processedIds], null, 2));
            console.log('✅ Updated logs with processed decisions');
        }
    } catch (error) {
        console.error('❌ Log processing failed:', error);
    }
}

// Main execution flow
async function main() {
    await setupEnvironment();

    // Check wallet balance
    const balance = await wallet.getBalance();
    console.log(`💰 Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);
    if (balance.lt(ethers.utils.parseEther('0.01'))) {
        console.warn('⚠️ Low ETH balance. Anvil accounts should be funded automatically');
    }

    // Initial log processing
    await processVeniceLogs();

    // Process logs every 15 seconds
    setInterval(async () => {
        console.log('\n🔎 Checking for new trading decisions...');
        await processVeniceLogs();
    }, 15000);

    console.log('🚀 Trade executor started. Listening for decisions...');
    console.log(`   Executor: ${CONFIG.executorAddress}`);
    console.log(`   Token A:  ${CONFIG.tokenA} (TKNA)`);
    console.log(`   Token B:  ${CONFIG.tokenB} (TKNB)`);
    console.log(`   Wallet:   ${wallet.address}`);
}



main().catch(console.error);