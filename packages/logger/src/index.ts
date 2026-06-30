import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
  base: {
    env: process.env.NODE_ENV || "development",
  },
});

// Helper type to log structured context
export interface LogContext {
  correlationId?: string;
  userId?: number | string;
  jobId?: string;
  phase?: string;
  [key: string]: any;
}

export function logWithContext(ctx: LogContext) {
  return logger.child(ctx);
}
