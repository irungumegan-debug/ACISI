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
  scheduleStkStatusCheck: jest.fn(),
}));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';
import { publishCheckInFailed } from '../../src/services/realtimeEvents';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import { CheckInNotPendingError, applyPaymentResult, confirmCheckInPaidManually, initiateCheckIn } from '../../src/services/checkInService';

const mockFindUniqueCheckIn = prisma.checkIn.findUnique as jest.Mock;
const mockFindFirstCheckIn = prisma.checkIn.findFirst as jest.Mock;
const mockCreateCheckIn = prisma.checkIn.create as jest.Mock;
const mockUpdateCheckIn = prisma.checkIn.update as jest.Mock;
const mockCreateEncounter = prisma.encounter.create as jest.Mock;
const mockAssignDoctor = assignDoctorForCheckIn as jest.Mock;
const mockPublishFailed = publishCheckInFailed as jest.Mock;
const mockInitiateStkPush = initiateStkPush as jest.Mock;

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
});

describe('confirmCheckInPaidManually', () => {
  it('rejects a check-in that is already PAID', async () => {
    mockFindFirstCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, status: 'PAID' });

    await expect(confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1')).rejects.toThrow(CheckInNotPendingError);
    expect(mockAssignDoctor).not.toHaveBeenCalled();
  });

  it('rejects a check-in that is CANCELLED', async () => {
    mockFindFirstCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, status: 'CANCELLED' });

    await expect(confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1')).rejects.toThrow(CheckInNotPendingError);
    expect(mockAssignDoctor).not.toHaveBeenCalled();
  });

  it('rescues a check-in whose automated M-Pesa STK push FAILED — a resilience path for any patient at any clinic, not just PENDING_PAYMENT', async () => {
    mockFindFirstCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, status: 'FAILED' });
    mockAssignDoctor.mockResolvedValue('doc-1');

    const result = await confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1');

    expect(result.status).toBe('PAID');
    expect(mockCreateEncounter).toHaveBeenCalled();
  });

  it("assigns a doctor via doctorAssignmentService using the check-in's own clinic and department, and stores it on the new Encounter", async () => {
    mockFindFirstCheckIn.mockResolvedValue(PENDING_CHECK_IN);
    mockAssignDoctor.mockResolvedValue('doc-1');

    await confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1');

    expect(mockAssignDoctor).toHaveBeenCalledWith('clinic-A', 'dept-1');
    expect(mockCreateEncounter).toHaveBeenCalledWith({
      data: { patientId: 'patient-1', clinicId: 'clinic-A', checkInId: 'ci-1', assignedDoctorId: 'doc-1' },
    });
  });

  it('leaves the Encounter unassigned when the department has no active doctors', async () => {
    mockFindFirstCheckIn.mockResolvedValue(PENDING_CHECK_IN);
    mockAssignDoctor.mockResolvedValue(null);

    await confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1');

    expect(mockCreateEncounter).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedDoctorId: null }) }),
    );
  });
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

describe('applyPaymentResult (STK push resolves unsuccessfully)', () => {
  it('marks the CheckIn FAILED and publishes a live-queue event, same as an initiation failure', async () => {
    mockFindUniqueCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, id: 'ci-3', mpesaCheckoutRequestId: 'checkout-1' });

    await applyPaymentResult(
      { merchantRequestId: 'merchant-1', checkoutRequestId: 'checkout-1', resultCode: 1032, resultDesc: 'Cancelled by user' },
      { raw: true },
    );

    expect(mockUpdateCheckIn).toHaveBeenCalledWith({ where: { id: 'ci-3' }, data: { status: 'FAILED' } });
    expect(mockPublishFailed).toHaveBeenCalledWith({ checkInId: 'ci-3', clinicId: 'clinic-A' });
  });
});
