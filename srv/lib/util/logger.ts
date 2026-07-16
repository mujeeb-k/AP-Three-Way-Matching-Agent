import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

export function childLogger(component: string, context?: Record<string, unknown>) {
  return logger.child({ component, ...context });
}
