import axios from 'axios';

// Configuration
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const UPDATE_INTERVAL_MS = 30000; // 30 seconds

interface GasData {
  timestamp: number;
  baseFee: number;
  priorityFee: number;
  proposedGasPrice: number;
  gsi: number;
  interpretation: string;
}

// Type-safe error handling
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export class EtherscanGasMonitor {
  private currentGas: GasData | null = null;
  private lastUpdate = 0;

  constructor() {
    // Initialize with current data
    this.updateGasData();
  }

  async getGasData(): Promise<GasData> {
    // Update if data is stale or doesn't exist
    const now = Date.now();
    if (!this.currentGas || now - this.lastUpdate > UPDATE_INTERVAL_MS) {
      await this.updateGasData();
    }
    return this.currentGas!;
  }

  private async updateGasData() {
    try {
      const response = await axios.get(
        `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`
      );

      if (response.data.status !== "1") {
        throw new Error(`Etherscan error: ${response.data.message}`);
      }

      const result = response.data.result;
      const proposedGasPrice = parseFloat(result.FastGasPrice);
      
      this.currentGas = {
        timestamp: Date.now(),
        baseFee: parseFloat(result.suggestBaseFee),
        priorityFee: proposedGasPrice - parseFloat(result.suggestBaseFee),
        proposedGasPrice,
        gsi: this.calculateGSI(proposedGasPrice),
        interpretation: this.interpretGSI(proposedGasPrice)
      };
      
      this.lastUpdate = Date.now();
      console.log(`[${new Date().toISOString()}] Gas updated: ${proposedGasPrice} Gwei`);
    } catch (error) {
      console.error('Failed to update gas data:', getErrorMessage(error));
      
      // Fallback to previous value or defaults
      if (!this.currentGas) {
        const fallbackGas = 11.5;
        this.currentGas = {
          timestamp: Date.now(),
          baseFee: 10,
          priorityFee: 1.5,
          proposedGasPrice: fallbackGas,
          gsi: this.calculateGSI(fallbackGas),
          interpretation: this.interpretGSI(fallbackGas)
        };
      }
    }
  }

  private calculateGSI(gasPrice: number): number {
    return Math.min(1, gasPrice / 50); // Cap at 50 Gwei = max stress
  }

  private interpretGSI(gasPrice: number): string {
    const gsi = this.calculateGSI(gasPrice);
    return gsi < 0.3 ? 'Low (Bearish/Neutral)' : 
           gsi < 0.7 ? 'Moderate' : 'High (Bullish)';
  }
}

// Export singleton instance
export const gasMonitor = new EtherscanGasMonitor();