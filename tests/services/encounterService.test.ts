jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    patient: { findUniqueOrThrow: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/patientService', () => ({ getScopedHistory: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({ enqueueVisitSummarySms: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { getScopedHistory } from '../../src/services/patientService';
import { enqueueVisitSummarySms } from '../../src/jobs/queue';
import {
  EncounterNotAccessibleError,
  EncounterNotConsultableError,
  EncounterNotReadyForCheckoutError,
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
const mockEnqueueVisitSms = enqueueVisitSummarySms as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
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
      }),
    ).rejects.toThrow(EncounterNotAccessibleError);
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
      }),
    ).rejects.toThrow(EncounterNotConsultableError);
  });

  it('moves a valid encounter to READY_FOR_CHECKOUT without touching payment/SMS', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION' });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });

    await submitConsultation({
      encounterId: 'enc-1',
      clinicId: 'clinic-A',
      departmentId: 'dept-1',
      staffId: 'staff-1',
      diagnosis: 'Flu',
      prescription: 'Paracetamol',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'READY_FOR_CHECKOUT' }) }),
    );
    expect(mockEnqueueVisitSms).not.toHaveBeenCalled();
  });
});

describe('checkoutEncounter', () => {
  it('rejects an encounter not yet ready for checkout', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'IN_CONSULTATION' });

    await expect(checkoutEncounter('enc-1', 'clinic-A', 'staff-1')).rejects.toThrow(EncounterNotReadyForCheckoutError);
    expect(mockEnqueueVisitSms).not.toHaveBeenCalled();
  });

  it('marks DONE and sends the visit-summary SMS only on checkout', async () => {
    mockFindFirst.mockResolvedValue({ id: 'enc-1', status: 'READY_FOR_CHECKOUT' });
    mockUpdate.mockResolvedValue({ id: 'enc-1', status: 'DONE' });

    await checkoutEncounter('enc-1', 'clinic-A', 'staff-1');

    expect(mockEnqueueVisitSms).toHaveBeenCalledWith({ encounterId: 'enc-1' });
  });
});
