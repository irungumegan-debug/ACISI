jest.mock('../../src/db/prisma', () => ({
  prisma: {
    encounter: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/jobs/queue', () => ({ enqueueVisitSummarySms: jest.fn() }));

import { prisma } from '../../src/db/prisma';
import { enqueueVisitSummarySms } from '../../src/jobs/queue';
import {
  completeConsultation,
  EncounterNotFoundError,
  InvalidConsultationTransitionError,
  startConsultation,
} from '../../src/services/consultationService';

const mockFindFirst = prisma.encounter.findFirst as jest.Mock;
const mockUpdate = prisma.encounter.update as jest.Mock;
const mockEnqueueSms = enqueueVisitSummarySms as jest.Mock;

const ACTOR = { staffId: 'staff-1', clinicId: 'clinic-1' };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('startConsultation', () => {
  it('throws when the encounter does not belong to this clinic', async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(startConsultation('encounter-1', ACTOR)).rejects.toBeInstanceOf(EncounterNotFoundError);
  });

  it('rejects starting a consultation that is not WAITING', async () => {
    mockFindFirst.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'DONE' });
    await expect(startConsultation('encounter-1', ACTOR)).rejects.toBeInstanceOf(InvalidConsultationTransitionError);
  });

  it('moves WAITING to IN_CONSULTATION', async () => {
    mockFindFirst.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'WAITING' });
    mockUpdate.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'IN_CONSULTATION' });

    const result = await startConsultation('encounter-1', ACTOR);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consultationStatus: 'IN_CONSULTATION' }) }),
    );
    expect(result.consultationStatus).toBe('IN_CONSULTATION');
  });
});

describe('completeConsultation', () => {
  it('rejects checking out an already-completed encounter', async () => {
    mockFindFirst.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'DONE' });
    await expect(completeConsultation('encounter-1', ACTOR, {})).rejects.toBeInstanceOf(
      InvalidConsultationTransitionError,
    );
  });

  it('saves prescription/notes, marks DONE, and enqueues the visit-summary SMS', async () => {
    mockFindFirst.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'IN_CONSULTATION' });
    mockUpdate.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'DONE' });

    await completeConsultation('encounter-1', ACTOR, { prescription: 'Amoxicillin', notes: 'Mild URTI' });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consultationStatus: 'DONE',
          prescription: 'Amoxicillin',
          notes: 'Mild URTI',
        }),
      }),
    );
    expect(mockEnqueueSms).toHaveBeenCalledWith({ encounterId: 'encounter-1' });
  });

  it('allows checking out directly from WAITING', async () => {
    mockFindFirst.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'WAITING' });
    mockUpdate.mockResolvedValue({ id: 'encounter-1', consultationStatus: 'DONE' });

    await expect(completeConsultation('encounter-1', ACTOR, {})).resolves.toBeDefined();
  });
});
