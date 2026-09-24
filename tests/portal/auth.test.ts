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

jest.mock('../../src/services/patientService', () => ({
  findPatientByPhoneOrCode: jest.fn(),
  registerPatient: jest.fn(),
  verifyPatientPin: jest.fn(),
  setPatientPin: jest.fn(),
}));

jest.mock('../../src/services/otpService', () => ({
  requestPinResetOtp: jest.fn(),
  verifyPinResetOtp: jest.fn(),
}));

import {
  findPatientByPhoneOrCode,
  registerPatient,
  verifyPatientPin,
  setPatientPin,
} from '../../src/services/patientService';
import { requestPinResetOtp, verifyPinResetOtp } from '../../src/services/otpService';
import { portalAuthRouter } from '../../src/portal/auth';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockFindPatient = findPatientByPhoneOrCode as jest.Mock;
const mockRegisterPatient = registerPatient as jest.Mock;
const mockVerifyPin = verifyPatientPin as jest.Mock;
const mockSetPin = setPatientPin as jest.Mock;
const mockRequestOtp = requestPinResetOtp as jest.Mock;
const mockVerifyOtp = verifyPinResetOtp as jest.Mock;

const PATIENT = { id: 'patient-1', patientCode: 'ACI-7F2K', firstName: 'Jane', phoneNumber: '+254712345678' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/patients', portalAuthRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisStore.clear();
});

describe('POST /patients/register', () => {
  it('rejects a PIN that is not 4-6 digits', async () => {
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '12',
    });
    expect(res.status).toBe(400);
  });

  it('creates an account and returns the generated patient code', async () => {
    mockRegisterPatient.mockResolvedValue(PATIENT);
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '1234',
      crossClinicConsent: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.patientCode).toBe('ACI-7F2K');
    expect(mockRegisterPatient).toHaveBeenCalledWith(
      expect.objectContaining({ crossClinicConsent: false, pin: '1234' }),
    );
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_patient_session=');
  });

  it('returns 409 on a duplicate phone number', async () => {
    mockRegisterPatient.mockRejectedValue({ code: 'P2002' });
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '1234',
    });
    expect(res.status).toBe(409);
  });

  it('registers successfully with no email at all — it stays fully optional', async () => {
    mockRegisterPatient.mockResolvedValue(PATIENT);
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '1234',
    });

    expect(res.status).toBe(201);
    expect(mockRegisterPatient).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
  });

  it('passes a provided email through to registerPatient', async () => {
    mockRegisterPatient.mockResolvedValue(PATIENT);
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '1234',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(201);
    expect(mockRegisterPatient).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com' }));
  });

  it('rejects a malformed email', async () => {
    const res = await request(buildApp()).post('/patients/register').send({
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '0712345678',
      pin: '1234',
      email: 'not-an-email',
    });

    expect(res.status).toBe(400);
    expect(mockRegisterPatient).not.toHaveBeenCalled();
  });
});

describe('POST /patients/login', () => {
  it('returns the same 401 for an unknown identifier as for a wrong PIN', async () => {
    mockFindPatient.mockResolvedValue(null);
    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACI-9999', pin: '1234' });
    expect(res.status).toBe(401);
  });

  it('logs in with a phone number or patient code plus PIN', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyPin.mockResolvedValue(true);

    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.patientCode).toBe('ACI-7F2K');
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_patient_session=');
  });

  it('rate-limits after repeated failed attempts', async () => {
    mockFindPatient.mockResolvedValue(null);
    const app = buildApp();

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      const res = await request(app).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: 'wrong' });
      expect(res.status).toBe(401);
    }

    const res = await request(app).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: 'wrong' });
    expect(res.status).toBe(429);
  });
});

describe('POST /patients/forgot-pin', () => {
  it('always returns a generic success message, requesting an OTP only when the account exists', async () => {
    mockFindPatient.mockResolvedValueOnce(null);
    const missRes = await request(buildApp()).post('/patients/forgot-pin').send({ identifier: '0700000000' });
    expect(missRes.status).toBe(200);
    expect(mockRequestOtp).not.toHaveBeenCalled();

    mockFindPatient.mockResolvedValueOnce(PATIENT);
    const hitRes = await request(buildApp()).post('/patients/forgot-pin').send({ identifier: 'ACI-7F2K' });
    expect(hitRes.status).toBe(200);
    expect(mockRequestOtp).toHaveBeenCalledWith(PATIENT);
  });
});

describe('POST /patients/reset-pin', () => {
  it('rejects an invalid or expired code', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyOtp.mockResolvedValue(false);

    const res = await request(buildApp())
      .post('/patients/reset-pin')
      .send({ identifier: 'ACI-7F2K', code: '000000', newPin: '4321' });

    expect(res.status).toBe(400);
    expect(mockSetPin).not.toHaveBeenCalled();
  });

  it('sets the new PIN on a valid code', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyOtp.mockResolvedValue(true);

    const res = await request(buildApp())
      .post('/patients/reset-pin')
      .send({ identifier: 'ACI-7F2K', code: '123456', newPin: '4321' });

    expect(res.status).toBe(200);
    expect(mockSetPin).toHaveBeenCalledWith('patient-1', '4321');
  });
});
