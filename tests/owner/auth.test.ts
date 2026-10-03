import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const mockRedisStore = new Map<string, string>();

jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(mockRedisStore.get(key) ?? 0) + 1;
      mockRedisStore.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
  },
}));

jest.mock('../../src/services/ownerService', () => ({
  ...jest.requireActual('../../src/services/ownerService'),
  authenticateOwner: jest.fn(),
}));

import { authenticateOwner } from '../../src/services/ownerService';
import { ownerRouter } from '../../src/owner/router';
import { OWNER_SESSION_COOKIE_NAME } from '../../src/owner/session';
import { revokeSessionsFor } from '../../src/services/sessionRevocation';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockAuthenticate = authenticateOwner as jest.Mock;

const OWNER = { id: 'owner-1', email: 'boss@acisi.co.ke', name: 'The Owner' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/owner', ownerRouter);
  return app;
}

function sessionCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((c) => c.startsWith(`${OWNER_SESSION_COOKIE_NAME}=`));
  if (!cookie) throw new Error('no session cookie set');
  return cookie.split(';')[0]!;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockRedisStore.clear();
});

describe('POST /owner/auth/login', () => {
  it('rejects a wrong email or password with a generic message', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await request(buildApp()).post('/owner/auth/login').send({ email: 'x@y.z', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('sets a strict, httpOnly session cookie on success', async () => {
    mockAuthenticate.mockResolvedValue(OWNER);
    const res = await request(buildApp()).post('/owner/auth/login').send({ email: OWNER.email, password: 'correct horse battery' });
    expect(res.status).toBe(200);
    const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
  });

  it('locks the email out after too many failures, regardless of case', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const app = buildApp();
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await request(app).post('/owner/auth/login').send({ email: 'Boss@ACISI.co.ke', password: 'wrong' });
    }
    mockAuthenticate.mockResolvedValue(OWNER);
    const res = await request(app).post('/owner/auth/login').send({ email: 'boss@acisi.co.ke', password: 'right' });
    expect(res.status).toBe(429);
  });
});

describe('owner-only routes', () => {
  it('refuse requests without an owner session', async () => {
    for (const path of ['/owner/overview', '/owner/clinics', '/owner/clinics/c-1', '/owner/activity']) {
      const res = await request(buildApp()).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('refuse a staff or patient session cookie', async () => {
    const res = await request(buildApp()).get('/owner/clinics').set('Cookie', 'acisi_staff_session=abc; acisi_patient_session=def');
    expect(res.status).toBe(401);
  });

  it('accept a live owner session, and stop accepting it once revoked (password reset)', async () => {
    jest.useFakeTimers({ now: 1_000, doNotFake: ['nextTick', 'setImmediate'] });
    mockAuthenticate.mockResolvedValue(OWNER);
    const app = buildApp();
    const login = await request(app).post('/owner/auth/login').send({ email: OWNER.email, password: 'right' });
    const cookie = sessionCookie(login);

    const me = await request(app).get('/owner/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ ownerId: 'owner-1', email: OWNER.email, name: OWNER.name });

    jest.setSystemTime(2_000);
    await revokeSessionsFor('owner:owner-1');
    const after = await request(app).get('/owner/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});
