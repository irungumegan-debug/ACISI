jest.mock('../../src/db/prisma', () => ({
  prisma: {
    staff: { findMany: jest.fn() },
    encounter: { findMany: jest.fn() },
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { prisma } from '../../src/db/prisma';
import { logger } from '../../src/utils/logger';
import { assignDoctorForCheckIn } from '../../src/services/doctorAssignmentService';

const mockFindManyStaff = prisma.staff.findMany as jest.Mock;
const mockFindManyEncounters = prisma.encounter.findMany as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('assignDoctorForCheckIn', () => {
  it('returns null and logs a warning when the department has no active doctors', async () => {
    mockFindManyStaff.mockResolvedValue([]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBeNull();
    expect(mockFindManyEncounters).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-A', departmentId: 'dept-1' }),
      expect.stringContaining('No active doctors'),
    );
  });

  it('assigns the sole doctor when the department has exactly one, without querying encounters', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
    expect(mockFindManyEncounters).not.toHaveBeenCalled();
  });

  it('only considers active DOCTOR staff in the given clinic and department', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }]);

    await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(mockFindManyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 'clinic-A', departmentId: 'dept-1', role: 'DOCTOR', isActive: true } }),
    );
  });

  it('picks a free doctor (no one IN_CONSULTATION) over one with an empty waiting queue but currently busy', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockFindManyEncounters.mockResolvedValue([{ assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' }]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-2');
  });

  it('picks the first free doctor by staffCode order when more than one is free', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }, { id: 'doc-3' }]);
    mockFindManyEncounters.mockResolvedValue([]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
    expect(mockFindManyStaff).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { staffCode: 'asc' } }));
  });

  it('when every doctor is busy, assigns to whoever has the fewest patients WAITING', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }, { id: 'doc-3' }]);
    mockFindManyEncounters.mockResolvedValue([
      { assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-1', status: 'WAITING' },
      { assignedDoctorId: 'doc-1', status: 'WAITING' },
      { assignedDoctorId: 'doc-2', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-2', status: 'WAITING' },
      { assignedDoctorId: 'doc-3', status: 'IN_CONSULTATION' },
    ]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-3');
  });

  it('breaks a tie in WAITING count by staffCode order when all doctors are busy', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockFindManyEncounters.mockResolvedValue([
      { assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-2', status: 'IN_CONSULTATION' },
    ]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
  });

  it('queries only the candidate doctors\' active encounters, scoped to WAITING/IN_CONSULTATION', async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockFindManyEncounters.mockResolvedValue([]);

    await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(mockFindManyEncounters).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedDoctorId: { in: ['doc-1', 'doc-2'] }, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
      }),
    );
  });
});
