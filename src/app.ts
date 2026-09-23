import fs from 'node:fs';
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
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  // Railway (and most PaaS hosts) terminate TLS at an edge proxy and forward
  // requests to this process over plain HTTP, setting X-Forwarded-Proto to
  // tell us the original scheme. Without trusting that header, req.secure is
  // always false behind such a proxy — which is what session cookies' Secure
  // flag below relies on to know whether it's actually safe to set.
  app.set('trust proxy', 1);

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

  // Two separate SPA builds, served statically from this same
  // process/origin — no CORS needed, and session cookies work the same way
  // they do in dev via each app's Vite proxy. The staff/doctor console
  // lives under /console; everything else (marketing site, signup/login,
  // patient portal) is the web/ app at the root.
  //
  // Gated on the built dist/ directories actually existing on disk, not on
  // NODE_ENV — some hosts (Railway among them) don't set NODE_ENV=production
  // unless you add it yourself, and gating this on an env var a platform
  // might silently leave at its 'development' default previously meant the
  // entire frontend (including every catch-all route) just never mounted,
  // with no error, only "Cannot GET" on every page. Checking for the actual
  // build output is what determines whether there's anything to serve.
  const webDist = path.join(__dirname, '../web/dist');
  const dashboardDist = path.join(__dirname, '../dashboard/dist');
  const hasDashboardBuild = fs.existsSync(path.join(dashboardDist, 'index.html'));
  const hasWebBuild = fs.existsSync(path.join(webDist, 'index.html'));

  if (hasDashboardBuild) {
    app.use('/console', express.static(dashboardDist));
    app.get('/console/*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  } else {
    logger.warn({ dashboardDist }, 'dashboard/dist not found — /console will 404. Did the dashboard build run?');
  }

  if (hasWebBuild) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/console')) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, 'index.html'));
    });
  } else {
    logger.warn({ webDist }, 'web/dist not found — the marketing site/patient portal will 404. Did the web build run?');
  }

  app.use(errorHandler);

  return app;
}
