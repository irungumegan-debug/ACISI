jest.mock('../../src/db/prisma', () => {
  const tx = { patient: { update: jest.fn() } };
  return {
    prisma: {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      clinic: { findUnique: jest.fn() },
      patient: { findMany: jest.fn(), findFirst: jest.fn() },
      encounter: { groupBy: jest.fn() },
      clinicPatient: { updateMany: jest.fn(), upsert: jest.fn() },
      __tx: tx,
    },
  };
});
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/legalService', () => ({ recordLegalAcceptances: jest.fn() }));
jest.mock('../../src/services/smsSender', () => ({ sendSms: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({
  findPatientsByPhone: jest.fn(),
  findPatientByCode: jest.fn(),
  registerPatient: jest.fn(),
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { recordLegalAcceptances } from '../../src/services/legalService';
import { sendSms } from '../../src/services/smsSender';
import { findPatientByCode, findPatientsByPhone, registerPatient } from '../../src/services/patientService';
import { addPatient, AddPatientInput, lookupPatients, PatientRegistryError } from '../../src/services/clinicPatientService';

const db = prisma as unknown as {
  clinic: { findUnique: jest.Mock };
  patient: { findMany: jest.Mock; findFirst: jest.Mock };
  encounter: { groupBy: jest.Mock };
  clinicPatient: { updateMany: jest.Mock };
  __tx: { patient: { update: jest.Mock } };
};
const mockOnPhone = findPatientsByPhone as jest.Mock;
const mockRegister = registerPatient as jest.Mock;
const mockSend = sendSms as jest.Mock;

const PARENT = {
  id: 'p-parent',
  patientCode: 'ACS-48217',
  firstName: 'Jane',
  lastName: 'Wanjiru',
  phoneNumber: '+254712345678',
  dateOfBirth: new Date('1990-03-15T00:00:00Z'),
  dateOfBirthEstimated: false,
  sex: 'FEMALE',
  smsOptOut: false,
};

function input(overrides: Partial<AddPatientInput> = {}): AddPatientInput {
  return {
    clinicId: 'clinic-A',
    staffId: 'staff-1',
    fullName: 'Brian Kamau',
    phone: '0712 345 678',
    dateOfBirth: '2015-06-01',
    sex: 'MALE',
    registrationConsent: true,
    privacyNoticeExplained: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.clinic.findUnique.mockResolvedValue({ id: 'clinic-A', name: 'Sunrise Clinic', isActive: true });
  db.patient.findMany.mockResolvedValue([]);
  db.encounter.groupBy.mockResolvedValue([]);
  mockOnPhone.mockResolvedValue([]);
  mockRegister.mockImplementation(async (i) => ({ id: 'p-new', patientCode: 'ACS-55555', phoneNumber: i.phoneNumberE164, smsOptOut: false }));
  mockSend.mockResolvedValue(true);
});

describe('addPatient', () => {
  it('registers, links to the clinic, records the privacy notice and sends one registration SMS', async () => {
    const res = await addPatient(input());

    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberE164: '+254712345678',
        firstName: 'Brian',
        lastName: 'Kamau',
        dateOfBirth: new Date('2015-06-01T00:00:00Z'),
        sex: 'MALE',
        clinicLink: { clinicId: 'clinic-A', source: 'ADDED', addedByStaffId: 'staff-1' },
      }),
    );
    expect(recordLegalAcceptances).toHaveBeenCalledWith(
      ['PRIVACY_NOTICE'],
      'CLINIC_ADDED_PATIENT',
      { patientId: 'p-new', staffId: 'staff-1', clinicId: 'clinic-A' },
      expect.anything(),
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toBe("You're registered with Sunrise Clinic on ACISI. Check in from home next time at acisi.co.ke.");
    expect(db.clinicPatient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { invitedAt: expect.any(Date) } }));
    expect(res).toEqual({ patient: { id: 'p-new', name: 'Brian Kamau', patientCode: 'ACS-55555' }, sms: 'sent' });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'PATIENT_ADDED_BY_CLINIC', clinicId: 'clinic-A', patientId: 'p-new' }));
  });

  it('sends no SMS to a patient who does not want SMS', async () => {
    const res = await addPatient(input({ smsOptOut: true }));
    expect(mockSend).not.toHaveBeenCalled();
    expect(db.__tx.patient.update).toHaveBeenCalledWith({ where: { id: 'p-new' }, data: { smsOptOut: true, smsOptOutUpdatedAt: expect.any(Date) } });
    expect(res.sms).toBe('opted_out');
  });

  it('refuses the exact same person on the same phone as a duplicate', async () => {
    mockOnPhone.mockResolvedValue([PARENT]);
    const err = await addPatient(input({ fullName: 'jane  wanjiru', dateOfBirth: '1990-03-15', confirmedNewPersonOnPhone: true })).catch((e) => e);
    expect(err).toBeInstanceOf(PatientRegistryError);
    expect(err.status).toBe(409);
    expect(err.details.reason).toBe('duplicate');
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows the other patients on a shared phone and waits for staff to confirm a different person', async () => {
    mockOnPhone.mockResolvedValue([PARENT]);
    const err = await addPatient(input()).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.details.reason).toBe('phone_has_patients');
    expect(err.details.existing).toEqual([expect.objectContaining({ patientCode: 'ACS-48217', name: 'Jane Wanjiru' })]);
    expect(mockRegister).not.toHaveBeenCalled();

    await addPatient(input({ confirmedNewPersonOnPhone: true }));
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no consent', { registrationConsent: false }],
    ['privacy notice not explained', { privacyNoticeExplained: false }],
    ['only one name', { fullName: 'Brian' }],
    ['impossible date of birth', { dateOfBirth: '2015-02-30' }],
    ['future date of birth', { dateOfBirth: '2999-01-01' }],
    ['bad phone', { phone: '12345' }],
  ])('refuses %s without creating anything', async (_label, overrides) => {
    await expect(addPatient(input(overrides))).rejects.toMatchObject({ status: 400 });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('lookupPatients', () => {
  const CHILD = { ...PARENT, id: 'p-child', patientCode: 'ACS-11111', firstName: 'Brian', dateOfBirth: new Date('2015-06-01T00:00:00Z') };

  it('returns every patient on a shared phone, with full DOB only for patients linked to this clinic', async () => {
    mockOnPhone.mockResolvedValue([PARENT, CHILD]);
    db.patient.findMany.mockResolvedValue([{ id: 'p-parent' }]);
    const res = await lookupPatients('0712345678', 'clinic-A', 'staff-1');
    expect(res.kind).toBe('phone');
    expect(res.patients).toEqual([
      expect.objectContaining({ id: 'p-parent', dateOfBirth: '1990-03-15', birthYear: 1990, linkedToClinic: true }),
      expect.objectContaining({ id: 'p-child', dateOfBirth: null, birthYear: 2015, linkedToClinic: false }),
    ]);
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('finds by ACISI ID, case-insensitively', async () => {
    (findPatientByCode as jest.Mock).mockResolvedValue(PARENT);
    const res = await lookupPatients(' acs-48217 ', 'clinic-A', 'staff-1');
    expect(findPatientByCode).toHaveBeenCalledWith('ACS-48217');
    expect(res.kind).toBe('patientCode');
    expect(res.patients).toHaveLength(1);
  });

  it('rejects something that is neither a phone nor an ACISI ID', async () => {
    await expect(lookupPatients('hello', 'clinic-A', 'staff-1')).rejects.toMatchObject({ status: 400 });
  });
});
