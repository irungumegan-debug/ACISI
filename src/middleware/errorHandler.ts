import { ErrorRequestHandler } from 'express';
import { logger } from '../utils/logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled request error');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
};
