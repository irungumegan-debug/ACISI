// Each test loads the whole app, which can take several seconds.
jest.setTimeout(30_000);

import request from 'supertest';
import type { Express } from 'express';

/** Builds the real app with SHA_ENABLED set as given (env.ts reads it once, at import). */
function appWith(flag: string | undefined): Express {
  const previous = process.env.SHA_ENABLED;
  if (flag === undefined) delete process.env.SHA_ENABLED;
  else process.env.SHA_ENABLED = flag;
  let app!: Express;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require('../../src/app').createApp();
  });
  if (previous === undefined) delete process.env.SHA_ENABLED;
  else process.env.SHA_ENABLED = previous;
  return app;
}

describe('SHA add-on server switch', () => {
  it('is off by default: /api/staff/sha answers 404, before any login check', async () => {
    const app = appWith(undefined);
    expect((await request(app).get('/api/staff/sha/status')).status).toBe(404);
    expect((await request(app).post('/api/staff/sha/patients/p1/eligibility')).status).toBe(404);
    expect((await request(app).post('/api/staff/sha/visits/e1/code').send({ interventionCodes: ['SHA-1'] })).status).toBe(404);
  });

  it('stays off for any value other than "true"', async () => {
    expect((await request(appWith('false')).get('/api/staff/sha/status')).status).toBe(404);
  });

  it('is mounted when SHA_ENABLED=true (asks for a staff login)', async () => {
    expect((await request(appWith('true')).get('/api/staff/sha/status')).status).toBe(401);
  });
});
