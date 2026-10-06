jest.mock('../../src/db/prisma', () => {
  const tx = {
    patient: { create: jest.fn() },
    consent: { create: jest.fn() },
    clinic: { create: jest.fn() },
    department: { createMany: jest.fn() },
    staff: { create: jest.fn() },
    legalAcceptance: { createMany: jest.fn() },
  };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      legalAcceptance: { createMany: jest.fn(), findFirst: jest.fn() },
      patient: { findUnique: jest.fn() },
      clinic: { findUnique: jest.fn() },
      staff: { findUnique: jest.fn() },
      __tx: tx,
    },
  };
});
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { PRIVACY_NOTICE_VERSION, TERMS_OF_SERVICE_VERSION } from '../../src/config/legal';
import {
  patientNeedsTermsAcceptance,
  patientNeedsWebCheckInPrivacyAck,
  recordLegalAcceptances,
  staffNeedsTermsAcceptance,
  walkInNeedsPrivacyAck,
} from '../../src/services/legalService';
import { registerPatient } from '../../src/services/patientService';
import { registerClinic } from '../../src/services/clinicService';

const tx = (prisma as unknown as { __tx: Record<string, Record<string, jest.Mock>> }).__tx;
const mockFindFirst = prisma.legalAcceptance.findFirst as jest.Mock;
const mockCreateMany = prisma.legalAcceptance.createMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.patient.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.clinic.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('recordLegalAcceptances', () => {
  it("saves one row per document, each with that document's current version", async () => {
    await recordLegalAcceptances(['TERMS_OF_SERVICE', 'PRIVACY_NOTICE'], 'PATIENT_PORTAL_LOGIN', { patientId: 'p-1' });
    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'PATIENT_PORTAL_LOGIN', patientId: 'p-1' },
        { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context: 'PATIENT_PORTAL_LOGIN', patientId: 'p-1' },
      ],
    });
  });
});

describe('who needs to be asked', () => {
  it('only an acceptance of the current version counts', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await patientNeedsTermsAcceptance('p-1')).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ patientId: 'p-1', document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION }),
      }),
    );

    mockFindFirst.mockResolvedValue({ id: 'la-1' });
    expect(await patientNeedsTermsAcceptance('p-1')).toBe(false);
  });

  it('web check-in asks once per patient per clinic, counting only the patient’s own acknowledgment', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await patientNeedsWebCheckInPrivacyAck('p-1', 'clinic-A')).toBe(true);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({
      patientId: 'p-1',
      clinicId: 'clinic-A',
      context: 'PATIENT_WEB_CHECKIN',
      document: 'PRIVACY_NOTICE',
      version: PRIVACY_NOTICE_VERSION,
    });
  });

  it('walk-in asks once per patient per clinic, and accepts the patient’s own web acknowledgment there', async () => {
    mockFindFirst.mockResolvedValue({ id: 'la-1' });
    expect(await walkInNeedsPrivacyAck('p-1', 'clinic-A')).toBe(false);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({
      patientId: 'p-1',
      clinicId: 'clinic-A',
      context: { in: ['WALK_IN_CHECKIN', 'PATIENT_WEB_CHECKIN'] },
      document: 'PRIVACY_NOTICE',
      version: PRIVACY_NOTICE_VERSION,
    });
  });

  it('staff accept the Terms at clinic registration or at login', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await staffNeedsTermsAcceptance('staff-1')).toBe(true);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({
      staffId: 'staff-1',
      context: { in: ['CLINIC_REGISTRATION', 'STAFF_LOGIN'] },
      document: 'TERMS_OF_SERVICE',
      version: TERMS_OF_SERVICE_VERSION,
    });
  });
});

describe('acceptance saved in the same transaction as the account', () => {
  it('patient signup records the Terms and Privacy Notice with their versions', async () => {
    tx.patient!.create!.mockResolvedValue({ id: 'p-new', patientCode: 'ACI-1234' });
    await registerPatient({
      phoneNumberE164: '+254712345678',
      firstName: 'Jane',
      lastName: 'Wanjiru',
      sex: 'UNKNOWN',
      consentChannel: 'PORTAL',
      crossClinicConsent: false,
      acceptedTermsAndPrivacyNotice: true,
    });
    expect(tx.legalAcceptance!.createMany).toHaveBeenCalledWith({
      data: [
        { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'PATIENT_SIGNUP', patientId: 'p-new' },
        { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context: 'PATIENT_SIGNUP', patientId: 'p-new' },
      ],
    });
  });

  it('a patient registered elsewhere (USSD, walk-in) records no Terms acceptance', async () => {
    tx.patient!.create!.mockResolvedValue({ id: 'p-new', patientCode: 'ACI-1234' });
    await registerPatient({
      phoneNumberE164: '+254712345678',
      firstName: 'Jane',
      lastName: 'Wanjiru',
      sex: 'UNKNOWN',
      consentChannel: 'USSD',
      crossClinicConsent: false,
    });
    expect(tx.legalAcceptance!.createMany).not.toHaveBeenCalled();
  });

  it('clinic registration records both documents against the clinic and its admin', async () => {
    tx.clinic!.create!.mockResolvedValue({ id: 'clinic-new', name: 'Sunrise', inviteCode: 'SUNRISE-7F2K' });
    tx.staff!.create!.mockResolvedValue({ id: 'admin-1', staffCode: 'ACI-STF-1001' });
    await registerClinic({
      name: 'Sunrise',
      adminName: 'Lisa Jane',
      adminPhoneNumberE164: '+254712345678',
      adminPin: '730194',
      acceptedTermsAndPrivacyNotice: true,
    });
    expect(tx.legalAcceptance!.createMany).toHaveBeenCalledWith({
      data: [
        { document: 'TERMS_OF_SERVICE', version: TERMS_OF_SERVICE_VERSION, context: 'CLINIC_REGISTRATION', clinicId: 'clinic-new', staffId: 'admin-1' },
        { document: 'PRIVACY_NOTICE', version: PRIVACY_NOTICE_VERSION, context: 'CLINIC_REGISTRATION', clinicId: 'clinic-new', staffId: 'admin-1' },
      ],
    });
  });
});
