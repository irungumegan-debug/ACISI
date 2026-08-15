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
