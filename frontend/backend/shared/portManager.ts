// shared/portManager.ts
import net from 'net';

// Service configuration with preferred ports
const servicePreferences: Record<string, number> = {
    priceTriggerWs: 8080,
    tradeExecutorWs: 8081,
    priceTriggerHealth: 8082
    // Add more services as needed
};

// Track allocated ports and their services
const allocatedPorts = new Map<number, string>();
const portRange = { start: 8080, end: 8100 };



// Check if a port is available at the system level
export async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();

        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') resolve(false);
            else resolve(false);
        });

        server.on('listening', () => {
            server.close(() => resolve(true));
        });

        server.listen(port);
    });
}

// Allocate a port for a service
export async function allocatePort(service: string): Promise<number> {
    // Try preferred port first
    const preferredPort = servicePreferences[service];
    if (preferredPort) {
        const isAvailable = await isPortAvailable(preferredPort);
        if (isAvailable && !allocatedPorts.has(preferredPort)) {
            allocatedPorts.set(preferredPort, service);
            console.log(`🔌 Allocated preferred port ${preferredPort} for ${service}`);
            return preferredPort;
        }
    }

    // Find first available port in range
    for (let port = portRange.start; port <= portRange.end; port++) {
        if (allocatedPorts.has(port)) continue;

        const isAvailable = await isPortAvailable(port);
        if (isAvailable) {
            allocatedPorts.set(port, service);
            console.log(`🔌 Allocated dynamic port ${port} for ${service}`);
            return port;
        }
    }

    throw new Error(`❌ No available ports in range ${portRange.start}-${portRange.end}`);
}

// Get allocated port for a service
export function getPortForService(service: string): number | undefined {
    for (const [port, serviceName] of allocatedPorts) {
        if (serviceName === service) return port;
    }
    return undefined;
}

// Release a specific port
export function releasePort(port: number): void {
    if (allocatedPorts.delete(port)) {
        console.log(`♻️ Released port ${port}`);
    } else {
        console.warn(`⚠️ Attempted to release unallocated port: ${port}`);
    }
}

// Release all ports for a service
export function releaseServicePorts(service: string): void {
    let released = 0;
    for (const [port, serviceName] of allocatedPorts) {
        if (serviceName === service) {
            allocatedPorts.delete(port);
            released++;
            console.log(`♻️ Released port ${port} for ${service}`);
        }
    }

    if (released === 0) {
        console.warn(`⚠️ No ports found to release for service: ${service}`);
    }
}

// Get all allocated ports
export function getAllocatedPorts(): Map<number, string> {
    return new Map(allocatedPorts);
}

// Validate port allocations
export async function validatePorts(): Promise<void> {
    const invalidPorts: number[] = [];

    for (const port of allocatedPorts.keys()) {
        const available = await isPortAvailable(port);
        if (available) {
            console.warn(`⚠️ Port ${port} is allocated but not in use`);
            invalidPorts.push(port);
        }
    }

    if (invalidPorts.length > 0) {
        throw new Error(`❌ ${invalidPorts.length} ports are allocated but not in use`);
    }
}

// Cleanup on process exit
process.on('exit', () => {
    if (allocatedPorts.size > 0) {
        console.warn(`⚠️ ${allocatedPorts.size} ports still allocated on exit!`);
        for (const [port, service] of allocatedPorts) {
            console.log(`  - Port ${port} allocated by ${service}`);
        }
    }
});

// Handle signals for graceful shutdown
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(signal => {
    process.on(signal, () => {
        console.log(`\n${signal} received, releasing ports...`);
        allocatedPorts.clear();
        process.exit(0);
    });
});

// Add memory leak detection
if (process.env.NODE_ENV === 'development') {
    const leakDetectionInterval = setInterval(() => {
        if (allocatedPorts.size > 10) {
            console.warn(`⚠️ Possible port leak detected: ${allocatedPorts.size} ports allocated`);
        }
    }, 60000); // Check every minute

    // Cleanup interval on exit
    process.on('exit', () => clearInterval(leakDetectionInterval));
}