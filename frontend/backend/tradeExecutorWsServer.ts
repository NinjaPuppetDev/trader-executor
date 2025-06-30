import WebSocket from 'isomorphic-ws';
import { readFile } from 'fs/promises';
import path from 'path';
import { TradeExecutionLog } from './types';
import net from 'net';
import { allocatePort, releasePort } from './shared/portManager';
import http from 'http';
import crypto from 'crypto';

const SERVICE_NAME = 'tradeExecutorWs';
const LOGS_FILE = path.join(__dirname, 'logs', 'executed-trades.json');
let wss: WebSocket.Server | null = null;
let allocatedPort: number | null = null;
const activeConnections = new Set<WebSocket>();
let healthServer: http.Server;
const VERSION = 'v1.trade-executor';

function checkPortAvailability(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

function startHealthServer(port: number) {
  healthServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connections: activeConnections.size,
      version: VERSION
    }));
  });

  healthServer.listen(port, '127.0.0.1', () => {
    console.log(`🩺 Health server on http://127.0.0.1:${port}`);
  });
}

async function startServer() {
  try {
    allocatedPort = await allocatePort(SERVICE_NAME);
    const healthPort = await allocatePort(`${SERVICE_NAME}-health`);

    console.log(`🔌 Allocated port ${allocatedPort} for ${SERVICE_NAME}`);
    startHealthServer(healthPort);

    if (!await checkPortAvailability(allocatedPort)) {
      throw new Error(`Port ${allocatedPort} not available`);
    }

    wss = new WebSocket.Server({
      port: allocatedPort,
      host: '127.0.0.1',
      // Verify client function
      verifyClient: (_info: any, done: (arg0: boolean) => void) => {
        // Allow all connections for development
        done(true);
      }
    });

    console.log(`📡 Trade Executor WS started on ws://127.0.0.1:${allocatedPort} (${VERSION})`);
    setupEventHandlers();

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    if (allocatedPort) releasePort(allocatedPort);
    setTimeout(startServer, 3000);
  }
}

function broadcastTradeExecution(log: TradeExecutionLog) {
  if (!wss) return;

  const message = JSON.stringify({
    type: 'tradeExecution',
    data: log
  });

  let count = 0;
  activeConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      count++;
    }
  });

  console.log(`📤 Broadcast trade to ${count} clients`);
}

function setupEventHandlers() {
  if (!wss) return;

  wss.on('connection', (ws: WebSocket) => {
    console.log(`🔌 New trade connection (${activeConnections.size + 1} total)`);
    activeConnections.add(ws);

    // Add unique connection ID
    const connId = crypto.randomBytes(4).toString('hex');
    (ws as any).connId = connId;

    // Heartbeat
    let isAlive = true;
    const heartbeatInterval = setInterval(() => {
      if (!isAlive) {
        console.log(`💔 Heartbeat failed for ${connId}`);
        ws.close(1000, 'Heartbeat timeout');
        return;
      }
      isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('pong', () => {
      isAlive = true;
    });

    // Handle ping messages
    ws.on('message', (data: { toString: () => string; }) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    });

    // Initial data
    readFile(LOGS_FILE, 'utf-8')
      .then(content => {
        const logs: TradeExecutionLog[] = content.trim() ? JSON.parse(content) : [];
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'initialTrades',
            data: logs.slice(0, 50)
          }));
          console.log(`📩 Sent initial ${logs.length} trades to ${connId}`);
        }
      })
      .catch(err => {
        console.error('Trade log error:', err);
      });

    ws.on('close', () => {
      console.log(`🔌 Trade connection closed (${activeConnections.size - 1} remain) [${connId}]`);
      activeConnections.delete(ws);
      clearInterval(heartbeatInterval);
    });
  });

  wss.on('error', (err: Error) => {
    console.error('Trade server error:', err);
    if (err.message.includes('EADDRINUSE') && allocatedPort) {
      console.warn('⚠️ Trade port conflict, restarting...');
      releasePort(allocatedPort);
      allocatedPort = null;
      setTimeout(startServer, 1000);
    }
  });
}

async function shutdown() {
  console.log('\n🛑 Shutting down Trade Executor WS');

  activeConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutdown');
    }
  });
  activeConnections.clear();

  if (wss) {
    wss.close(() => {
      console.log('🔌 Trade WebSocket closed');
      if (allocatedPort) {
        releasePort(allocatedPort);
        console.log(`♻️ Released trade port ${allocatedPort}`);
      }
    });
  }

  if (healthServer) {
    healthServer.close();
  }
}

// Start server
startServer();

// Monitoring
setInterval(() => {
  console.log(`📊 [${SERVICE_NAME}] Connections: ${activeConnections.size}`);
}, 60000);

// Process handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('❗ Uncaught Exception:', err);
  shutdown();
});