jest.mock('../../src/db/prisma', () => ({
  prisma: {
    checkIn: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    encounter: { create: jest.fn() },
    mpesaTransaction: { create: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({
  publishCheckInPaid: jest.fn(),
  publishCheckInFailed: jest.fn(),
}));
jest.mock('../../src/jobs/queue', () => ({
  enqueueSmsReceipt: jest.fn(),
}));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));
jest.mock('../../src/services/appointmentService', () => ({
  findArrivalMatch: jest.fn(),
  getAppointmentForArrival: jest.fn(),
  markAppointmentCompleted: jest.fn(),
}));

import { prisma } from '../../src/db/prisma';
import { publishCheckInFailed } from '../../src/services/realtimeEvents';
import { recordAuditEvent } from '../../src/services/auditService';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import {
  findArrivalMatch,
  getAppointmentForArrival,
  markAppointmentCompleted,
} from '../../src/services/appointmentService';
import { checkInPatientForAppointment, initiateCheckIn } from '../../src/services/checkInService';

const mockFindUniqueCheckIn = prisma.checkIn.findUnique as jest.Mock;
const mockCreateCheckIn = prisma.checkIn.create as jest.Mock;
const mockUpdateCheckIn = prisma.checkIn.update as jest.Mock;
const mockPublishFailed = publishCheckInFailed as jest.Mock;
const mockInitiateStkPush = initiateStkPush as jest.Mock;
const mockFindArrivalMatch = findArrivalMatch as jest.Mock;
const mockGetAppointmentForArrival = getAppointmentForArrival as jest.Mock;
const mockMarkAppointmentCompleted = markAppointmentCompleted as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;

const PENDING_CHECK_IN = {
  id: 'ci-1',
  patientId: 'patient-1',
  clinicId: 'clinic-A',
  departmentId: 'dept-1',
  status: 'PENDING_PAYMENT',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateCheckIn.mockResolvedValue({
    ...PENDING_CHECK_IN,
    status: 'PAID',
    paidAt: new Date(),
    patient: { firstName: 'Jane', lastName: 'Wanjiru' },
  });
  mockFindArrivalMatch.mockResolvedValue(null);
});

describe('initiateCheckIn (STK push fails to initiate)', () => {
  it('still creates and persists the CheckIn as FAILED, and publishes a live-queue event so an already-open dashboard picks it up', async () => {
    mockFindUniqueCheckIn.mockResolvedValue(null); // no existing check-in for this ussdSessionId
    mockCreateCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, id: 'ci-2' });
    mockInitiateStkPush.mockRejectedValue(new Error('Daraja unreachable'));
    mockUpdateCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, id: 'ci-2', status: 'FAILED' });

    const { checkIn } = await initiateCheckIn({
      ussdSessionId: 'session-1',
      patientId: 'patient-1',
      clinicId: 'clinic-A',
      clinicName: 'Sunrise Family Clinic',
      departmentId: 'dept-1',
      phoneNumberE164: '+254712345678',
    });

    expect(mockCreateCheckIn).toHaveBeenCalled(); // the row is created before the STK push is even attempted
    expect(mockUpdateCheckIn).toHaveBeenCalledWith({ where: { id: 'ci-2' }, data: { status: 'FAILED' } });
    expect(checkIn.status).toBe('FAILED');
    expect(mockPublishFailed).toHaveBeenCalledWith({ checkInId: 'ci-2', clinicId: 'clinic-A' });
  });
});

describe('initiateCheckIn (appointment linking)', () => {
  const NEW_CHECK_IN_INPUT = {
    ussdSessionId: 'session-arrival',
    patientId: 'patient-1',
    clinicId: 'clinic-A',
    clinicName: 'Sunrise Family Clinic',
    departmentId: 'dept-1',
    phoneNumberE164: '+254712345678',
  };

  beforeEach(() => {
    mockFindUniqueCheckIn.mockResolvedValue(null);
    mockInitiateStkPush.mockResolvedValue({
      checkoutRequestId: 'checkout-1',
      merchantRequestId: 'merchant-1',
    });
  });

  it('links a same-day match found automatically when no appointmentId is given, and marks it completed', async () => {
    mockFindArrivalMatch.mockResolvedValue({ id: 'appt-1' });
    mockCreateCheckIn.mockResolvedValue({ id: 'ci-9', clinicId: 'clinic-A', appointmentId: 'appt-1' });

    await initiateCheckIn(NEW_CHECK_IN_INPUT);

    expect(mockFindArrivalMatch).toHaveBeenCalledWith('patient-1', 'clinic-A', 'dept-1');
    expect(mockCreateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appointmentId: 'appt-1' }) }),
    );
    expect(mockMarkAppointmentCompleted).toHaveBeenCalledWith('appt-1');
  });

  it('never runs the automatic lookup when the caller already supplies an explicit appointmentId', async () => {
    mockCreateCheckIn.mockResolvedValue({ id: 'ci-10', clinicId: 'clinic-A', appointmentId: 'appt-2' });

    await initiateCheckIn({ ...NEW_CHECK_IN_INPUT, appointmentId: 'appt-2' });

    expect(mockFindArrivalMatch).not.toHaveBeenCalled();
    expect(mockCreateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appointmentId: 'appt-2' }) }),
    );
    expect(mockMarkAppointmentCompleted).toHaveBeenCalledWith('appt-2');
  });

  it('leaves an ordinary walk-in with no appointment untouched when nothing matches', async () => {
    mockFindArrivalMatch.mockResolvedValue(null);
    mockCreateCheckIn.mockResolvedValue({ id: 'ci-11', clinicId: 'clinic-A', appointmentId: null });

    await initiateCheckIn(NEW_CHECK_IN_INPUT);

    expect(mockCreateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appointmentId: null }) }),
    );
    expect(mockMarkAppointmentCompleted).not.toHaveBeenCalled();
  });
});

describe('checkInPatientForAppointment', () => {
  it('checks the patient in against the given appointment and records a staff-attributed audit event', async () => {
    mockGetAppointmentForArrival.mockResolvedValue({
      id: 'appt-3',
      patientId: 'patient-1',
      clinicId: 'clinic-A',
      clinicName: 'Sunrise Family Clinic',
      departmentId: 'dept-1',
      phoneNumberE164: '+254712345678',
    });
    mockFindUniqueCheckIn.mockResolvedValue(null);
    mockCreateCheckIn.mockResolvedValue({ id: 'ci-12', clinicId: 'clinic-A', appointmentId: 'appt-3' });
    mockUpdateCheckIn.mockResolvedValue({
      id: 'ci-12',
      clinicId: 'clinic-A',
      appointmentId: 'appt-3',
      status: 'PENDING_PAYMENT',
    });
    mockInitiateStkPush.mockResolvedValue({
      checkoutRequestId: 'checkout-2',
      merchantRequestId: 'merchant-2',
    });

    await checkInPatientForAppointment('appt-3', 'clinic-A', 'staff-1');

    expect(mockGetAppointmentForArrival).toHaveBeenCalledWith('appt-3', 'clinic-A');
    expect(mockCreateCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          patientId: 'patient-1',
          departmentId: 'dept-1',
          appointmentId: 'appt-3',
          ussdSessionId: expect.stringContaining('STAFF-'),
        }),
      }),
    );
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'STAFF',
        actorId: 'staff-1',
        action: 'APPOINTMENT_STAFF_CHECKED_IN',
        entityType: 'Appointment',
        entityId: 'appt-3',
        metadata: { checkInId: 'ci-12' },
      }),
    );
  });

  it('propagates a not-found/not-actionable error from the appointment lookup without creating a CheckIn', async () => {
    mockGetAppointmentForArrival.mockRejectedValue(new Error('nope'));

    await expect(checkInPatientForAppointment('appt-404', 'clinic-A', 'staff-1')).rejects.toThrow('nope');
    expect(mockCreateCheckIn).not.toHaveBeenCalled();
  });
});
