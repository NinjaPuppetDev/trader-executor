import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import { DataSource } from 'typeorm';
import {
  PriceDetectionLog,
  TradeExecutionLog,
  ApiDebugLog,
  RiskPosition,
  ProcessedTrigger
} from './shared/entities';

// ======================
// Database Initialization
// ======================
const AppDataSource = new DataSource({
  type: "sqlite",
  database: "data/trading-db.sqlite",
  entities: [PriceDetectionLog, TradeExecutionLog, ApiDebugLog, RiskPosition, ProcessedTrigger],
  synchronize: true,
  logging: false
});

// ======================
// GraphQL Type Definitions
// ======================
const typeDefs = `#graphql
  type TradeExecutionLog {
    id: ID!
    source: String!
    sourceType: String!
    type: String!
    timestamp: String!
    sourceLogId: String!
    decision: String!
    status: String!
    tokenIn: String!
    tokenOut: String!
    amount: String!
    tokenInDecimals: Int!
    tokenOutDecimals: Int!
    pairId: Int!
    stopLoss: Float
    takeProfit: Float
    amountIn: String
    minAmountOut: String
    actualAmountOut: String
    txHash: String
    gasUsed: String
    error: String
    positionId: String
    entryPrice: String
    createdAt: String!
  }

  type PriceDetectionLog {
    id: ID!
    type: String!
    pairId: Int!
    timestamp: String!
    priceContext: String
    decision: String!
    decisionLength: Int!
    status: String!
    createdAt: String!
    spikePercent: Float!
    eventTxHash: String!
    eventBlockNumber: Int!
    fgi: Float
    fgiClassification: String
    tokenIn: String!
    tokenOut: String!
    confidence: String!
    amount: String!
    stopLoss: Float
    takeProfit: Float
    error: String
    positionId: String
    tradeTxHash: String
    riskManagerTxHash: String
    entryPrice: String
    bayesianAnalysis: BayesianRegressionResult
  }

  type ApiDebugLog {
    id: ID!
    timestamp: String!
    prompt: String!
    rawResponse: String
    parsedDecision: String
    error: String
  }

  type RiskPosition {
    id: ID!
    trader: String!
    isLong: Boolean!
    amount: String!
    entryPrice: String!
    stopLoss: Float!
    takeProfit: Float!
    status: String!
    createdAt: String!
    lastUpdated: String!
    closedAt: String
    closedAmount: String
    closedReason: String
  }

  type ProcessedTrigger {
    id: ID!
    pairId: Int!
  }

  type BayesianRegressionResult {
    predictedPrice: Float
    confidenceInterval: [Float]
    stopLoss: Float
    takeProfit: Float
    trendDirection: String
    volatility: Float
    variance: Float
  }

  type Query {
    trades(limit: Int = 100): [TradeExecutionLog!]!
    detections(limit: Int = 100): [PriceDetectionLog!]!
    debugLogs(limit: Int = 50): [ApiDebugLog!]!
    riskPositions(status: String = "active"): [RiskPosition!]!
    processedTriggers: [ProcessedTrigger!]!
    getDetection(id: ID!): PriceDetectionLog
    getTrade(id: ID!): TradeExecutionLog
    getRiskPosition(id: ID!): RiskPosition
  }

  type Mutation {
    logTrade(entry: TradeInput!): Boolean!
    logDetection(entry: DetectionInput!): Boolean!
    logDebug(entry: DebugInput!): Boolean!
  }

  input TradeInput {
    id: ID!
    source: String
    sourceType: String
    type: String
    timestamp: String
    sourceLogId: String!
    decision: String!
    status: String!
    tokenIn: String!
    tokenOut: String!
    amount: String!
    tokenInDecimals: Int!
    tokenOutDecimals: Int!
    pairId: Int!
    stopLoss: Float
    takeProfit: Float
    amountIn: String
    minAmountOut: String
    actualAmountOut: String
    txHash: String
    gasUsed: String
    error: String
    positionId: String
    entryPrice: String
    createdAt: String
  }

  input DetectionInput {
    id: ID!
    type: String
    pairId: Int!
    timestamp: String
    priceContext: String
    decision: String!
    decisionLength: Int!
    status: String!
    createdAt: String
    spikePercent: Float!
    eventTxHash: String!
    eventBlockNumber: Int!
    fgi: Float
    fgiClassification: String
    tokenIn: String!
    tokenOut: String!
    confidence: String!
    amount: String!
    stopLoss: Float
    takeProfit: Float
    error: String
    positionId: String
    tradeTxHash: String
    riskManagerTxHash: String
    entryPrice: String
    bayesianAnalysis: BayesianRegressionInput
  }
  
  input BayesianRegressionInput {
    predictedPrice: Float
    confidenceInterval: [Float]
    stopLoss: Float
    takeProfit: Float
    trendDirection: String
    volatility: Float
    variance: Float
  }

  input DebugInput {
    id: ID!
    timestamp: String
    prompt: String!
    rawResponse: String
    parsedDecision: String
    error: String
  }
`;

// ======================
// GraphQL Resolvers
// ======================
const resolvers = {
  Query: {
    trades: async (_: any, { limit }: { limit: number }) => {
      const repo = AppDataSource.getRepository(TradeExecutionLog);
      return repo.find({
        order: { createdAt: "DESC" },
        take: limit
      });
    },

    detections: async (_: any, { limit }: { limit: number }) => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      return repo.find({
        order: { createdAt: "DESC" },
        take: limit
      });
    },

    debugLogs: async (_: any, { limit }: { limit: number }) => {
      const repo = AppDataSource.getRepository(ApiDebugLog);
      return repo.find({
        order: { timestamp: "DESC" },
        take: limit
      });
    },

    riskPositions: async (_: any, { status }: { status: string }) => {
      const repo = AppDataSource.getRepository(RiskPosition);
      return repo.find({
        where: { status: status as 'active' | 'closed' | 'liquidated' },
        order: { createdAt: "DESC" }
      });
    },

    processedTriggers: async () => {
      const repo = AppDataSource.getRepository(ProcessedTrigger);
      return repo.find();
    },

    getDetection: async (_: any, { id }: { id: string }) => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      return repo.findOneBy({ id });
    },

    getTrade: async (_: any, { id }: { id: string }) => {
      const repo = AppDataSource.getRepository(TradeExecutionLog);
      return repo.findOneBy({ id });
    },

    // NEW: Get single risk position by ID
    getRiskPosition: async (_: any, { id }: { id: string }) => {
      const repo = AppDataSource.getRepository(RiskPosition);
      return repo.findOneBy({ id });
    }
  },

  Mutation: {
    logTrade: async (_: any, { entry }: any) => {
      const repo = AppDataSource.getRepository(TradeExecutionLog);
      const log = new TradeExecutionLog();

      // Apply defaults for optional fields
      Object.assign(log, {
        source: "trade-execution",
        sourceType: "price-detections",
        type: "trade-execution",
        createdAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        ...entry
      });

      await repo.save(log);
      return true;
    },

    logDetection: async (_: any, { entry }: any) => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      const log = new PriceDetectionLog();

      // Apply defaults for optional fields
      Object.assign(log, {
        type: "price-detections",
        createdAt: new Date().toISOString(),
        decisionLength: entry.decision?.length || 0,
        bayesianAnalysis: entry.bayesianAnalysis,
        ...entry
      });

      await repo.save(log);
      return true;
    },

    logDebug: async (_: any, { entry }: any) => {
      const repo = AppDataSource.getRepository(ApiDebugLog);
      const log = new ApiDebugLog();

      // Apply defaults for optional fields
      Object.assign(log, {
        timestamp: new Date().toISOString(),
        ...entry
      });

      await repo.save(log);
      return true;
    }
  }
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

// ======================
// Express Server Setup
// ======================
const app = express();
const httpServer = http.createServer(app);

// Basic information endpoint
app.get('/', (_, res) => {
  res.json({
    service: 'Trading System Gateway',
    version: '3.1',
    routes: ['/graphql', '/health'],
    entities: [
      'PriceDetectionLog',
      'TradeExecutionLog',
      'ApiDebugLog',
      'RiskPosition',
      'ProcessedTrigger'
    ]
  });
});

// Health check endpoint
app.get('/health', async (_, res) => {
  let dbStatus = "disconnected";
  let riskPositionCount = 0;
  let triggerCount = 0;

  try {
    if (AppDataSource.isInitialized) {
      dbStatus = "connected";

      // Get counts for all entities
      const riskRepo = AppDataSource.getRepository(RiskPosition);
      const triggerRepo = AppDataSource.getRepository(ProcessedTrigger);

      riskPositionCount = await riskRepo.count();
      triggerCount = await triggerRepo.count();
    }
  } catch (e) {
    dbStatus = "error";
  }

  const status = dbStatus === "connected" ? "ok" : "degraded";

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status,
    services: ['graphql-gateway', 'database'],
    database: dbStatus,
    entityCounts: {
      riskPositions: riskPositionCount,
      processedTriggers: triggerCount
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.options('/health', cors(), (_, res) => res.sendStatus(200));

// ======================
// Apollo Server Setup
// ======================
const server = new ApolloServer({
  schema,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  formatError: (error) => {
    console.error('GraphQL Error:', error);
    return {
      message: error.message,
      code: error.extensions?.code || 'INTERNAL_SERVER_ERROR',
      path: error.path
    };
  }
});

// ======================
// Server Startup
// ======================
async function startServer() {
  console.log("⏳ Initializing database connection...");

  try {
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    // Verify all entity repositories
    const repos = {
      detections: AppDataSource.getRepository(PriceDetectionLog),
      trades: AppDataSource.getRepository(TradeExecutionLog),
      debugLogs: AppDataSource.getRepository(ApiDebugLog),
      riskPositions: AppDataSource.getRepository(RiskPosition),
      processedTriggers: AppDataSource.getRepository(ProcessedTrigger)
    };

    console.log("📊 Database Stats:");
    for (const [name, repo] of Object.entries(repos)) {
      try {
        const count = await repo.count();
        console.log(`- ${name}: ${count}`);
      } catch (e) {
        console.error(`⚠️ Could not count ${name}:`, (e as Error).message);
      }
    }

  } catch (error) {
    console.error("❌ Database connection failed", error);
    process.exit(1);
  }

  await server.start();
  console.log("🚀 Apollo Server started");

  // GraphQL middleware
  app.use(
    '/graphql',
    cors<cors.CorsRequest>({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }),
    bodyParser.json(),
    expressMiddleware(server, {
      context: async ({ req }) => ({
        authToken: req.headers.authorization,
        ip: req.ip
      })
    })
  );

  // Error handling middleware
  app.use((
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('🚨 Gateway Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = process.env.PORT || 4000;
  httpServer.listen(PORT, () => {
    console.log(`🌐 Gateway server running at http://localhost:${PORT}/graphql`);
    console.log(`🩺 Health check available at http://localhost:${PORT}/health`);
    console.log(`📚 GraphQL Playground: http://localhost:${PORT}/graphql`);
  });
}

// ======================
// Graceful Shutdown
// ======================
process.on('SIGINT', async () => {
  console.log('\n🔴 Received shutdown signal');
  try {
    await server.stop();
    console.log('🛑 Apollo Server stopped');
  } catch (e) {
    console.error('Error stopping Apollo Server:', e);
  }

  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('🛑 Database connection closed');
    }
  } catch (e) {
    console.error('Error closing database connection:', e);
  }

  httpServer.close(() => {
    console.log('🛑 HTTP Server terminated gracefully');
    process.exit(0);
  });
});

// Start the server
startServer().catch(err => {
  console.error('🔥 Critical startup failure:', err);
  process.exit(1);
});