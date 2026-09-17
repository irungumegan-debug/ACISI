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
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      const existing = mockRedisStore.get(key);
      let expiresAt: number | undefined = existing?.expiresAt;
      const exIndex = args.indexOf('EX');
      if (exIndex !== -1) {
        expiresAt = Date.now() + Number(args[exIndex + 1]) * 1000;
      }
      mockRedisStore.set(key, { value, expiresAt });
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
    ttl: jest.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry?.expiresAt) return -1;
      return Math.ceil((entry.expiresAt - Date.now()) / 1000);
    }),
    del: jest.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
  },
}));

jest.mock('../../src/config/africastalking', () => ({
  smsClient: { send: jest.fn() },
}));

import { smsClient } from '../../src/config/africastalking';
import { portalAuthRouter } from '../../src/portal/auth';
import { PATIENT_OTP_MAX_VERIFY_ATTEMPTS, PATIENT_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockSend = smsClient.send as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', portalAuthRouter);
  return app;
}

function extractSentCode(): string {
  const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1] as [{ message: string }];
  const match = lastCall[0].message.match(/code is (\d+)/);
  if (!match) throw new Error(`Could not find a code in SMS message: ${lastCall[0].message}`);
  return match[1] as string;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisStore.clear();
});

describe('POST /auth/otp/request', () => {
  it('rejects an invalid phone number', async () => {
    const res = await request(buildApp()).post('/auth/otp/request').send({ phoneNumber: 'not-a-phone' });
    expect(res.status).toBe(400);
  });

  it('sends a 6-digit code by SMS and responds generically', async () => {
    const res = await request(buildApp()).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(extractSentCode()).toMatch(/^\d{6}$/);
  });

  it('rate-limits repeated requests from the same number', async () => {
    const app = buildApp();
    for (let i = 0; i < PATIENT_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
      expect(res.status).toBe(200);
    }
    const res = await request(app).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    expect(res.status).toBe(429);
  });
});

describe('POST /auth/otp/verify', () => {
  it('rejects when no code was ever requested', async () => {
    const res = await request(buildApp()).post('/auth/otp/verify').send({ phoneNumber: '0712345678', code: '123456' });
    expect(res.status).toBe(401);
  });

  it('rejects an incorrect code', async () => {
    const app = buildApp();
    await request(app).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    const res = await request(app).post('/auth/otp/verify').send({ phoneNumber: '0712345678', code: '000000' });
    expect(res.status).toBe(401);
  });

  it('accepts the correct code and sets a session cookie', async () => {
    const app = buildApp();
    await request(app).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    const code = extractSentCode();

    const res = await request(app).post('/auth/otp/verify').send({ phoneNumber: '0712345678', code });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_patient_session=');
  });

  it('locks out after too many incorrect attempts, even with the right code', async () => {
    const app = buildApp();
    await request(app).post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    const code = extractSentCode();

    for (let i = 0; i < PATIENT_OTP_MAX_VERIFY_ATTEMPTS; i++) {
      const res = await request(app).post('/auth/otp/verify').send({ phoneNumber: '0712345678', code: '000000' });
      expect(res.status).toBe(401);
    }

    const res = await request(app).post('/auth/otp/verify').send({ phoneNumber: '0712345678', code });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Too many/);
  });
});

describe('GET /auth/me and /auth/logout', () => {
  it('rejects /me without a session', async () => {
    const res = await request(buildApp()).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the phone number after verification, and logout invalidates it', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    await agent.post('/auth/otp/request').send({ phoneNumber: '0712345678' });
    const code = extractSentCode();
    await agent.post('/auth/otp/verify').send({ phoneNumber: '0712345678', code });

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.phoneNumberE164).toBe('+254712345678');

    await agent.post('/auth/logout');
    expect((await agent.get('/auth/me')).status).toBe(401);
  });
});
