import path from 'node:path';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { ussdRouter } from './ussd/router';
import { mpesaRouter } from './mpesa/router';
import { dashboardRouter } from './dashboard/router';
import { portalRouter } from './portal/router';
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
  app.use('/api/portal', portalRouter);

  if (env.NODE_ENV === 'production') {
    // Two separate SPA builds served from this same process/origin — no
    // CORS needed anywhere. The staff dashboard owns "/" (unchanged); the
    // patient portal is a second SPA (portal/dist) served under "/portal",
    // built with Vite's `base: '/portal/'` so its own asset URLs resolve
    // correctly alongside the dashboard's.
    const dashboardDist = path.join(__dirname, '../dashboard/dist');
    const portalDist = path.join(__dirname, '../portal/dist');

    app.use('/portal', express.static(portalDist));
    app.get('/portal/*', (req, res) => {
      res.sendFile(path.join(portalDist, 'index.html'));
    });

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
