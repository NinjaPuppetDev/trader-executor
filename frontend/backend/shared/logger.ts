// shared/logger.ts
import winston from 'winston';

// Define log levels
const logLevels = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5
};

// Create a Winston logger instance
export function getLogger(serviceName: string) {
    return winston.createLogger({
        levels: logLevels,
        level: process.env.LOG_LEVEL || 'info',
        defaultMeta: { service: serviceName },
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.splat(),
            winston.format.json()
        ),
        transports: [
            // Console transport
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(({ level, message, timestamp, stack }) => {
                        return `${timestamp} [${serviceName}] ${level}: ${stack || message}`;
                    })
                )
            }),
            // File transport
            new winston.transports.File({
                filename: `logs/${serviceName}.log`,
                maxsize: 5 * 1024 * 1024, // 5MB
                maxFiles: 7,
                tailable: true
            })
        ],
        exceptionHandlers: [
            new winston.transports.File({ filename: 'logs/exceptions.log' })
        ],
        rejectionHandlers: [
            new winston.transports.File({ filename: 'logs/rejections.log' })
        ]
    });
}

// Example usage:
// const logger = getLogger('trade-executor');
// logger.info('Starting trade executor');