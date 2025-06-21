currently we are having an error in here 


 Checking for new trading decisions...
💰 Contract Balances: 
  Stable: 101000.0 (Min: 10)
  Volatile: 1100.0 (Min: 10)
🔍 Found 0 Venice logs, 9 Price Trigger logs, 8 processed IDs
🔎 Processing Price Trigger log spike-1750292928003 (status: completed)
  Spike: 13% | FGI: 57 (N/A)
  Decision Content: "{"reasoning":"Fallback: <think>\nOkay, let's tackle this query. The user provided a complex setup with specific rules and a JSON structure to follow. First, I need to parse the system instructions car..." (length: 687)
⚠️ Overriding 'wait' decision to 'sell' based on FGI 57
⚠️ Non-positive amount: 0, using reduced amount
  Parsed Decision: {
  "decision": "sell",
  "tokenIn": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  "tokenOut": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  "amount": "0.5",
  "slippage": 1
}
🚀 Executing sell trade from Price Trigger log spike-1750292928003
⚡ Executing SELL trade:
  From: 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 (0.5 tokens)
  To:   0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
  USD Value In: $0.5
  Min USD Value Out: $0.495
  Min Output: 0.000165 tokens
  Contract Balance: 101000.0 tokens
🚀 Executing trade...
❌ Trade execution failed: Error: transaction failed [ See: https://links.ethers.org/v5-errors-CALL_EXCEPTION ] (transactionHash="0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c", transaction={"type":2,"chainId":31337,"nonce":27,"maxPriorityFeePerGas":{"type":"BigNumber","hex":"0x174876e800"},"maxFeePerGas":{"type":"BigNumber","hex":"0x174876e800"},"gasPrice":null,"gasLimit":{"type":"BigNumber","hex":"0x0f4240"},"to":"0x610178dA211FEF7D417bC0e6FeD39F05609AD788","value":{"type":"BigNumber","hex":"0x00"},"data":"0xc932d806000000000000000000000000000000000000000000000000000000000007a120000000000000000000000000000000000000000000000000000096110e6350000000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000000000000068535af50000000000000000000000000000000000000000000000000000000000000000","accessList":[],"hash":"0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c","v":1,"r":"0xebdcf952e4a80a9d4c28a468261ca78802e0322f4fc016f1b3ffc87fd590d2fb","s":"0x6d1601b87408f92cd2c972caad7e7eaec9fe47550192074bb291af9add19aa22","from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","confirmations":0}, receipt={"to":"0x610178dA211FEF7D417bC0e6FeD39F05609AD788","from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","contractAddress":null,"transactionIndex":0,"gasUsed":{"type":"BigNumber","hex":"0x01f004"},"logsBloom":"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","blockHash":"0x3146696f078e21c1ef4208069d4201c5ebe7f186a8bdc38e6cc3d60a405a1d8a","transactionHash":"0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c","logs":[],"blockNumber":24,"confirmations":1,"cumulativeGasUsed":{"type":"BigNumber","hex":"0x01f004"},"effectiveGasPrice":{"type":"BigNumber","hex":"0x174b8537f2"},"status":0,"type":2,"byzantium":true}, code=CALL_EXCEPTION, version=providers/5.6.8)
    at Logger.makeError (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/logger/src.ts/index.ts:261:28)
    at Logger.throwError (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/logger/src.ts/index.ts:273:20)
    at JsonRpcProvider.<anonymous> (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/providers/src.ts/base-provider.ts:1541:24)
    at step (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/providers/lib/base-provider.js:48:23)
    at Object.next (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/providers/lib/base-provider.js:29:53)
    at fulfilled (/home/ninja-turtle/chromion-chainlink/frontend/node_modules/ethers/node_modules/@ethersproject/providers/lib/base-provider.js:20:58)
    at processTicksAndRejections (node:internal/process/task_queues:105:5) {
  reason: 'transaction failed',
  code: 'CALL_EXCEPTION',
  transactionHash: '0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c',
  transaction: {
    type: 2,
    chainId: 31337,
    nonce: 27,
    maxPriorityFeePerGas: BigNumber { _hex: '0x174876e800', _isBigNumber: true },
    maxFeePerGas: BigNumber { _hex: '0x174876e800', _isBigNumber: true },
    gasPrice: null,
    gasLimit: BigNumber { _hex: '0x0f4240', _isBigNumber: true },
    to: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    value: BigNumber { _hex: '0x00', _isBigNumber: true },
    data: '0xc932d806000000000000000000000000000000000000000000000000000000000007a120000000000000000000000000000000000000000000000000000096110e6350000000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000000000000068535af50000000000000000000000000000000000000000000000000000000000000000',
    accessList: [],
    hash: '0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c',
    v: 1,
    r: '0xebdcf952e4a80a9d4c28a468261ca78802e0322f4fc016f1b3ffc87fd590d2fb',
    s: '0x6d1601b87408f92cd2c972caad7e7eaec9fe47550192074bb291af9add19aa22',
    from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    confirmations: 0,
    wait: [Function (anonymous)]
  },
  receipt: {
    to: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    contractAddress: null,
    transactionIndex: 0,
    gasUsed: BigNumber { _hex: '0x01f004', _isBigNumber: true },
    logsBloom: '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    blockHash: '0x3146696f078e21c1ef4208069d4201c5ebe7f186a8bdc38e6cc3d60a405a1d8a',
    transactionHash: '0xe77cce31a75ca556c47c6d33ce96a7844293da46c9a3aded23b7c663bbf5df4c',
    logs: [],
    blockNumber: 24,
    confirmations: 1,
    cumulativeGasUsed: BigNumber { _hex: '0x01f004', _isBigNumber: true },
    effectiveGasPrice: BigNumber { _hex: '0x174b8537f2', _isBigNumber: true },
    status: 0,
    type: 2,
    byzantium: true
  }
}
💾 Saved executed trade: exec-1750292937214
📝 Updated price-trigger-logs.json: spike-1750292928003
💾 Saved invalid decision: exec-1750292937223
✅ Processed 1 new logs

🔎 Checking for new trading decisions...
💰 Contract Balances: 
  Stable: 101000.0 (Min: 10)
  Volatile: 1100.0 (Min: 10)
🔍 Found 0 Venice logs, 9 Price Trigger logs, 9 processed IDs
⏩ No new logs to process
