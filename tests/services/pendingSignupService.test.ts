import bcrypt from 'bcrypt';

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
jest.mock('../../src/services/patientService', () => ({ findPatientByPhone: jest.fn(async () => null), registerPatient: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { findPatientByPhone, registerPatient } from '../../src/services/patientService';
import { sendSms } from '../../src/services/smsService';
import { recordAuditEvent } from '../../src/services/auditService';
import {
  completePendingSignupInPerson,
  deleteExpiredPendingSignups,
  findPendingSignupsByPhone,
  resendSignupCode,
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
  pinHash: 'pin-hash',
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
  pinHash: 'pin-hash',
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
  it('saves the details (hashed PIN, code hashed) for 14 days, and texts the code', async () => {
    const res = await startPendingSignup(INPUT);
    expect(res).toEqual({ pendingId: 'pend-1', smsSent: true });
    const data = pending.create!.mock.calls[0][0].data;
    const code = /code is (\d{6})/.exec((sendSms as jest.Mock).mock.calls[0][1])![1]!;
    await expect(bcrypt.compare(code, data.codeHash)).resolves.toBe(true);
    expect(data.pinHash).toBe('pin-hash');
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

  it('the right code creates the account, phone verified by SMS, with the choices made at signup', async () => {
    pending.findFirst!.mockResolvedValue({ ...ROW, codeHash: await bcrypt.hash('123456', 4) });
    await verifyPendingSignup('pend-1', '123456');
    expect(registerPatient).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberE164: '+254712345678', pinHash: 'pin-hash', crossClinicConsent: true, phoneVerifiedVia: 'SMS', acceptedTermsAndPrivacyNotice: true }),
    );
    expect(pending.delete).toHaveBeenCalledWith({ where: { id: 'pend-1' } });
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

describe('finishing at the clinic when SMS failed (C3 fallback)', () => {
  it('front desk sees only the name, and the lookup is logged without the number', async () => {
    pending.findMany!.mockResolvedValue([{ id: 'pend-1', firstName: 'Jane', lastName: 'Wanjiru', createdAt: new Date() }]);
    const rows = await findPendingSignupsByPhone('+254712345678', 's1', 'c1');
    expect(rows).toEqual([{ pendingId: 'pend-1', name: 'Jane Wanjiru', signedUpAt: expect.any(Date) }]);
    expect(JSON.stringify((recordAuditEvent as jest.Mock).mock.calls[0][0])).not.toContain('254712345678');
  });

  it('"Finish setup" creates the account with the PIN the patient chose, marked verified in person, and logs it', async () => {
    pending.findFirst!.mockResolvedValue(ROW);
    await completePendingSignupInPerson('pend-1', 's1', 'c1');
    expect(registerPatient).toHaveBeenCalledWith(expect.objectContaining({ pinHash: 'pin-hash', phoneVerifiedVia: 'IN_PERSON' }));
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_PHONE_VERIFIED_IN_PERSON', entityId: 'p-new', staffId: 's1', clinicId: 'c1' }),
    );
  });

  it('expired pending signups are deleted by the hourly clean-up', async () => {
    pending.deleteMany!.mockResolvedValue({ count: 2 });
    const now = new Date();
    expect(await deleteExpiredPendingSignups(now)).toEqual({ deleted: 2 });
    expect(pending.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } });
  });
});
