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

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  createPatientSession: jest.fn(async () => 'session-token'),
  loadPatientSession: jest.fn(),
}));
jest.mock('../../src/services/patientAuthService', () => ({
  ...jest.requireActual('../../src/services/patientAuthService'),
  loginWithPin: jest.fn(),
  requestPatientOtp: jest.fn(),
  startSetupFlow: jest.fn(),
  selectSetupPerson: jest.fn(),
  verifySetupDateOfBirth: jest.fn(),
  completeSetupWithPin: jest.fn(),
  completeSelfSignup: jest.fn(),
  markIdSaved: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { patient: { findFirst: jest.fn() } } }));

import { createPatientSession, loadPatientSession } from '../../src/portal/session';
import {
  completeSelfSignup,
  completeSetupWithPin,
  loginWithPin,
  markIdSaved,
  PatientAuthError,
  requestPatientOtp,
  startSetupFlow,
} from '../../src/services/patientAuthService';
import { prisma } from '../../src/db/prisma';
import { portalAuthRouter } from '../../src/portal/auth';
import { DASHBOARD_SESSION_TTL_SECONDS, PATIENT_LONG_SESSION_TTL_SECONDS } from '../../src/config/constants';

const PATIENT = { id: 'patient-1', patientCode: 'ACS-48217', firstName: 'Jane', phoneNumber: '+254712345678', idSavedAt: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/patients', portalAuthRouter);
  return app;
}

const cookieMaxAge = (res: request.Response) => Number(/Max-Age=(\d+)/.exec(String(res.headers['set-cookie']?.[0]))?.[1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisStore.clear();
});

describe('POST /patients/login', () => {
  it('logs in with phone or ACISI ID + PIN, for 8 hours by default', async () => {
    (loginWithPin as jest.Mock).mockResolvedValue({ kind: 'ok', patient: PATIENT });
    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACS-48217', pin: '730194' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ patientCode: 'ACS-48217', firstName: 'Jane', idSaved: false });
    expect(res.headers['set-cookie']?.[0]).toMatch(/acisi_patient_session=session-token.*HttpOnly/);
    expect(cookieMaxAge(res)).toBe(DASHBOARD_SESSION_TTL_SECONDS);
    expect(createPatientSession).toHaveBeenCalledWith(expect.anything(), DASHBOARD_SESSION_TTL_SECONDS, 0);
  });

  it('"Keep me signed in" gives a 30-day session', async () => {
    (loginWithPin as jest.Mock).mockResolvedValue({ kind: 'ok', patient: PATIENT });
    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACS-48217', pin: '730194', keepSignedIn: true });
    expect(cookieMaxAge(res)).toBe(PATIENT_LONG_SESSION_TTL_SECONDS);
    expect(createPatientSession).toHaveBeenCalledWith(expect.anything(), PATIENT_LONG_SESSION_TTL_SECONDS, 0);
  });

  it('asks which person when the PIN matches several on a shared phone, without logging anyone in', async () => {
    (loginWithPin as jest.Mock).mockResolvedValue({ kind: 'choose', people: [{ id: 'a', displayName: 'Jane W.' }, { id: 'b', displayName: 'Brian K.' }] });
    const res = await request(buildApp()).post('/patients/login').send({ identifier: '0712345678', pin: '730194' });
    expect(res.body).toEqual({ choose: [{ id: 'a', displayName: 'Jane W.' }, { id: 'b', displayName: 'Brian K.' }] });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('passes the person picked back to the PIN check', async () => {
    (loginWithPin as jest.Mock).mockResolvedValue({ kind: 'ok', patient: PATIENT });
    await request(buildApp()).post('/patients/login').send({ identifier: '0712345678', pin: '730194', patientId: 'b' });
    expect(loginWithPin).toHaveBeenCalledWith('0712345678', '730194', { patientId: 'b' });
  });

  it.each([
    [401, new PatientAuthError('Wrong phone number / ACISI ID or PIN', 401)],
    [429, new PatientAuthError('Too many wrong PINs', 429, { reason: 'locked' })],
  ])('returns %i from the PIN check', async (status, err) => {
    (loginWithPin as jest.Mock).mockRejectedValue(err);
    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACS-48217', pin: '000000' });
    expect(res.status).toBe(status);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /patients/otp/request', () => {
  it('gives the same answer whether or not the number has an account', async () => {
    const res = await request(buildApp()).post('/patients/otp/request').send({ phone: '0712345678', purpose: 'login' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If this number can use ACISI/);
    expect(requestPatientOtp).toHaveBeenCalledWith('0712345678', 'login');
  });

  it('caps sends per IP across all numbers', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await request(buildApp()).post('/patients/otp/request').send({ phone: `07123456${String(i).padStart(2, '0')}`, purpose: 'login' })).status).toBe(200);
    }
    const res = await request(buildApp()).post('/patients/otp/request').send({ phone: '0712345699', purpose: 'login' });
    expect(res.status).toBe(429);
    expect(requestPatientOtp).toHaveBeenCalledTimes(10);
  });

  it('rejects an unknown purpose', async () => {
    expect((await request(buildApp()).post('/patients/otp/request').send({ phone: '0712345678', purpose: 'anything' })).status).toBe(400);
  });
});

describe('the setup flow', () => {
  it('returns the people on the phone after a good code', async () => {
    (startSetupFlow as jest.Mock).mockResolvedValue({ flowToken: 'f'.repeat(64), people: [{ id: 'p', displayName: 'Jane W.', hasPin: false }] });
    const res = await request(buildApp()).post('/patients/otp/verify').send({ phone: '0712345678', purpose: 'login', code: '123456' });
    expect(res.body.people).toHaveLength(1);
  });

  it('logs the patient in once the PIN is set, issued after the revocation of older sessions', async () => {
    (completeSetupWithPin as jest.Mock).mockResolvedValue({ patient: PATIENT, revokedAt: 12345 });
    const res = await request(buildApp())
      .post('/patients/setup/set-pin')
      .send({ flowToken: 'f'.repeat(64), pin: '730194', pinConfirm: '730194', keepSignedIn: true });
    expect(res.status).toBe(200);
    expect(res.body.idSaved).toBe(false);
    expect(createPatientSession).toHaveBeenCalledWith(expect.anything(), PATIENT_LONG_SESSION_TTL_SECONDS, 12345);
  });

  it('self-signup goes through the same flow', async () => {
    (completeSelfSignup as jest.Mock).mockResolvedValue(PATIENT);
    const res = await request(buildApp()).post('/patients/setup/register').send({
      flowToken: 'f'.repeat(64),
      firstName: 'Jane',
      lastName: 'Wanjiru',
      dateOfBirth: '1990-03-15',
      sex: 'FEMALE',
      pin: '730194',
      pinConfirm: '730194',
      acceptLegal: true,
    });
    expect(res.status).toBe(201);
  });

  it('the old routes that skipped phone confirmation are gone', async () => {
    for (const path of ['/patients/register', '/patients/forgot-pin', '/patients/reset-pin']) {
      expect((await request(buildApp()).post(path).send({})).status).toBe(404);
    }
  });
});

describe('ACISI ID saved', () => {
  it('/me says whether the patient ticked "I have saved my ACISI ID"', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue({ patientId: 'patient-1', patientCode: 'ACS-48217', firstName: 'Jane' });
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ idSavedAt: new Date() });
    const res = await request(buildApp()).get('/patients/me').set('Cookie', 'acisi_patient_session=t');
    expect(res.body).toMatchObject({ patientCode: 'ACS-48217', idSaved: true });
  });

  it('records the tick', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue({ patientId: 'patient-1', patientCode: 'ACS-48217', firstName: 'Jane' });
    const res = await request(buildApp()).post('/patients/id-saved').set('Cookie', 'acisi_patient_session=t');
    expect(res.status).toBe(204);
    expect(markIdSaved).toHaveBeenCalledWith('patient-1');
  });
});
