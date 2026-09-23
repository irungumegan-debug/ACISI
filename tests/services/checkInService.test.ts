jest.mock('../../src/db/prisma', () => ({
  prisma: {
    checkIn: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    encounter: { create: jest.fn() },
  },
}));

jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/realtimeEvents', () => ({ publishCheckInPaid: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({
  enqueueSmsReceipt: jest.fn(),
  scheduleStkStatusCheck: jest.fn(),
}));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';
import { CheckInNotPendingError, confirmCheckInPaidManually } from '../../src/services/checkInService';

const mockFindFirstCheckIn = prisma.checkIn.findFirst as jest.Mock;
const mockUpdateCheckIn = prisma.checkIn.update as jest.Mock;
const mockCreateEncounter = prisma.encounter.create as jest.Mock;
const mockAssignDoctor = assignDoctorForCheckIn as jest.Mock;

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

describe('confirmCheckInPaidManually (Encounter creation carries the automatic doctor assignment)', () => {
  it('rejects a check-in already past PENDING_PAYMENT', async () => {
    mockFindFirstCheckIn.mockResolvedValue({ ...PENDING_CHECK_IN, status: 'PAID' });

    await expect(confirmCheckInPaidManually('ci-1', 'clinic-A', 'staff-1')).rejects.toThrow(CheckInNotPendingError);
    expect(mockAssignDoctor).not.toHaveBeenCalled();
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
