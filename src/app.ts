import path from 'node:path';
import express, { Express } from 'express';
// Patches Express's shared Router/Route prototypes so a rejected promise
// from an async route handler is forwarded to errorHandler below instead of
// becoming an unhandled rejection that crashes the process — Express 4
// doesn't do this itself (Express 5 does), and virtually every handler in
// this codebase is `async (req, res) => ...` with no try/catch.
import 'express-async-errors';
import cookieParser from 'cookie-parser';
import { ussdRouter } from './ussd/router';
import { mpesaRouter } from './mpesa/router';
import { dashboardRouter } from './dashboard/router';
import { portalRouter } from './portal/router';
import { clinicsRouter } from './clinics/router';
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
  app.use('/api/patients', portalRouter);
  app.use('/api/clinics', clinicsRouter);

  if (env.NODE_ENV === 'production') {
    // Two separate SPA builds, served statically from this same
    // process/origin — no CORS needed, and session cookies work the same
    // way they do in dev via each app's Vite proxy. The staff/doctor
    // console lives under /console; everything else (marketing site,
    // signup/login, patient portal) is the web/ app at the root.
    const webDist = path.join(__dirname, '../web/dist');
    const dashboardDist = path.join(__dirname, '../dashboard/dist');

    app.use('/console', express.static(dashboardDist));
    app.get('/console/*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });

    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
