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

const TODAY = new Date();
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

/** A doctor who logged in today — i.e. present, per staffService.getDoctorPresenceStatus. */
function inToday(id: string) {
  return { id, lastLoginAt: TODAY, presenceOverride: null, presenceOverrideAt: null };
}

/** A doctor who hasn't logged in today and has no override — i.e. absent. */
function notInToday(id: string) {
  return { id, lastLoginAt: null, presenceOverride: null, presenceOverrideAt: null };
}

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

  it('assigns the sole doctor when the department has exactly one and they are in today, without querying encounters', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1')]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
    expect(mockFindManyEncounters).not.toHaveBeenCalled();
  });

  it('only considers active DOCTOR staff in the given clinic and department', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1')]);

    await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(mockFindManyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: 'clinic-A', departmentId: 'dept-1', role: 'DOCTOR', isActive: true } }),
    );
  });

  it('picks a free doctor (no one IN_CONSULTATION) over one with an empty waiting queue but currently busy', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2')]);
    mockFindManyEncounters.mockResolvedValue([{ assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' }]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-2');
  });

  it('picks the first free doctor by staffCode order when more than one is free', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2'), inToday('doc-3')]);
    mockFindManyEncounters.mockResolvedValue([]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
    expect(mockFindManyStaff).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { staffCode: 'asc' } }));
  });

  it('when every doctor is busy, assigns to whoever has the fewest patients WAITING', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2'), inToday('doc-3')]);
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
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2')]);
    mockFindManyEncounters.mockResolvedValue([
      { assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-2', status: 'IN_CONSULTATION' },
    ]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
  });

  it('queries only the candidate doctors\' active encounters, scoped to WAITING/IN_CONSULTATION', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2')]);
    mockFindManyEncounters.mockResolvedValue([]);

    await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(mockFindManyEncounters).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedDoctorId: { in: ['doc-1', 'doc-2'] }, status: { in: ['WAITING', 'IN_CONSULTATION'] } },
      }),
    );
  });

  it('returns null and logs a distinct warning when the department has doctors but none are in today', async () => {
    mockFindManyStaff.mockResolvedValue([notInToday('doc-1'), notInToday('doc-2')]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBeNull();
    expect(mockFindManyEncounters).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-A', departmentId: 'dept-1' }),
      expect.stringContaining('none are marked in today'),
    );
  });

  it('never assigns to a doctor who is not in today, even if they would otherwise be the free/least-busy pick', async () => {
    mockFindManyStaff.mockResolvedValue([inToday('doc-1'), inToday('doc-2'), notInToday('doc-3')]);
    // doc-3 (excluded entirely for being absent) has no active encounters and would
    // otherwise look like the obvious free pick; doc-1 and doc-2 are both busy.
    mockFindManyEncounters.mockResolvedValue([
      { assignedDoctorId: 'doc-1', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-2', status: 'IN_CONSULTATION' },
      { assignedDoctorId: 'doc-2', status: 'WAITING' },
    ]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
    expect(mockFindManyEncounters).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assignedDoctorId: { in: ['doc-1', 'doc-2'] } }) }),
    );
  });

  it('a doctor explicitly marked out today is excluded even if they logged in today', async () => {
    mockFindManyStaff.mockResolvedValue([
      inToday('doc-1'),
      { id: 'doc-2', lastLoginAt: TODAY, presenceOverride: 'OUT', presenceOverrideAt: TODAY },
    ]);
    mockFindManyEncounters.mockResolvedValue([]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBe('doc-1');
  });

  it("ignores a stale login/override from a previous day", async () => {
    mockFindManyStaff.mockResolvedValue([{ id: 'doc-1', lastLoginAt: YESTERDAY, presenceOverride: null, presenceOverrideAt: null }]);

    const result = await assignDoctorForCheckIn('clinic-A', 'dept-1');

    expect(result).toBeNull();
  });
});
