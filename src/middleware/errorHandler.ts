import { ErrorRequestHandler } from 'express';
import { logger, safeErrorForLog } from '../utils/logger';
import { pathWithoutQuery } from './requestLogger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Name, code and code location only: a database error's message can echo
  // the values it was given (names, phone numbers).
  logger.error({ err: safeErrorForLog(err), method: req.method, path: pathWithoutQuery(req.originalUrl) }, 'Unhandled request error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
};
