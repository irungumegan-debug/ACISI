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

jest.mock('../../src/services/staffService', () => ({
  ...jest.requireActual('../../src/services/staffService'),
  findActiveStaffWithClinicByCode: jest.fn(),
  verifyStaffPin: jest.fn(),
  resetStaffPinBySelf: jest.fn(),
}));
jest.mock('../../src/services/otpService', () => ({
  requestStaffPinResetOtp: jest.fn(),
  verifyStaffPinResetOtp: jest.fn(),
}));

import { findActiveStaffWithClinicByCode, resetStaffPinBySelf, verifyStaffPin, InvalidPinFormatError } from '../../src/services/staffService';
import { requestStaffPinResetOtp, verifyStaffPinResetOtp } from '../../src/services/otpService';
import { createDashboardSession, loadDashboardSession } from '../../src/dashboard/session';
import { authRouter } from '../../src/dashboard/auth';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS, OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS } from '../../src/config/constants';

const mockFindStaff = findActiveStaffWithClinicByCode as jest.Mock;
const mockVerifyPin = verifyStaffPin as jest.Mock;
const mockResetPin = resetStaffPinBySelf as jest.Mock;
const mockRequestOtp = requestStaffPinResetOtp as jest.Mock;
const mockVerifyOtp = verifyStaffPinResetOtp as jest.Mock;

const STAFF = {
  id: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  name: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  departmentId: null,
  phoneNumber: '+254700000001',
  clinic: { name: 'Sunrise Family Clinic' },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockRedisStore.clear();
});

describe('POST /auth/forgot-pin', () => {
  it('texts a code to an active staff member, with a generic response', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    const res = await request(buildApp()).post('/auth/forgot-pin').send({ staffCode: 'aci-stf-test' });
    expect(res.status).toBe(200);
    expect(mockFindStaff).toHaveBeenCalledWith('ACI-STF-TEST');
    expect(mockRequestOtp).toHaveBeenCalledWith(STAFF);
  });

  it('gives the same response for an unknown staff ID, without sending anything', async () => {
    mockFindStaff.mockResolvedValue(null);
    const known = await request(buildApp()).post('/auth/forgot-pin').send({ staffCode: 'ACI-STF-NOPE' });
    expect(known.status).toBe(200);
    expect(known.body.message).toMatch(/If that staff ID exists/);
    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it('limits how many codes can be requested, so nobody can flood a phone with SMS', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    const app = buildApp();
    for (let i = 0; i < OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await request(app).post('/auth/forgot-pin').send({ staffCode: 'ACI-STF-TEST' });
    }
    const res = await request(app).post('/auth/forgot-pin').send({ staffCode: 'ACI-STF-TEST' });
    expect(res.status).toBe(429);
    expect(mockRequestOtp).toHaveBeenCalledTimes(OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS);
  });
});

describe('POST /auth/reset-pin', () => {
  it('rejects a wrong or expired code', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyOtp.mockResolvedValue(false);
    const res = await request(buildApp()).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '000000', newPin: '730194' });
    expect(res.status).toBe(400);
    expect(mockResetPin).not.toHaveBeenCalled();
  });

  it("refuses an easy-to-guess PIN without using up the staff member's one-time code", async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    const res = await request(buildApp()).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '123456', newPin: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repeated or sequential/);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockResetPin).not.toHaveBeenCalled();
  });

  it('rejects a badly formatted new PIN', async () => {
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyOtp.mockResolvedValue(true);
    mockResetPin.mockRejectedValue(new InvalidPinFormatError('Your PIN must be exactly 6 digits.'));
    const res = await request(buildApp()).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '123456', newPin: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Your PIN must be exactly 6 digits.');
  });

  it('automatically unlocks a locked-out staff member once they reset', async () => {
    const app = buildApp();
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyPin.mockResolvedValue(false);
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_ATTEMPTS; i++) {
      await request(app).post('/auth/login').send({ staffCode: 'ACI-STF-TEST', pin: '0000' });
    }
    mockVerifyPin.mockResolvedValue(true);
    expect((await request(app).post('/auth/login').send({ staffCode: 'ACI-STF-TEST', pin: '730194' })).status).toBe(429);

    mockVerifyOtp.mockResolvedValue(true);
    mockResetPin.mockResolvedValue(STAFF);
    const reset = await request(app).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '123456', newPin: '730194' });
    expect(reset.status).toBe(200);
    expect(mockResetPin).toHaveBeenCalledWith('staff-1', '730194');

    expect((await request(app).post('/auth/login').send({ staffCode: 'ACI-STF-TEST', pin: '730194' })).status).toBe(200);
  });

  it('logs out sessions that were open with the old PIN', async () => {
    jest.useFakeTimers({ now: 1_000, doNotFake: ['nextTick', 'setImmediate'] });
    const oldSession = await createDashboardSession({
      staffId: 'staff-1',
      staffCode: 'ACI-STF-TEST',
      staffName: 'Test',
      role: 'RECEPTIONIST',
      clinicId: 'clinic-A',
      clinicName: 'Sunrise',
      departmentId: null,
    });
    jest.setSystemTime(2_000);
    mockFindStaff.mockResolvedValue(STAFF);
    mockVerifyOtp.mockResolvedValue(true);
    mockResetPin.mockResolvedValue(STAFF);
    await request(buildApp()).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '123456', newPin: '730194' });
    expect(await loadDashboardSession(oldSession)).toBeNull();
  });
});
