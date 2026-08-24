import path from 'node:path';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { ussdRouter } from './ussd/router';
import { mpesaRouter } from './mpesa/router';
import { dashboardRouter } from './dashboard/router';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';

export function createApp(): Express {
  const app = express();

  app.use(requestLogger);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/ussd', ussdRouter);
  app.use('/api/mpesa', mpesaRouter);
  app.use('/api/staff', dashboardRouter);

  if (env.NODE_ENV === 'production') {
    // The dashboard SPA is a separate build (dashboard/dist), served
    // statically from this same process/origin — no CORS needed, and the
    // staff session cookie works the same way it does in dev via the Vite
    // proxy.
    const dashboardDist = path.join(__dirname, '../dashboard/dist');
    app.use(express.static(dashboardDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
