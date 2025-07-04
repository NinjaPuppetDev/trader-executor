import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import { AppDataSource } from "./shared/database";
import { PriceDetectionLog, TradeExecutionLog } from "./shared/entities";

const typeDefs = `#graphql
  type TradeExecutionLog {
    id: ID!
    sourceLogId: String!
    status: String!
    tokenIn: String!
    tokenOut: String!
    amount: String!
    createdAt: String!
    txHash: String
    gasUsed: String
    tokenInDecimals: Int!
    tokenOutDecimals: Int!
    amountIn: String
    minAmountOut: String
    actualAmountOut: String
    error: String
  }

  type PriceDetectionLog {
    id: ID!
    spikePercent: Float!
    tokenIn: String!
    tokenOut: String!
    confidence: String
    amount: String
    createdAt: String!
    eventTxHash: String
    eventBlockNumber: Int
    status: String!
    decision: String
    fgi: Float
    fgiClassification: String
  }

  type Query {
    trades: [TradeExecutionLog!]!
    detections: [PriceDetectionLog!]!
    recentDetections(limit: Int): [PriceDetectionLog!]!
  }

  type Mutation {
    logTrade(entry: TradeInput!): Boolean!
    logDetection(entry: DetectionInput!): Boolean!
  }

  input TradeInput {
    id: ID!
    sourceLogId: String!
    status: String!
    tokenIn: String!
    tokenOut: String!
    amount: String!
    tokenInDecimals: Int!
    tokenOutDecimals: Int!
    txHash: String
    gasUsed: String
    amountIn: String
    minAmountOut: String
    actualAmountOut: String
    error: String
  }

  input DetectionInput {
    id: ID!
    spikePercent: Float!
    tokenIn: String!
    tokenOut: String!
    confidence: String
    amount: String
    eventTxHash: String
    eventBlockNumber: Int
    createdAt: String!
    status: String!
    decision: String
    fgi: Float
    fgiClassification: String
  }
`;

const resolvers = {
  Query: {
    trades: async () => {
      const repo = AppDataSource.getRepository(TradeExecutionLog);
      return repo.find({
        order: { createdAt: "DESC" },
        take: 100
      });
    },
    detections: async () => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      return repo.find({
        order: { createdAt: "DESC" },
        take: 100
      });
    },
    recentDetections: async (_: any, { limit = 10 }: any) => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      return repo.find({
        order: { createdAt: "DESC" },
        take: limit
      });
    }
  },
  Mutation: {
    logTrade: async (_: any, { entry }: any) => {
      const repo = AppDataSource.getRepository(TradeExecutionLog);
      const log = new TradeExecutionLog();
      Object.assign(log, entry);
      await repo.save(log);
      return true;
    },
    logDetection: async (_: any, { entry }: any) => {
      const repo = AppDataSource.getRepository(PriceDetectionLog);
      const log = new PriceDetectionLog();
      Object.assign(log, entry);
      await repo.save(log);
      return true;
    }
  }
};

const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = http.createServer(app);

// Enhanced health check with CORS headers
app.get('/health', async (_, res) => {
  const dbStatus = AppDataSource.isInitialized ? "connected" : "disconnected";
  const status = dbStatus === "connected" ? "ok" : "degraded";

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status,
    services: ['graphql-gateway'],
    database: dbStatus
  });
});

const server = new ApolloServer({
  schema,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })]
});

async function startServer() {
  // Initialize database first with better logging
  try {
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    // Verify we can query the database
    const detectionsCount = await AppDataSource.getRepository(PriceDetectionLog).count();
    const tradesCount = await AppDataSource.getRepository(TradeExecutionLog).count();
    console.log(`📊 Database contains ${detectionsCount} price detections and ${tradesCount} trades`);
  } catch (error) {
    console.error("❌ Database connection failed", error);
    process.exit(1);
  }

  await server.start();

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
      context: async ({ req }) => ({ token: req.headers.token })
    })
  );

  // Add error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Gateway Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = 4000;
  httpServer.listen(PORT, () => {
    console.log(`🚀 Gateway server running at http://localhost:${PORT}/graphql`);
    console.log(`🩺 Health check available at http://localhost:${PORT}/health`);
  });
}

startServer();