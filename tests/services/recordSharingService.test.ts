import bcrypt from 'bcrypt';

jest.mock('../../src/db/prisma', () => {
  const prisma = {
    consent: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    recordAccessRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    patient: { findFirst: jest.fn() },
    clinic: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/smsService', () => ({ sendPatientSms: jest.fn(async () => 'sent') }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { sendPatientSms } from '../../src/services/smsService';
import {
  crossClinicAccessBasis,
  endOfKenyaDay,
  enterRecordAccessCode,
  RecordSharingError,
  requestRecords,
  setStandingSharing,
  showCodeToPatient,
} from '../../src/services/recordSharingService';

const consentFindFirst = prisma.consent.findFirst as jest.Mock;
const reqFindFirst = prisma.recordAccessRequest.findFirst as jest.Mock;
const reqCreate = prisma.recordAccessRequest.create as jest.Mock;
const reqUpdate = prisma.recordAccessRequest.update as jest.Mock;
const reqUpdateMany = prisma.recordAccessRequest.updateMany as jest.Mock;
const audit = recordAuditEvent as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.clinic.findUniqueOrThrow as jest.Mock).mockResolvedValue({ name: 'Baraka Clinic' });
  reqUpdateMany.mockResolvedValue({ count: 1 });
});

describe('crossClinicAccessBasis (C4)', () => {
  it('standing consent (ticked and not switched off) gives automatic access', async () => {
    consentFindFirst.mockResolvedValue({ granted: true });
    expect(await crossClinicAccessBasis('p1', 'clinic-B')).toBe('STANDING_CONSENT');
    expect(reqFindFirst).not.toHaveBeenCalled();
  });

  it('switched off / never ticked: only a code used today, not revoked, gives access', async () => {
    consentFindFirst.mockResolvedValue({ granted: false });
    reqFindFirst.mockResolvedValue({ id: 'r1' });
    const now = new Date('2026-10-30T09:00:00Z');
    expect(await crossClinicAccessBasis('p1', 'clinic-B', now)).toBe('SHARING_CODE');
    expect(reqFindFirst.mock.calls[0][0].where).toEqual({
      patientId: 'p1',
      clinicId: 'clinic-B',
      usedAt: { not: null },
      revokedAt: null,
      accessUntil: { gt: now },
    });
  });

  it('no consent and no valid code: no access to other clinics\' records', async () => {
    consentFindFirst.mockResolvedValue(null);
    reqFindFirst.mockResolvedValue(null);
    expect(await crossClinicAccessBasis('p1', 'clinic-B')).toBeNull();
  });
});

describe('Request records (C4)', () => {
  const PATIENT = { id: 'p1', phoneNumber: '+254712345678', smsOptOut: true, deletedAt: null };

  it('refuses a patient this clinic has never seen', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(requestRecords({ patientId: 'p9', clinicId: 'clinic-B', staffId: 's1' })).rejects.toMatchObject({ status: 404 });
  });

  it('stores only a hash of the code, texts the code even to a patient who opted out of SMS (asked in person), and logs IDs only', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue(PATIENT);
    reqCreate.mockResolvedValue({ id: 'r1' });
    await requestRecords({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1' });

    const sms = (sendPatientSms as jest.Mock).mock.calls[0];
    expect(sms[2]).toEqual({ purpose: 'RECORD_ACCESS_CODE', essential: true });
    const code = /code: (\d{6})/.exec(sms[1])![1]!;
    const stored = reqCreate.mock.calls[0][0].data;
    expect(stored.codeHash).not.toContain(code);
    await expect(bcrypt.compare(code, stored.codeHash)).resolves.toBe(true);
    expect(stored.codeExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(sms[1]).not.toMatch(/diagnos|prescri/i);

    const row = audit.mock.calls[0][0];
    expect(row).toMatchObject({ action: 'RECORD_ACCESS_REQUESTED', clinicId: 'clinic-B', metadata: { patientId: 'p1', smsOutcome: 'sent' } });
    expect(JSON.stringify(row)).not.toContain('254712345678');
  });
});

describe('entering the code at the front desk (C4)', () => {
  async function openRequest(code: string, overrides: Record<string, unknown> = {}) {
    return { id: 'r1', codeHash: await bcrypt.hash(code, 4), codeExpiresAt: new Date(Date.now() + 60_000), attempts: 0, ...overrides };
  }

  it('right code: access until the end of today in Kenya, saved as a consent decision with clinic and staff', async () => {
    reqFindFirst.mockResolvedValue(await openRequest('123456'));
    const { accessUntil } = await enterRecordAccessCode({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1', code: '123456' });
    expect(accessUntil).toEqual(endOfKenyaDay());
    expect((prisma.consent.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      patientId: 'p1',
      type: 'CLINIC_RECORD_ACCESS',
      granted: true,
      channel: 'SHARING_CODE',
      clinicId: 'clinic-B',
      staffId: 's1',
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECORD_ACCESS_GRANTED_BY_CODE', clinicId: 'clinic-B' }));
  });

  it('end of day is 21:00 UTC (midnight in Kenya)', () => {
    expect(endOfKenyaDay(new Date('2026-10-30T09:00:00Z')).toISOString()).toBe('2026-10-30T21:00:00.000Z');
    expect(endOfKenyaDay(new Date('2026-10-30T22:00:00Z')).toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('wrong code: refused, counted, and logged', async () => {
    reqFindFirst.mockResolvedValue(await openRequest('123456'));
    await expect(enterRecordAccessCode({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1', code: '654321' })).rejects.toThrow(RecordSharingError);
    expect(reqUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { attempts: { increment: 1 } } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECORD_ACCESS_CODE_FAILED', metadata: { patientId: 'p1', outcome: 'WRONG_CODE' } }));
    expect(prisma.consent.create).not.toHaveBeenCalled();
  });

  it('after 5 wrong tries even the right code stops working', async () => {
    reqFindFirst.mockResolvedValue(await openRequest('123456', { attempts: 5 }));
    await expect(enterRecordAccessCode({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1', code: '123456' })).rejects.toThrow(/expired/);
    expect(prisma.consent.create).not.toHaveBeenCalled();
  });

  it('an expired code (older than 10 minutes) is refused', async () => {
    reqFindFirst.mockResolvedValue(await openRequest('123456', { codeExpiresAt: new Date(Date.now() - 1000) }));
    await expect(enterRecordAccessCode({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1', code: '123456' })).rejects.toThrow(/expired/);
  });

  it('a code can only be used once', async () => {
    reqFindFirst.mockResolvedValue(await openRequest('123456'));
    reqUpdateMany.mockResolvedValue({ count: 0 });
    await expect(enterRecordAccessCode({ patientId: 'p1', clinicId: 'clinic-B', staffId: 's1', code: '123456' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('the patient side', () => {
  it('"Show my code" gives a fresh code for the patient\'s own open request only', async () => {
    reqFindFirst.mockResolvedValue({ id: 'r1', clinicId: 'clinic-B' });
    const shown = await showCodeToPatient('p1', 'r1');
    expect(shown.code).toMatch(/^\d{6}$/);
    expect(reqFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'r1', patientId: 'p1', usedAt: null });
    const saved = reqUpdate.mock.calls[0][0].data;
    await expect(bcrypt.compare(shown.code, saved.codeHash)).resolves.toBe(true);
    expect(saved.attempts).toBe(0);

    reqFindFirst.mockResolvedValue(null);
    await expect(showCodeToPatient('p2', 'r1')).rejects.toMatchObject({ status: 404 });
  });

  it('the Account switch saves every change as a new decision (C5), and switching off ends code access running today', async () => {
    await setStandingSharing('p1', false);
    expect((prisma.consent.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      patientId: 'p1',
      type: 'CROSS_CLINIC_RECORD_SHARING',
      granted: false,
      channel: 'PORTAL_ACCOUNT',
    });
    expect(reqUpdateMany.mock.calls[0][0].data).toEqual({ revokedAt: expect.any(Date) });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CROSS_CLINIC_SHARING_TURNED_OFF', entityId: 'p1' }));

    jest.clearAllMocks();
    await setStandingSharing('p1', true);
    expect((prisma.consent.create as jest.Mock).mock.calls[0][0].data).toMatchObject({ granted: true, channel: 'PORTAL_ACCOUNT' });
    expect(reqUpdateMany).not.toHaveBeenCalled();
  });
});
