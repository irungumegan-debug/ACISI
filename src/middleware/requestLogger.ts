import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import { logger } from '../utils/logger';

/**
 * Only the path, never the query string: patient search text and walk-in
 * phone lookups travel in it (e.g. /api/staff/patients?q=0712...).
 */
export function pathWithoutQuery(url: string | undefined): string {
  return (url ?? '').split('?')[0] as string;
}

/**
 * One line per request with method, path, status and timing only. No
 * headers (the Cookie header carries the login token), no query string, no
 * IP address, no body.
 */
export function buildRequestLogger(baseLogger: Logger) {
  return pinoHttp({
    logger: baseLogger,
    autoLogging: {
      ignore: (req) => req.url === '/healthz',
    },
    serializers: {
      req: (req: { method?: string; url?: string }) => ({ method: req.method, path: pathWithoutQuery(req.url) }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

export const requestLogger = buildRequestLogger(logger);
