import pino from 'pino';
import { env } from '../config/env';

/**
 * An error reduced to its name, code and where it happened (stack frames
 * only). The message is left out on purpose: a database or HTTP error's
 * message can echo the data it was given (a name, a phone number, an M-Pesa
 * code), which must never reach the logs.
 */
export function safeErrorForLog(err: unknown): { name: string; code?: string; at?: string[] } {
  if (!(err instanceof Error)) return { name: typeof err };
  const code = (err as { code?: unknown }).code;
  const at = (err.stack ?? '')
    .split('\n')
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 8)
    .map((line) => line.trim());
  return { name: err.name, ...(typeof code === 'string' ? { code } : {}), ...(at.length ? { at } : {}) };
}

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  // Every `logger.x({ err }, ...)` call goes through this, so no call site
  // can log an error message by accident.
  serializers: { err: safeErrorForLog },
  redact: {
    // Never let PII or secrets leak into logs, even if a caller passes them in.
    paths: [
      'req.headers',
      'req.query',
      'req.remoteAddress',
      '*.cookie',
      '*.pinHash',
      '*.pin',
      '*.mpesaConsumerSecret',
      '*.password',
      '*.phoneNumber',
      '*.phone',
      '*.receipt',
      '*.body',
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
