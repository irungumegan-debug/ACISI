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
  hashPatientPin: jest.fn(async () => 'hashed-pin'),
  verifyPatientPin: jest.fn(),
  setPatientPin: jest.fn(),
}));

jest.mock('../../src/services/pendingSignupService', () => {
  class PendingSignupError extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  }
  return { startPendingSignup: jest.fn(), verifyPendingSignup: jest.fn(), resendSignupCode: jest.fn(), PendingSignupError };
});

jest.mock('../../src/services/otpService', () => ({
  requestPinResetOtp: jest.fn(),
  verifyPinResetOtp: jest.fn(),
}));

import {
  findPatientByPhoneOrCode,
  verifyPatientPin,
  setPatientPin,
} from '../../src/services/patientService';
import { requestPinResetOtp, verifyPinResetOtp } from '../../src/services/otpService';
import { PendingSignupError, resendSignupCode, startPendingSignup, verifyPendingSignup } from '../../src/services/pendingSignupService';
import { portalAuthRouter } from '../../src/portal/auth';
import { PIN_LOCKOUT } from '../../src/config/constants';
import { clearLockout } from '../../src/services/pinLockout';

const mockFindPatient = findPatientByPhoneOrCode as jest.Mock;
const mockStartPending = startPendingSignup as jest.Mock;
const mockVerifyPending = verifyPendingSignup as jest.Mock;
const mockResendCode = resendSignupCode as jest.Mock;
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

describe('POST /patients/register (C3: phone verified before the account exists)', () => {
  const BODY = { firstName: 'Jane', lastName: 'Wanjiru', phoneNumber: '0712345678', pin: '730194', acceptLegal: true };

  it('rejects a PIN that is not 6 digits', async () => {
    const res = await request(buildApp()).post('/patients/register').send({ ...BODY, pin: '12' });
    expect(res.status).toBe(400);
    expect(mockStartPending).not.toHaveBeenCalled();
  });

  it('creates NO account and NO session yet: it saves a pending signup and texts a code', async () => {
    mockStartPending.mockResolvedValue({ pendingId: 'pend-1', smsSent: true });
    const res = await request(buildApp()).post('/patients/register').send({ ...BODY, crossClinicConsent: false, email: 'jane@example.com' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ pendingId: 'pend-1', smsSent: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    const saved = mockStartPending.mock.calls[0][0];
    expect(saved).toMatchObject({ phoneNumberE164: '+254712345678', crossClinicConsent: false, email: 'jane@example.com', pinHash: 'hashed-pin' });
    expect(JSON.stringify(saved)).not.toContain('730194');
  });

  it('when the SMS cannot be sent, says so in the agreed words and keeps the signup', async () => {
    mockStartPending.mockResolvedValue({ pendingId: 'pend-1', smsSent: false });
    const res = await request(buildApp()).post('/patients/register').send(BODY);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      pendingId: 'pend-1',
      smsSent: false,
      message: "We couldn't send your code. You can still visit your clinic as normal – the front desk will verify your phone and finish setting up your account.",
    });
  });

  it('passes optional ID and next of kin, checked and normalised (C11)', async () => {
    mockStartPending.mockResolvedValue({ pendingId: 'pend-1', smsSent: true });
    await request(buildApp())
      .post('/patients/register')
      .send({ ...BODY, identity: { idType: 'NATIONAL_ID', idNumber: '1234 5678', nextOfKinName: 'Peter', nextOfKinPhone: '0722000111' } });
    expect(mockStartPending.mock.calls[0][0].identity).toEqual({
      idType: 'NATIONAL_ID',
      idNumber: '12345678',
      nextOfKinName: 'Peter',
      nextOfKinPhone: '+254722000111',
    });
  });

  it('returns 409 when the number already has an account', async () => {
    mockStartPending.mockRejectedValue(new PendingSignupError('An account with that phone number already exists', 409));
    const res = await request(buildApp()).post('/patients/register').send(BODY);
    expect(res.status).toBe(409);
  });

  it('cannot sign up without accepting the Terms of Service and Privacy Notice', async () => {
    for (const extra of [{ acceptLegal: undefined }, { acceptLegal: false }]) {
      const res = await request(buildApp()).post('/patients/register').send({ ...BODY, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Terms of Service');
    }
    expect(mockStartPending).not.toHaveBeenCalled();
  });
});

describe('POST /patients/register/verify', () => {
  it('a correct code creates the account and logs the patient in', async () => {
    mockVerifyPending.mockResolvedValue(PATIENT);
    const res = await request(buildApp()).post('/patients/register/verify').send({ pendingId: 'pend-1', code: '123456' });
    expect(res.status).toBe(201);
    expect(res.body.patientCode).toBe('ACI-7F2K');
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_patient_session=');
  });

  it('a wrong code gets a clear message and no session', async () => {
    mockVerifyPending.mockRejectedValue(new PendingSignupError('That code is not right. Check the SMS and try again.', 400));
    const res = await request(buildApp()).post('/patients/register/verify').send({ pendingId: 'pend-1', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('checks the code format first', async () => {
    const res = await request(buildApp()).post('/patients/register/verify').send({ pendingId: 'pend-1', code: '12' });
    expect(res.status).toBe(400);
    expect(mockVerifyPending).not.toHaveBeenCalled();
  });
});

describe('POST /patients/register/resend', () => {
  it('sends a new code, or the agreed message when it cannot', async () => {
    mockResendCode.mockResolvedValue({ smsSent: false });
    const res = await request(buildApp()).post('/patients/register/resend').send({ pendingId: 'pend-1' });
    expect(res.body.message).toContain("We couldn't send your code");
  });
});

describe('POST /patients/login', () => {
  it('returns the same 401 for an unknown identifier as for a wrong PIN', async () => {
    mockFindPatient.mockResolvedValue(null);
    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACI-9999', pin: '730194' });
    expect(res.status).toBe(401);
  });

  it('logs in with a phone number or patient code plus PIN', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyPin.mockResolvedValue(true);

    const res = await request(buildApp()).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: '730194' });

    expect(res.status).toBe(200);
    expect(res.body.patientCode).toBe('ACI-7F2K');
    expect(res.headers['set-cookie']?.[0]).toContain('acisi_patient_session=');
  });

  it('locks the ACCOUNT on the 5th wrong PIN however the phone number or ID is typed (no bypass)', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyPin.mockResolvedValue(false);
    const app = buildApp();
    const formats = ['ACI-7F2K', '0712345678', '+254712345678', '254712345678', '0712 345 678'];

    for (const identifier of formats.slice(0, PIN_LOCKOUT.maxAttempts - 1)) {
      expect((await request(app).post('/patients/login').send({ identifier, pin: '000000' })).status).toBe(401);
    }
    const locking = await request(app).post('/patients/login').send({ identifier: formats[4], pin: '000000' });
    expect(locking.status).toBe(429);
    expect(locking.body.error).toBe('Too many wrong PINs. Try again in 5 minutes.');

    // Even the right PIN, typed yet another way, is refused while locked.
    mockVerifyPin.mockResolvedValue(true);
    expect((await request(app).post('/patients/login').send({ identifier: 'aci-7f2k', pin: '730194' })).status).toBe(429);
  });

  it('counts guesses at an unknown number in one place, whatever format is typed', async () => {
    mockFindPatient.mockResolvedValue(null);
    const app = buildApp();
    const formats = ['0799000111', '+254799000111', '254799000111', '0799 000 111'];
    for (const identifier of formats) {
      expect((await request(app).post('/patients/login').send({ identifier, pin: '000000' })).status).toBe(401);
    }
    expect((await request(app).post('/patients/login').send({ identifier: '799000111', pin: '000000' })).status).toBe(429);
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
    // Same words either way, always offering the clinic fallback (C3).
    expect(hitRes.body).toEqual(missRes.body);
    expect(hitRes.body.message).toContain('the front desk will verify your phone');
    expect(mockRequestOtp).toHaveBeenCalledWith(PATIENT);
  });
});

describe('POST /patients/reset-pin', () => {
  it('rejects an invalid or expired code', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyOtp.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/patients/reset-pin')
      .send({ identifier: 'ACI-7F2K', code: '000000', newPin: '730194' });

    expect(res.status).toBe(400);
    expect(mockSetPin).not.toHaveBeenCalled();
  });

  it('sets the new PIN on a valid code', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyOtp.mockResolvedValue('SMS_CODE');

    const res = await request(buildApp())
      .post('/patients/reset-pin')
      .send({ identifier: 'ACI-7F2K', code: '123456', newPin: '730194' });

    expect(res.status).toBe(200);
    expect(mockSetPin).toHaveBeenCalledWith('patient-1', '730194', 'SMS_CODE');
  });

  it('a setup code from the front desk (phone rung in person) sets the PIN and marks the phone verified that way (C3)', async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyOtp.mockResolvedValue('IN_PERSON_CODE');
    const res = await request(buildApp()).post('/patients/reset-pin').send({ identifier: '0712345678', code: '654321', newPin: '730194' });
    expect(res.status).toBe(200);
    expect(mockSetPin).toHaveBeenCalledWith('patient-1', '730194', 'IN_PERSON_CODE');
  });

  it('a reset unlocks a locked-out patient under every identifier (setPatientPin lifts the lock)', async () => {
    const app = buildApp();
    // The real setPatientPin clears the per-account lock (tested in
    // patientService.test.ts); stand that in here.
    mockSetPin.mockImplementation((id: string) => clearLockout(`patient:${id}`));
    mockFindPatient.mockResolvedValue(PATIENT);
    mockVerifyPin.mockResolvedValue(false);
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts; i++) {
      await request(app).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: '000000' });
    }
    mockVerifyPin.mockResolvedValue(true);
    expect((await request(app).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: '730194' })).status).toBe(429);

    mockVerifyOtp.mockResolvedValue('SMS_CODE');
    await request(app).post('/patients/reset-pin').send({ identifier: 'ACI-7F2K', code: '123456', newPin: '730194' });

    expect((await request(app).post('/patients/login').send({ identifier: 'ACI-7F2K', pin: '730194' })).status).toBe(200);
    expect((await request(app).post('/patients/login').send({ identifier: '+254712345678', pin: '730194' })).status).toBe(200);
  });

  it("refuses an easy-to-guess PIN without using up the patient's one-time code", async () => {
    mockFindPatient.mockResolvedValue(PATIENT);
    const res = await request(buildApp())
      .post('/patients/reset-pin')
      .send({ identifier: 'ACI-7F2K', code: '123456', newPin: '150390' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/looks like a date/);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockSetPin).not.toHaveBeenCalled();
  });
});
