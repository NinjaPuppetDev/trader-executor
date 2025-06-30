import WebSocket from 'isomorphic-ws';
import { readFile } from 'fs/promises';
import path from 'path';
import { PriceDetectionLogEntry } from './types';
import net from 'net';
import { allocatePort, releasePort } from './shared/portManager';
import http from 'http';
import crypto from 'crypto';

const SERVICE_NAME = 'priceTriggerFrontendWs';
const LOGS_FILE = path.join(__dirname, 'logs', 'price-detections.json');
let wss: WebSocket.Server | null = null;
let allocatedPort: number | null = null;
let allocatedHealthPort: number | null = null;
const activeConnections = new Set<WebSocket>();
let healthServer: http.Server;
let serverReady = false;
const VERSION = 'v1.price-trigger';

// Enhanced port checking with timeout
function checkPortAvailability(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            tester.close(() => resolve(false));
        }, 1000);

        const tester = net.createServer()
            .once('error', () => {
                clearTimeout(timer);
                resolve(false);
            })
            .once('listening', () => {
                clearTimeout(timer);
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
        // Allocate main port
        allocatedPort = await allocatePort(SERVICE_NAME);
        console.log(`🔌 Allocated port ${allocatedPort} for ${SERVICE_NAME}`);

        // Allocate health port
        allocatedHealthPort = await allocatePort(`${SERVICE_NAME}-health`);
        startHealthServer(allocatedHealthPort);

        // Verify port availability
        if (!await checkPortAvailability(allocatedPort)) {
            throw new Error(`Port ${allocatedPort} not available`);
        }

        wss = new WebSocket.Server({
            port: allocatedPort,
            host: '127.0.0.1',
            verifyClient: (_info: any, cb: (arg0: boolean) => void) => {
                // Allow all connections for development
                cb(true);
            }
        });

        // Set server ready flag when listening
        wss.on('listening', () => {
            serverReady = true;
            console.log(`📡 Price Trigger WS started on ws://127.0.0.1:${allocatedPort} (${VERSION})`);
        });

        setupEventHandlers();

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        serverReady = false;
        if (allocatedPort) releasePort(allocatedPort);
        if (allocatedHealthPort) releasePort(allocatedHealthPort);
        setTimeout(startServer, 3000);
    }
}

// Only return port when server is ready
export function getWsServerPort(): number | null {
    return serverReady ? allocatedPort : null;
}

function broadcastPriceUpdate(log: PriceDetectionLogEntry) {
    if (!wss) return;

    const message = JSON.stringify({
        type: 'logUpdate',
        data: log
    });

    let count = 0;
    activeConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
            count++;
        }
    });

    console.log(`📤 Broadcast to ${count} clients`);
}

function setupEventHandlers() {
    if (!wss) return;

    wss.on('connection', (ws: WebSocket) => {
        const connId = crypto.randomBytes(4).toString('hex');
        console.log(`🔌 New connection ${connId} (${activeConnections.size + 1} total)`);
        activeConnections.add(ws);

        // Heartbeat setup
        let isAlive = true;
        const heartbeatInterval = setInterval(() => {
            if (!isAlive) {
                console.log(`💔 Terminating unresponsive connection ${connId}`);
                ws.terminate();
                return;
            }
            isAlive = false;
            ws.ping();
        }, 30000);

        ws.on('pong', () => {
            isAlive = true;
        });

        // Handle ping messages from client
        ws.on('message', (data: { toString: () => string; }) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'ping') {
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: message.timestamp
                    }));
                }
            } catch (e) {
                // Ignore non-JSON messages
            }
        });

        // Send initial data
        readFile(LOGS_FILE, 'utf-8')
            .then(content => {
                const logs = content.trim() ? JSON.parse(content) : [];
                ws.send(JSON.stringify({
                    type: 'initialLogs',
                    data: logs.slice(0, 50)
                }));
            })
            .catch(err => {
                console.error('Log read error:', err);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to load logs'
                }));
            });

        ws.on('close', () => {
            console.log(`🔌 Connection ${connId} closed (${activeConnections.size - 1} remain)`);
            activeConnections.delete(ws);
            clearInterval(heartbeatInterval);
        });

        ws.on('error', (err: any) => {
            console.error(`Connection ${connId} error:`, err);
        });
    });

    wss.on('error', (err: any) => {
        console.error('Server error:', err);

        // Handle port conflicts
        if (err.message.includes('EADDRINUSE') && allocatedPort) {
            console.warn('⚠️ Port conflict detected, restarting...');
            releasePort(allocatedPort);
            allocatedPort = null;
            setTimeout(startServer, 1000);
        }
    });
}

// Graceful shutdown
async function shutdown() {
    console.log('\n🛑 Shutting down Price Trigger WS');
    serverReady = false;

    // Close all connections
    activeConnections.forEach(ws => ws.close());
    activeConnections.clear();

    // Close servers
    if (wss) {
        wss.close(() => {
            console.log('🔌 WebSocket server closed');
            if (allocatedPort) {
                releasePort(allocatedPort);
                console.log(`♻️ Released port ${allocatedPort}`);
            }
        });
    }

    if (healthServer) {
        healthServer.close(() => {
            console.log('🩺 Health server closed');
        });
    }

    // Release health port
    if (allocatedHealthPort) {
        releasePort(allocatedHealthPort);
        console.log(`♻️ Released health port ${allocatedHealthPort}`);
    }

    // Force exit after timeout
    setTimeout(() => process.exit(1), 5000).unref();
}

// Start the server
startServer();

// Status monitoring
setInterval(() => {
    console.log(`📊 [${SERVICE_NAME}] Connections: ${activeConnections.size}`);
}, 60000);

// Handle process events
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
    console.error('❗ Uncaught Exception:', err);
    shutdown();
});
process.on('unhandledRejection', (reason) => {
    console.error('❗ Unhandled Rejection:', reason);
});