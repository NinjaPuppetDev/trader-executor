// fundingRateAnalyzer.ts
import axios, { AxiosInstance } from 'axios';
import { createServer } from 'http';

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
}

// Helper function for nested path resolution
function getValueByPath(obj: any, path: string): any {
    if (!path) return undefined;
    const tokens = path.split(/\.|\[|\]/).filter(token => token !== '');
    let current = obj;
    for (const token of tokens) {
        if (current === undefined || current === null) {
            return undefined;
        }
        if (/^\d+$/.test(token)) {
            current = current[parseInt(token, 10)];
        } else {
            current = current[token];
        }
    }
    return current;
}

// Updated exchange configuration
const EXCHANGES = [
  {
    name: 'Binance',
    url: 'https://fapi.binance.com/fapi/v1/fundingRate',
    symbolParam: 'symbol',
    responseKey: '[0].fundingRate',
    timestampKey: '[0].fundingTime'
  },
  {
    name: 'Bybit',
    url: 'https://api.bybit.com/v5/market/funding/history',
    symbolParam: 'symbol',
    responseKey: 'result.list[0].fundingRate',
    timestampKey: 'result.list[0].fundingRateTimestamp'
  },
  {
    name: 'OKX',
    url: 'https://www.okx.com/api/v5/public/funding-rate',
    symbolParam: 'instId',
    responseKey: 'data[0].fundingRate',
    timestampKey: 'data[0].fundingTime'
  },
  {
    name: 'BitMEX',
    url: 'https://www.bitmex.com/api/v1/funding',
    symbolParam: 'symbol',
    responseKey: '[0].fundingRate',
    timestampKey: '[0].timestamp'
  },
  {
    name: 'Deribit',
    url: 'https://www.deribit.com/api/v2/public/get_funding_rate_value',
    symbolParam: 'instrument_name',
    responseKey: 'result',
    timestampKey: '' // Current time
  }
];

// Exchange weighting based on open interest
const EXCHANGE_WEIGHTS: Record<string, number> = {
  'Binance': 0.35,
  'Bybit': 0.25,
  'OKX': 0.20,
  'BitMEX': 0.15,
  'Deribit': 0.05
};

interface FundingRateRecord {
  exchange: string;
  symbol: string;
  fundingRate: number; // As decimal percentage
  timestamp: number;
  nextFundingTime?: number;
}

interface SentimentResult {
  overallSentiment: string;
  score: number;
  exchangeDetails: Record<string, {
    fundingRate: number;
    sentiment: string;
    weight: number;
  }>;
  timestamp: number;
}

export class FundingRateAnalyzer {
  private http: AxiosInstance;
  private symbol: string;
  private interval: NodeJS.Timeout | null = null;
  private currentSentiment: SentimentResult | null = null;

  constructor(symbol: string = 'ETH-USDT') {
    this.symbol = symbol;
    this.http = axios.create();
  }

  async fetchAllFundingRates(): Promise<FundingRateRecord[]> {
    const results: FundingRateRecord[] = [];
    
    for (const exchange of EXCHANGES) {
      try {
        const params: Record<string, string> = {
          [exchange.symbolParam]: this.getSymbolForExchange(exchange.name),
          limit: '1'
        };
        
        // Exchange-specific parameter adjustments
        if (exchange.name === 'Bybit') {
          params['category'] = 'linear';
        } else if (exchange.name === 'BitMEX') {
          params['count'] = '1';
          delete params['limit'];
        } else if (exchange.name === 'Deribit') {
          delete params['limit'];
        }
        
        const response = await this.http.get(exchange.url, { params });
        const data = response.data;
        
        // Extract funding rate using path resolver
        let fundingRate = getValueByPath(data, exchange.responseKey);
        if (fundingRate === undefined) {
          throw new Error(`Value not found at path: ${exchange.responseKey}`);
        }
        
        // Extract timestamp if available
        let timestamp = Date.now();
        if (exchange.timestampKey) {
          const tsValue = getValueByPath(data, exchange.timestampKey);
          if (tsValue !== undefined) {
            timestamp = typeof tsValue === 'string' ? 
              Date.parse(tsValue) : tsValue;
          }
        }
        
        // Convert percentage strings to decimals
        if (typeof fundingRate === 'string') {
          if (fundingRate.includes('%')) {
            fundingRate = parseFloat(fundingRate.replace('%', '')) / 100;
          } else {
            fundingRate = parseFloat(fundingRate);
          }
        }
        
        results.push({
          exchange: exchange.name,
          symbol: this.symbol,
          fundingRate,
          timestamp
        });
        
      } catch (error) {
        console.error(`Error fetching from ${exchange.name}:`, getErrorMessage(error));
      }
    }
    
    return results;
  }

  private getSymbolForExchange(exchangeName: string): string {
    // Map our symbol to exchange-specific symbols
    const symbolMap: Record<string, string> = {
      'Binance': 'ETHUSDT',
      'Bybit': 'ETHUSDT',
      'OKX': 'ETH-USDT-SWAP',
      'BitMEX': 'ETHUSD',
      'Deribit': 'ETH-PERPETUAL'
    };
    
    return symbolMap[exchangeName] || this.symbol;
  }

  analyzeSentiment(records: FundingRateRecord[]): SentimentResult {
    let weightedSum = 0;
    let totalWeight = 0;
    const exchangeDetails: Record<string, any> = {};
    
    for (const record of records) {
      const weight = EXCHANGE_WEIGHTS[record.exchange] || 0.1;
      const sentimentScore = this.fundingRateToScore(record.fundingRate);
      
      weightedSum += sentimentScore * weight;
      totalWeight += weight;
      
      exchangeDetails[record.exchange] = {
        fundingRate: record.fundingRate,
        sentiment: this.scoreToSentiment(sentimentScore),
        weight
      };
    }
    
    const weightedAverage = totalWeight > 0 ? weightedSum / totalWeight : 0;
    
    return {
      overallSentiment: this.scoreToSentiment(weightedAverage),
      score: weightedAverage,
      exchangeDetails,
      timestamp: Date.now()
    };
  }

  private fundingRateToScore(rate: number): number {
    // Map funding rate to -1 (bearish) to 1 (bullish) scale
    // The curve is steeper at extremes to capture strong sentiment signals
    
    // Extremely negative funding (< -0.1%)
    if (rate < -0.001) return -1 + (0.5 * (rate + 0.001) / 0.001);
    
    // Moderately negative funding (-0.1% to 0%)
    if (rate < 0) return -1 + (rate + 0.001) / 0.001;
    
    // Moderately positive funding (0% to 0.1%)
    if (rate < 0.001) return rate / 0.001;
    
    // Extremely positive funding (> 0.1%)
    return 1 + (0.5 * (rate - 0.001) / 0.001);
  }

  private scoreToSentiment(score: number): string {
    if (score < -0.8) return 'Extreme Bearish';
    if (score < -0.5) return 'Strong Bearish';
    if (score < -0.2) return 'Moderate Bearish';
    if (score < 0.2) return 'Neutral';
    if (score < 0.5) return 'Moderate Bullish';
    if (score < 0.8) return 'Strong Bullish';
    return 'Extreme Bullish';
  }

  async start(intervalMinutes: number = 5) {
    await this.updateSentiment();
    this.interval = setInterval(
      () => this.updateSentiment(), 
      intervalMinutes * 60 * 1000
    );
  }

  private async updateSentiment() {
    try {
      const records = await this.fetchAllFundingRates();
      this.currentSentiment = this.analyzeSentiment(records);
      this.logCurrentSentiment();
    } catch (error) {
      console.error('Failed to update funding rate sentiment:', error);
    }
  }

  private logCurrentSentiment() {
    if (!this.currentSentiment) return;
    
    const { overallSentiment, score, exchangeDetails } = this.currentSentiment;
    console.log(`\n📊 [${new Date().toISOString()}] Funding Rate Sentiment: ${overallSentiment} (${score.toFixed(3)})`);
    console.log('📈 Exchange Details:');
    
    for (const [exchange, details] of Object.entries(exchangeDetails)) {
      console.log(`  - ${exchange.padEnd(8)}: ${(details.fundingRate * 100).toFixed(4)}% (${details.sentiment}) [Weight: ${details.weight}]`);
    }
  }

  getCurrentSentiment(): SentimentResult | null {
    return this.currentSentiment;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      console.log('🛑 Funding rate analysis stopped');
    }
  }
}

// Create and start the analyzer
const analyzer = new FundingRateAnalyzer('ETH-USDT');
analyzer.start(5); // Update every 5 minutes

// Create health and data server
const server = createServer(async (req, res) => {
  if (req.url === '/sentiment') {
    const sentiment = analyzer.getCurrentSentiment();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sentiment || { error: 'No data available yet' }));
  } else {
    res.writeHead(200);
    res.end('Funding Rate Sentiment Analyzer');
  }
});

const PORT = 3004;
server.listen(PORT, () => {
  console.log(`✅ Funding Rate Analyzer running on port ${PORT}`);
  console.log('🔍 Starting initial data collection...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down funding rate analyzer...');
  analyzer.stop();
  server.close();
  process.exit(0);
});