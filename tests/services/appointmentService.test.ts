jest.mock('../../src/db/prisma', () => ({
  prisma: {
    appointment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import {
  AppointmentNotActionableError,
  AppointmentNotFoundError,
  PastScheduledTimeError,
  cancelAppointmentByStaff,
  cancelOwnAppointment,
  confirmAppointment,
  findArrivalMatch,
  getAppointmentForArrival,
  listClinicAppointments,
  listDepartmentAppointmentsToday,
  listOwnAppointments,
  markAppointmentCompleted,
  requestAppointment,
} from '../../src/services/appointmentService';

const mockCreate = prisma.appointment.create as jest.Mock;
const mockFindMany = prisma.appointment.findMany as jest.Mock;
const mockFindFirst = prisma.appointment.findFirst as jest.Mock;
const mockUpdate = prisma.appointment.update as jest.Mock;
const mockRecordAudit = recordAuditEvent as jest.Mock;

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestAppointment', () => {
  it('rejects a scheduledFor in the past, without touching the database', async () => {
    await expect(
      requestAppointment({ patientId: 'patient-1', clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: PAST }),
    ).rejects.toThrow(PastScheduledTimeError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a REQUESTED appointment and records a patient-attributed audit event', async () => {
    mockCreate.mockResolvedValue({ id: 'appt-1', status: 'REQUESTED' });

    const result = await requestAppointment({ patientId: 'patient-1', clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: FUTURE });

    expect(mockCreate).toHaveBeenCalledWith({
      data: { patientId: 'patient-1', clinicId: 'clinic-A', departmentId: 'dept-1', scheduledFor: FUTURE },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'PATIENT', actorId: 'patient-1', action: 'APPOINTMENT_REQUESTED', entityId: 'appt-1' }),
    );
    expect(result.status).toBe('REQUESTED');
  });
});

describe('listOwnAppointments', () => {
  it("maps each appointment's clinic/department name, scoped to the given patient, soonest first", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'appt-1',
        status: 'CONFIRMED',
        scheduledFor: FUTURE,
        clinic: { name: 'Sunrise Family Clinic' },
        department: { name: 'General' },
      },
    ]);

    const result = await listOwnAppointments('patient-1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 'patient-1' }, orderBy: { scheduledFor: 'asc' } }),
    );
    expect(result).toEqual([
      { id: 'appt-1', clinicName: 'Sunrise Family Clinic', departmentName: 'General', scheduledFor: FUTURE, status: 'CONFIRMED' },
    ]);
  });
});

describe('cancelOwnAppointment', () => {
  it("throws AppointmentNotFoundError for someone else's appointment, without distinguishing from a bad id", async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(cancelOwnAppointment('patient-1', 'appt-1')).rejects.toThrow(AppointmentNotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects cancelling an appointment that is already CANCELLED or COMPLETED', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', patientId: 'patient-1', status: 'COMPLETED' });

    await expect(cancelOwnAppointment('patient-1', 'appt-1')).rejects.toThrow(AppointmentNotActionableError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('cancels an open (REQUESTED/CONFIRMED) appointment and attributes it to the patient', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', patientId: 'patient-1', status: 'REQUESTED' });
    mockUpdate.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED' });

    await cancelOwnAppointment('patient-1', 'appt-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { status: 'CANCELLED', cancelledByType: 'PATIENT', cancelledAt: expect.any(Date) },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'PATIENT', actorId: 'patient-1', action: 'APPOINTMENT_CANCELLED', entityId: 'appt-1' }),
    );
  });
});

describe('listClinicAppointments', () => {
  it('scopes to the clinic and maps patient/department fields', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'appt-1',
        status: 'REQUESTED',
        scheduledFor: FUTURE,
        patient: { id: 'patient-1', firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-1042', phoneNumber: '+254712345678' },
        department: { name: 'General' },
      },
    ]);

    const result = await listClinicAppointments('clinic-A');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 'clinic-A', scheduledFor: { gte: expect.any(Date) } } }),
    );
    expect(result).toEqual([
      {
        id: 'appt-1',
        patientId: 'patient-1',
        patientName: 'Jane Wanjiru',
        patientCode: 'ACI-1042',
        phoneNumber: '+254712345678',
        departmentName: 'General',
        scheduledFor: FUTURE,
        status: 'REQUESTED',
      },
    ]);
  });
});

describe('confirmAppointment', () => {
  it('throws AppointmentNotFoundError for a bad id or a cross-clinic attempt', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(confirmAppointment({ clinicId: 'clinic-A', appointmentId: 'appt-1', staffId: 'staff-1' })).rejects.toThrow(
      AppointmentNotFoundError,
    );
  });

  it('rejects confirming anything but a REQUESTED appointment', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', clinicId: 'clinic-A', status: 'CONFIRMED' });

    await expect(confirmAppointment({ clinicId: 'clinic-A', appointmentId: 'appt-1', staffId: 'staff-1' })).rejects.toThrow(
      AppointmentNotActionableError,
    );
  });

  it('confirms a REQUESTED appointment and attributes it to the confirming staff member', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', clinicId: 'clinic-A', status: 'REQUESTED' });
    mockUpdate.mockResolvedValue({ id: 'appt-1', status: 'CONFIRMED' });

    await confirmAppointment({ clinicId: 'clinic-A', appointmentId: 'appt-1', staffId: 'staff-1' });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { status: 'CONFIRMED', confirmedByStaffId: 'staff-1', confirmedAt: expect.any(Date) },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'STAFF', actorId: 'staff-1', action: 'APPOINTMENT_CONFIRMED', entityId: 'appt-1' }),
    );
  });
});

describe('cancelAppointmentByStaff', () => {
  it('cancels from either REQUESTED or CONFIRMED and attributes it to staff', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', clinicId: 'clinic-A', status: 'CONFIRMED' });
    mockUpdate.mockResolvedValue({ id: 'appt-1', status: 'CANCELLED' });

    await cancelAppointmentByStaff({ clinicId: 'clinic-A', appointmentId: 'appt-1', staffId: 'staff-1' });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { status: 'CANCELLED', cancelledByType: 'STAFF', cancelledByStaffId: 'staff-1', cancelledAt: expect.any(Date) },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'STAFF', actorId: 'staff-1', action: 'APPOINTMENT_CANCELLED', entityId: 'appt-1' }),
    );
  });

  it('rejects cancelling an already-CANCELLED or COMPLETED appointment', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1', clinicId: 'clinic-A', status: 'COMPLETED' });

    await expect(cancelAppointmentByStaff({ clinicId: 'clinic-A', appointmentId: 'appt-1', staffId: 'staff-1' })).rejects.toThrow(
      AppointmentNotActionableError,
    );
  });
});

describe('listDepartmentAppointmentsToday', () => {
  it('only returns CONFIRMED appointments scoped to today and this department', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'appt-1', scheduledFor: FUTURE, patient: { firstName: 'Jane', lastName: 'Wanjiru', patientCode: 'ACI-1042' } },
    ]);

    const result = await listDepartmentAppointmentsToday('clinic-A', 'dept-1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clinicId: 'clinic-A', departmentId: 'dept-1', status: 'CONFIRMED' }),
      }),
    );
    expect(result).toEqual([{ id: 'appt-1', patientName: 'Jane Wanjiru', patientCode: 'ACI-1042', scheduledFor: FUTURE }]);
  });
});

describe('findArrivalMatch', () => {
  it('matches on REQUESTED or CONFIRMED, scoped to patient/clinic/department and today', async () => {
    mockFindFirst.mockResolvedValue({ id: 'appt-1' });

    const result = await findArrivalMatch('patient-1', 'clinic-A', 'dept-1');

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 'patient-1',
          clinicId: 'clinic-A',
          departmentId: 'dept-1',
          status: { in: ['REQUESTED', 'CONFIRMED'] },
        }),
        orderBy: { scheduledFor: 'asc' },
      }),
    );
    expect(result).toEqual({ id: 'appt-1' });
  });

  it('returns null when nothing matches', async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(findArrivalMatch('patient-1', 'clinic-A', 'dept-1')).resolves.toBeNull();
  });
});

describe('markAppointmentCompleted', () => {
  it('sets the status to COMPLETED with no other guard', async () => {
    await markAppointmentCompleted('appt-1');
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'appt-1' }, data: { status: 'COMPLETED' } });
  });
});

describe('getAppointmentForArrival', () => {
  it('throws AppointmentNotFoundError for a bad id or cross-clinic attempt', async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(getAppointmentForArrival('appt-1', 'clinic-A')).rejects.toThrow(AppointmentNotFoundError);
  });

  it('rejects an already CANCELLED/COMPLETED appointment', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'appt-1',
      clinicId: 'clinic-A',
      departmentId: 'dept-1',
      patientId: 'patient-1',
      status: 'CANCELLED',
      patient: { phoneNumber: '+254712345678' },
    });
    await expect(getAppointmentForArrival('appt-1', 'clinic-A')).rejects.toThrow(AppointmentNotActionableError);
  });

  it('returns the arrival details for an open appointment', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'appt-1',
      clinicId: 'clinic-A',
      departmentId: 'dept-1',
      patientId: 'patient-1',
      status: 'CONFIRMED',
      patient: { phoneNumber: '+254712345678' },
      clinic: { name: 'Sunrise Family Clinic' },
    });

    const result = await getAppointmentForArrival('appt-1', 'clinic-A');

    expect(result).toEqual({
      id: 'appt-1',
      patientId: 'patient-1',
      clinicId: 'clinic-A',
      clinicName: 'Sunrise Family Clinic',
      departmentId: 'dept-1',
      phoneNumberE164: '+254712345678',
    });
  });
});
