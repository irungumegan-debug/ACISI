import bcrypt from 'bcrypt';
import { createHash } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/db/prisma', () => {
  const prisma = {
    pendingPatientSignup: { deleteMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(async () => ({})) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../../src/services/patientService', () => ({
  findPatientByPhone: jest.fn(async () => null),
  registerPatient: jest.fn(),
  hashPatientPin: jest.fn(async (pin: string) => `hashed:${pin}`),
}));
jest.mock('../../src/services/otpService', () => ({
  createInPersonSetupCode: jest.fn(async () => ({ code: '482913', expiresAt: new Date('2026-11-03T10:10:00Z') })),
}));
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { findPatientByPhone, registerPatient } from '../../src/services/patientService';
import { sendSms } from '../../src/services/smsService';
import { recordAuditEvent } from '../../src/services/auditService';
import { createInPersonSetupCode } from '../../src/services/otpService';
import {
  completePendingSignupInPerson,
  deleteExpiredPendingSignups,
  findPendingSignupsByPhone,
  resendSignupCode,
  setPendingSignupPin,
  startPendingSignup,
  verifyPendingSignup,
} from '../../src/services/pendingSignupService';
import { resetFakeRedis } from '../helpers/fakeRedis';

const pending = prisma.pendingPatientSignup as unknown as Record<string, jest.Mock>;
const INPUT = {
  phoneNumberE164: '+254712345678',
  firstName: 'Jane',
  lastName: 'Wanjiru',
  sex: 'FEMALE' as const,
  identity: {},
  crossClinicConsent: true,
};
const ROW = {
  id: 'pend-1',
  phoneNumber: '+254712345678',
  firstName: 'Jane',
  lastName: 'Wanjiru',
  dateOfBirth: null,
  sex: 'FEMALE',
  email: null,
  idType: null,
  idNumber: null,
  nextOfKinName: null,
  nextOfKinPhone: null,
  pinHash: null,
  crossClinicConsent: true,
  codeAttempts: 0,
  codeExpiresAt: new Date(Date.now() + 60_000),
};

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeRedis();
  (findPatientByPhone as jest.Mock).mockResolvedValue(null);
  pending.create!.mockImplementation(async ({ data }: { data: object }) => ({ id: 'pend-1', ...data }));
  (registerPatient as jest.Mock).mockResolvedValue({ id: 'p-new', patientCode: 'ACI-NEW1' });
});

describe('signup waits for phone verification (C3)', () => {
  it('saves the details (NO PIN yet, code hashed) for 14 days, and texts the code', async () => {
    const res = await startPendingSignup(INPUT);
    expect(res).toEqual({ pendingId: 'pend-1', smsSent: true });
    const data = pending.create!.mock.calls[0][0].data;
    const code = /code is (\d{6})/.exec((sendSms as jest.Mock).mock.calls[0][1])![1]!;
    await expect(bcrypt.compare(code, data.codeHash)).resolves.toBe(true);
    expect(data.pinHash).toBeUndefined(); // the PIN comes only after the phone is verified
    const days = (data.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('when the SMS fails, the signup is still kept and the caller is told', async () => {
    (sendSms as jest.Mock).mockResolvedValue('failed');
    expect(await startPendingSignup(INPUT)).toEqual({ pendingId: 'pend-1', smsSent: false });
    expect(pending.create).toHaveBeenCalled();
  });

  it('refuses a number that already has an account', async () => {
    (findPatientByPhone as jest.Mock).mockResolvedValue({ id: 'p1' });
    await expect(startPendingSignup(INPUT)).rejects.toMatchObject({ status: 409 });
  });

  it('the right code verifies the phone but creates NO account yet: it returns a one-time token for choosing the PIN', async () => {
    pending.findFirst!.mockResolvedValue({ ...ROW, codeHash: await bcrypt.hash('123456', 4) });
    const { pinSetupToken } = await verifyPendingSignup('pend-1', '123456');
    expect(pinSetupToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(registerPatient).not.toHaveBeenCalled();
    const { data } = pending.update!.mock.calls[0][0];
    expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(data.codeHash).toBeNull(); // the SMS code can't be used twice
    expect(data.pinSetupTokenHash).toBe(createHash('sha256').update(pinSetupToken).digest('hex')); // only a hash is stored
    expect(data.pinSetupTokenHash).not.toContain(pinSetupToken);
    const minutes = (data.pinSetupExpiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it('a wrong code is counted and creates nothing', async () => {
    pending.findFirst!.mockResolvedValue({ ...ROW, codeHash: await bcrypt.hash('123456', 4) });
    await expect(verifyPendingSignup('pend-1', '000000')).rejects.toThrow(/not right/);
    expect(pending.update).toHaveBeenCalledWith({ where: { id: 'pend-1' }, data: { codeAttempts: { increment: 1 } } });
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('after 5 wrong tries, or after 10 minutes, the code no longer works', async () => {
    pending.findFirst!.mockResolvedValue({ ...ROW, codeHash: await bcrypt.hash('123456', 4), codeAttempts: 5 });
    await expect(verifyPendingSignup('pend-1', '123456')).rejects.toThrow(/expired/);
    pending.findFirst!.mockResolvedValue({ ...ROW, codeHash: await bcrypt.hash('123456', 4), codeExpiresAt: new Date(Date.now() - 1) });
    await expect(verifyPendingSignup('pend-1', '123456')).rejects.toThrow(/expired/);
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('limits how often a new code can be sent', async () => {
    pending.findFirst!.mockResolvedValue(ROW);
    for (let i = 0; i < 3; i++) await resendSignupCode('pend-1');
    await expect(resendSignupCode('pend-1')).rejects.toMatchObject({ status: 429 });
  });
});

describe('choosing the PIN, only after the phone is verified', () => {
  const TOKEN = 'tok-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
  const verifiedRow = (overrides: object = {}) => ({
    ...ROW,
    phoneVerifiedAt: new Date(),
    pinSetupTokenHash: createHash('sha256').update(TOKEN).digest('hex'),
    pinSetupExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  it('creates the account with the chosen PIN (hashed), phone verified by SMS, with the choices made at signup', async () => {
    pending.findFirst!.mockResolvedValue(verifiedRow());
    await setPendingSignupPin('pend-1', TOKEN, '730194');
    expect(registerPatient).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberE164: '+254712345678',
        pinHash: 'hashed:730194',
        sex: 'FEMALE',
        crossClinicConsent: true,
        phoneVerifiedVia: 'SMS',
        acceptedTermsAndPrivacyNotice: true,
      }),
    );
    expect(pending.delete).toHaveBeenCalledWith({ where: { id: 'pend-1' } }); // the token can't be used again
  });

  it('refuses before the phone is verified, with a wrong token, or after the token expires', async () => {
    pending.findFirst!.mockResolvedValue(verifiedRow({ phoneVerifiedAt: null }));
    await expect(setPendingSignupPin('pend-1', TOKEN, '730194')).rejects.toThrow(/Confirm your phone number first/);
    pending.findFirst!.mockResolvedValue(verifiedRow());
    await expect(setPendingSignupPin('pend-1', 'wrong-token', '730194')).rejects.toThrow(/Confirm your phone number first/);
    pending.findFirst!.mockResolvedValue(verifiedRow({ pinSetupExpiresAt: new Date(Date.now() - 1) }));
    await expect(setPendingSignupPin('pend-1', TOKEN, '730194')).rejects.toThrow(/Confirm your phone number first/);
    pending.findFirst!.mockResolvedValue(verifiedRow({ pinSetupTokenHash: null }));
    await expect(setPendingSignupPin('pend-1', TOKEN, '730194')).rejects.toThrow(/Confirm your phone number first/);
    expect(registerPatient).not.toHaveBeenCalled();
  });

  it('applies the PIN rules (no dates, repeats, sequences or own number) and keeps the token usable', async () => {
    pending.findFirst!.mockResolvedValue(verifiedRow());
    for (const weak of ['123456', '111111', '150390', '345678']) {
      await expect(setPendingSignupPin('pend-1', TOKEN, weak)).rejects.toMatchObject({ status: 400 });
    }
    expect(registerPatient).not.toHaveBeenCalled();
    expect(pending.delete).not.toHaveBeenCalled();
  });
});

describe('finishing at the clinic when SMS failed (C3 fallback)', () => {
  it('front desk sees only the name, and the lookup is logged without the number', async () => {
    pending.findMany!.mockResolvedValue([{ id: 'pend-1', firstName: 'Jane', lastName: 'Wanjiru', createdAt: new Date() }]);
    const rows = await findPendingSignupsByPhone('+254712345678', 's1', 'c1');
    expect(rows).toEqual([{ pendingId: 'pend-1', name: 'Jane Wanjiru', signedUpAt: expect.any(Date) }]);
    expect(JSON.stringify((recordAuditEvent as jest.Mock).mock.calls[0][0])).not.toContain('254712345678');
  });

  it('"Finish setup" verifies the phone in person, creates the account WITHOUT a PIN, and returns a setup code for choosing it', async () => {
    pending.findFirst!.mockResolvedValue(ROW);
    const res = await completePendingSignupInPerson('pend-1', 's1', 'c1');
    expect(registerPatient).toHaveBeenCalledWith(expect.objectContaining({ pinHash: undefined, phoneVerifiedVia: 'IN_PERSON' }));
    expect(createInPersonSetupCode).toHaveBeenCalledWith('p-new');
    expect(res.setupCode).toEqual({ code: '482913', expiresAt: expect.any(Date) });
    expect(recordAuditEvent).toHaveBeenCalledTimes(1); // one row, not two
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_PHONE_VERIFIED_IN_PERSON', metadata: { flow: 'PENDING_SIGNUP', setupCodeIssued: true } }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_PHONE_VERIFIED_IN_PERSON', entityId: 'p-new', staffId: 's1', clinicId: 'c1' }),
    );
  });

  it('a signup started before this change (PIN already chosen) is finished with that PIN, no setup code', async () => {
    pending.findFirst!.mockResolvedValue({ ...ROW, pinHash: 'old-pin-hash' });
    const res = await completePendingSignupInPerson('pend-1', 's1', 'c1');
    expect(registerPatient).toHaveBeenCalledWith(expect.objectContaining({ pinHash: 'old-pin-hash', phoneVerifiedVia: 'IN_PERSON' }));
    expect(res.setupCode).toBeNull();
    expect(createInPersonSetupCode).not.toHaveBeenCalled();
  });

  it('expired pending signups are deleted by the hourly clean-up', async () => {
    pending.deleteMany!.mockResolvedValue({ count: 2 });
    const now = new Date();
    expect(await deleteExpiredPendingSignups(now)).toEqual({ deleted: 2 });
    expect(pending.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } });
  });
});
