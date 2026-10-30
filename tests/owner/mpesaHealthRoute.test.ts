import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/owner/session', () => ({
  ...jest.requireActual('../../src/owner/session'),
  loadOwnerSession: jest.fn(),
}));
jest.mock('../../src/services/mpesaHealth', () => ({ getMpesaHealth: jest.fn() }));

import { loadOwnerSession, OWNER_SESSION_COOKIE_NAME } from '../../src/owner/session';
import { getMpesaHealth } from '../../src/services/mpesaHealth';
import { ownerRouter } from '../../src/owner/router';

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/owner', ownerRouter);
  return app;
}

describe('owner page: M-Pesa prompt warning (C20)', () => {
  it('gives the owner the failure count and the time of the last successful payment', async () => {
    (loadOwnerSession as jest.Mock).mockResolvedValue({ ownerId: 'owner-1', email: 'o@x.co', name: 'Owner' });
    const health = {
      failing: true,
      consecutiveFailures: 3,
      failingSince: '2026-11-02T07:00:00.000Z',
      lastSuccessAt: '2026-11-02T06:58:00.000Z',
      threshold: 3,
    };
    (getMpesaHealth as jest.Mock).mockResolvedValue(health);
    const res = await request(buildApp())
      .get('/owner/overview/mpesa-health')
      .set('Cookie', `${OWNER_SESSION_COOKIE_NAME}=tok`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(health);
  });

  it('owner only', async () => {
    (loadOwnerSession as jest.Mock).mockResolvedValue(null);
    expect((await request(buildApp()).get('/owner/overview/mpesa-health')).status).toBe(401);
  });
});
