import express, { Express } from 'express';
import { ussdRouter } from './ussd/router';
import { mpesaRouter } from './mpesa/router';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Express {
  const app = express();

  app.use(requestLogger);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/ussd', ussdRouter);
  app.use('/api/mpesa', mpesaRouter);

  app.use(errorHandler);

  return app;
}
