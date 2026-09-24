jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    patient: { findUniqueOrThrow: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ getScopedHistory: jest.fn() }));
jest.mock('../../src/services/staffService', () => ({ findActiveStaffById: jest.fn(), comparePin: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({ enqueueVisitSummarySms: jest.fn(), enqueueVisitSummaryEmail: jest.fn() }));

let mockEmailConfigured = true;
jest.mock('../../src/config/email', () => ({
  get emailConfigured() {
    return mockEmailConfigured;
  },
}));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { getScopedHistory } from '../../src/services/patientService';
import { findActiveStaffById, comparePin } from '../../src/services/staffService';
import { enqueueVisitSummaryEmail, enqueueVisitSummarySms } from '../../src/jobs/queue';
import {
  EncounterNotAccessibleError,
  EncounterNotConsultableError,
  EncounterNotReadyForCheckoutError,
  InvalidPinError,
  checkoutEncounter,
  getDoctorQueue,
  getEncounterForDoctor,
  submitConsultation,
} from '../../src/services/encounterService';

const mockFindMany = prisma.encounter.findMany as jest.Mock;
const mockFindFirst = prisma.encounter.findFirst as jest.Mock;
const mockUpdate = prisma.encounter.update as jest.Mock;
const mockFindPatient = (prisma as unknown as { patient: { findUniqueOrThrow: jest.Mock } }).patient.findUniqueOrThrow;
const mockRecordAudit = recordAuditEvent as jest.Mock;
const mockGetScopedHistory = getScopedHistory as jest.Mock;
const mockFindActiveStaffById = findActiveStaffById as jest.Mock;
const mockComparePin = comparePin as jest.Mock;
const mockEnqueueVisitSms = enqueueVisitSummarySms as jest.Mock;
const mockEnqueueVisitEmail = enqueueVisitSummaryEmail as jest.Mock;

const DOCTOR_STAFF = { id: 'staff-1', name: 'Dr. Amani Wambui', pinHash: 'hashed' };

beforeEach(() => {
  jest.clearAllMocks();
  mockEmailConfigured = true;
});

describe('getDoctorQueue', () => {
  it('queries scoped to the given clinic and department, only WAITING/IN_CONSULTATION, and only this doctor\'s own or unassigned encounters', async () => {
    mockFindMany.mockResolvedValue([]);

    await getDoctorQueue('clinic-A', 'dept-1', 'staff-1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clinicId: 'clinic-A',
          status: { in: ['WAITING', 'IN_CONSULTATION'] },
          checkIn: { departmentId: 'dept-1' },
          OR: [{ assignedDoctorId: 'staff-1' }, { assignedDoctorId: null }],
        },
      }),
    );
  });
});

describe('getEncounterForDoctor (queue-scoping guarantee)', () => {
  it('throws EncounterNotAccessibleError when the encounter does not match this clinic+department — never a generic lookup', async () => {
    mockFindFirst.mockResolvedValue(null); // simulates a real encounter that belongs to a different clinic/department

    await expect(getEncounterForDoctor('enc-other-clinic', 'clinic-A', 'dept-1', 'staff-1')).rejects.toThrow(
      EncounterNotAccessibleError,
    );
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('moves WAITING to IN_CONSULTATION, logs the view, and returns scoped history', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', patientId: 'patient-1', status: 'WAITING' });
    mockFindPatient.mockResolvedValue({
      id: 'patient-1',
      patientCode: 'ACI-1042',
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '+254712345678',
    });
    mockGetScopedHistory.mockResolvedValue({ history: [], hasHiddenHistoryElsewhere: true });

    const detail = await getEncounterForDoctor('enc-1', 'clinic-A', 'dept-1', 'staff-1');

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'enc-1' }, data: { status: 'IN_CONSULTATION' } });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PATIENT_HISTORY_VIEWED', entityId: 'patient-1', staffId: 'staff-1' }),
    );
    expect(mockGetScopedHistory).toHaveBeenCalledWith('patient-1', 'clinic-A', 'enc-1');
    expect(detail.status).toBe('IN_CONSULTATION');
    expect(detail.hasHiddenHistoryElsewhere).toBe(true);
  });

  it('does not re-transition an encounter already IN_CONSULTATION', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', patientId: 'patient-1', status: 'IN_CONSULTATION' });
    mockFindPatient.mockResolvedValue({ id: 'patient-1', patientCode: 'ACI-1042', firstName: 'Jane', lastName: 'W', phoneNumber: '+254712345678' });
    mockGetScopedHistory.mockResolvedValue({ history: [], hasHiddenHistoryElsewhere: false });

    await getEncounterForDoctor('enc-1', 'clinic-A', 'dept-1', 'staff-1');

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('submitConsultation', () => {
  it('rejects an encounter that is not in the doctor\'s own clinic+department', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(
      submitConsultation({
        encounterId: 'enc-1',
        clinicId: 'clinic-A',
        departmentId: 'dept-1',
        staffId: 'staff-1',
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
        pin: '1234',
      }),
    ).rejects.toThrow(EncounterNotAccessibleError);
    expect(mockFindActiveStaffById).not.toHaveBeenCalled();
  });

  it('rejects an encounter already past consultation (READY_FOR_CHECKOUT/DONE)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    await expect(
      submitConsultation({
        encounterId: 'enc-1',
        clinicId: 'clinic-A',
        departmentId: 'dept-1',
        staffId: 'staff-1',
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
        pin: '1234',
      }),
    ).rejects.toThrow(EncounterNotConsultableError);
    expect(mockFindActiveStaffById).not.toHaveBeenCalled();
  });

  it('rejects a wrong PIN — this IS the signing gate, so nothing is persisted and a CONSULTATION_SIGN_FAILED event is recorded', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION' });
    mockFindActiveStaffById.mockResolvedValue(DOCTOR_STAFF);
    mockComparePin.mockResolvedValue(false);

    await expect(
      submitConsultation({
        encounterId: 'enc-1',
        clinicId: 'clinic-A',
        departmentId: 'dept-1',
        staffId: 'staff-1',
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
        pin: 'wrong',
      }),
    ).rejects.toThrow(InvalidPinError);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONSULTATION_SIGN_FAILED', entityId: 'enc-1', staffId: 'staff-1' }),
    );
  });

  it('rejects when the signing staff record cannot be found (e.g. deactivated), same as a wrong PIN', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION' });
    mockFindActiveStaffById.mockResolvedValue(null);

    await expect(
      submitConsultation({
        encounterId: 'enc-1',
        clinicId: 'clinic-A',
        departmentId: 'dept-1',
        staffId: 'staff-1',
        diagnosis: 'Flu',
        prescription: 'Paracetamol',
        pin: '1234',
      }),
    ).rejects.toThrow(InvalidPinError);
    expect(mockComparePin).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('on a correct PIN, moves a valid encounter to READY_FOR_CHECKOUT, records CONSULTATION_SIGNED, and never touches payment/SMS', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION' });
    mockFindActiveStaffById.mockResolvedValue(DOCTOR_STAFF);
    mockComparePin.mockResolvedValue(true);
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    await submitConsultation({
      encounterId: 'enc-1',
      clinicId: 'clinic-A',
      departmentId: 'dept-1',
      staffId: 'staff-1',
      diagnosis: 'Flu',
      prescription: 'Paracetamol',
      pin: '1234',
    });

    expect(mockComparePin).toHaveBeenCalledWith(DOCTOR_STAFF, '1234');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'READY_FOR_CHECKOUT' }) }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CONSULTATION_SIGNED', entityId: 'enc-1', staffId: 'staff-1' }),
    );
    expect(mockEnqueueVisitSms).not.toHaveBeenCalled();
  });
});

describe('checkoutEncounter', () => {
  it('rejects an encounter not yet ready for checkout', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION', patient: { email: null } });

    await expect(checkoutEncounter('enc-1', 'clinic-A', 'staff-1')).rejects.toThrow(EncounterNotReadyForCheckoutError);
    expect(mockEnqueueVisitSms).not.toHaveBeenCalled();
    expect(mockEnqueueVisitEmail).not.toHaveBeenCalled();
  });

  it('marks DONE and sends the visit-summary SMS unconditionally, defaulting to sms-only (no email)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: 'jane@example.com' } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
    expect(mockEnqueueVisitEmail).not.toHaveBeenCalled();
  });

  it("doesn't enqueue email for an explicit 'sms' delivery method even when the patient has an email on file", async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: 'jane@example.com' } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1', 'sms');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
    expect(mockEnqueueVisitEmail).not.toHaveBeenCalled();
  });

  it("enqueues email in addition to (never instead of) SMS when 'sms_and_email' is chosen and the patient has an email", async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: 'jane@example.com' } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1', 'sms_and_email');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
    expect(mockEnqueueVisitEmail).toHaveBeenCalledWith({ encounterId: 'enc-1' });
  });

  it("skips email (SMS still sent) when 'sms_and_email' is chosen but the patient has no email on file", async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: null } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1', 'sms_and_email');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
    expect(mockEnqueueVisitEmail).not.toHaveBeenCalled();
  });

  it("skips email (SMS still sent) when 'sms_and_email' is chosen and the patient has an email, but email delivery isn't configured", async () => {
    mockEmailConfigured = false;
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: 'jane@example.com' } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1', 'sms_and_email');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
    expect(mockEnqueueVisitEmail).not.toHaveBeenCalled();
  });

  it('records the chosen delivery method on the checkout audit event', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT', patient: { email: 'jane@example.com' } });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1', 'sms_and_email');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ENCOUNTER_CHECKED_OUT', metadata: { deliveryMethod: 'sms_and_email' } }),
    );
  });
});
