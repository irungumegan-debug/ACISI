// Each test loads the whole app (every route and service), which can take
// several seconds when the machine is busy.
jest.setTimeout(30_000);

import request from 'supertest';
import type { Express } from 'express';

/** Builds the real app with USSD_ENABLED set as given (env.ts reads it once, at import). */
function appWith(flag: string | undefined): Express {
  const previous = process.env.USSD_ENABLED;
  if (flag === undefined) delete process.env.USSD_ENABLED;
  else process.env.USSD_ENABLED = flag;
  let app!: Express;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require('../../src/app').createApp();
  });
  if (previous === undefined) delete process.env.USSD_ENABLED;
  else process.env.USSD_ENABLED = previous;
  return app;
}

describe('USSD switch (C9)', () => {
  it('is off by default: /api/ussd answers 404 and no USSD menu runs', async () => {
    const res = await request(appWith(undefined)).post('/api/ussd').type('form').send({ sessionId: 's1', phoneNumber: '+254712345678', text: '' });
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Welcome to ACISI');
  });

  it('stays off for any value other than "true"', async () => {
    const res = await request(appWith('false')).post('/api/ussd').type('form').send({ sessionId: 's1', phoneNumber: '+254712345678', text: '' });
    expect(res.status).toBe(404);
  });

  it('is mounted again when USSD_ENABLED=true (a bad request reaches the USSD router)', async () => {
    const res = await request(appWith('true')).post('/api/ussd').type('form').send({});
    expect(res.status).toBe(400);
    expect(res.text).toBe('END Invalid request.');
  });

  it('does not announce the server software', async () => {
    const res = await request(appWith(undefined)).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
