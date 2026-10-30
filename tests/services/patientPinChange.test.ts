// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/db/prisma', () => ({
  prisma: { patient: { findUniqueOrThrow: jest.fn(), update: jest.fn() } },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { setPatientPin } from '../../src/services/patientService';
import { isLockedOut, recordWrongPin } from '../../src/services/pinLockout';
import { isSessionRevoked } from '../../src/services/sessionRevocation';
import { PIN_LOCKOUT } from '../../src/config/constants';
import { resetFakeRedis } from '../helpers/fakeRedis';

const mockFind = prisma.patient.findUniqueOrThrow as jest.Mock;
const mockUpdate = prisma.patient.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeRedis();
});

describe('setPatientPin — the actual PIN change (C6, C7, C17)', () => {
  it('logs the PIN change itself, with no phone number or PIN in the audit row', async () => {
    mockFind.mockResolvedValue({ phoneVerifiedAt: new Date() });
    await setPatientPin('p1', '730194', 'SMS_CODE');
    const audit = (recordAuditEvent as jest.Mock).mock.calls[0][0];
    expect(audit).toEqual({
      actorType: 'PATIENT',
      actorId: 'p1',
      action: 'PATIENT_PIN_CHANGED',
      entityType: 'Patient',
      entityId: 'p1',
      metadata: { via: 'SMS_CODE' },
    });
    expect(JSON.stringify(audit)).not.toContain('730194');
  });

  it('lifts a lockout and logs out sessions opened with the old PIN', async () => {
    for (let i = 0; i < PIN_LOCKOUT.maxAttempts; i++) await recordWrongPin('patient:p1');
    const issuedBefore = Date.now() - 1000;
    mockFind.mockResolvedValue({ phoneVerifiedAt: null });
    await setPatientPin('p1', '730194', 'SMS_CODE');
    expect(await isLockedOut('patient:p1')).toBe(false);
    expect(await isSessionRevoked(['patient:p1'], issuedBefore)).toBe(true);
  });

  it('marks the phone verified the first time (SMS code or in-person), and never overwrites an earlier verification', async () => {
    mockFind.mockResolvedValue({ phoneVerifiedAt: null });
    await setPatientPin('p1', '730194', 'IN_PERSON_CODE');
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ phoneVerifiedVia: 'IN_PERSON', phoneVerifiedAt: expect.any(Date) });

    mockFind.mockResolvedValue({ phoneVerifiedAt: new Date('2026-01-01') });
    await setPatientPin('p1', '730194', 'SMS_CODE');
    expect(mockUpdate.mock.calls[1][0].data).not.toHaveProperty('phoneVerifiedAt');
  });
});
