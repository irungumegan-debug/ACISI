import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    // Never let PII or secrets leak into logs, even if a caller passes them in.
    paths: [
      'req.headers.authorization',
      '*.pinHash',
      '*.pin',
      '*.mpesaConsumerSecret',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * An error reduced to its name and code, for logs on payment paths: a
 * database or HTTP error's message can echo the data it was given (a phone
 * number, an M-Pesa code), which must never reach the logs.
 */
export function errorSummary(err: unknown): { name: string; code?: string } {
  const code = (err as { code?: unknown })?.code;
  return { name: err instanceof Error ? err.name : typeof err, ...(typeof code === 'string' ? { code } : {}) };
}
