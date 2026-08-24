import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const mockRedisStore = new Map<string, { value: string; expiresAt?: number }>();

function isExpired(entry?: { value: string; expiresAt?: number }): boolean {
  return !!entry?.expiresAt && entry.expiresAt < Date.now();
}

jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry || isExpired(entry)) return null;
      return entry.value;
    }),
    set: jest.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, { value });
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      const current = entry && !isExpired(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      mockRedisStore.set(key, { value: String(next), expiresAt: entry?.expiresAt });
      return next;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      const entry = mockRedisStore.get(key);
      if (entry) entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }),
    del: jest.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
  },
}));

jest.mock('../../src/services/staffService', () => ({
  findActiveStaffWithClinicByPhone: jest.fn(),
  verifyStaffPin: jest.fn(),
}));

import { findActiveStaffWithClinicByPhone, verifyStaffPin } from '../../src/services/staffService';
import { authRouter } from '../../src/dashboard/auth';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockFindStaff = findActiveStaffWithClinicByPhone as jest.Mock;
const mockVerifyPin = verifyStaffPin as jest.Mock;

const STAFF = {
  id: 'staff-1',
  name: 'Test Receptionist',
  clinicId: 'clinic-1',
  clinic: { id: 'clinic-1', name: 'Sunrise Family Clinic' },
  role: 'RECEPTIONIST',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

beforeEach(() => {
  // clearAllMocks (not resetAllMocks) — resetAllMocks would strip the
  // behavioral implementations set on the redis mock's methods above,
  // since those were defined once at mock-creation time, not per-test.
  jest.clearAllMocks();
  mockRedisStore.clear();
});

describe('POST /auth/login', () => {
  it('rejects a missing phone number or PIN', async () => {
    const res = await request(buildApp()).post('/auth/login').send({ phoneNumber: '0712345678' });
    expect(res.status).toBe(400);
  });

  it('returns the same 401 for an unknown phone number as for a wrong PIN (no enumeration)', async () => {
    mockFindStaff.mockResolvedValue(null);
    const res = await request(buildApp()).post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid phone number or PIN');
  });

  it('rejects a wrong PIN with the same message', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(false);
    const res = await request(buildApp()).post('/auth/login').send({ phoneNumber: '0712345678', pin: '9999' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid phone number or PIN');
  });

  it('logs in successfully and sets a session cookie', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(true);

    const res = await request(buildApp()).post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ staffName: 'Test Receptionist', clinicName: 'Sunrise Family Clinic', role: 'RECEPTIONIST' });
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_staff_session=');
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rate-limits after repeated failed attempts from the same phone number', async () => {
    mockFindStaff.mockResolvedValue(null);
    const app = buildApp();

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });
      expect(res.status).toBe(401);
    }

    const res = await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });
    expect(res.status).toBe(429);
  });

  it('clears the rate limit counter on a successful login', async () => {
    const app = buildApp();
    mockFindStaff.mockResolvedValue(null);

    await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: 'wrong' });
    await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: 'wrong' });

    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(true);
    const success = await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });
    expect(success.status).toBe(200);

    // Rate limit counter should be cleared, so failures start fresh again.
    mockFindStaff.mockResolvedValue(null);
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS - 1; i++) {
      const res = await request(app).post('/auth/login').send({ phoneNumber: '0712345678', pin: 'wrong' });
      expect(res.status).toBe(401);
    }
  });
});

describe('GET /auth/me', () => {
  it('rejects a request with no session cookie', async () => {
    const res = await request(buildApp()).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns session details for a logged-in staff member', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(true);

    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ staffId: 'staff-1', clinicId: 'clinic-1', clinicName: 'Sunrise Family Clinic' });
  });
});

describe('POST /auth/logout', () => {
  it('invalidates the session so /me subsequently rejects it', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(true);

    const agent = request.agent(buildApp());
    await agent.post('/auth/login').send({ phoneNumber: '0712345678', pin: '1234' });
    expect((await agent.get('/auth/me')).status).toBe(200);

    await agent.post('/auth/logout');

    expect((await agent.get('/auth/me')).status).toBe(401);
  });
});
