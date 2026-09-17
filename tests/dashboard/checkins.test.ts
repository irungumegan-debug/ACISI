import express from 'express';
import request from 'supertest';

jest.mock('../../src/services/consultationService', () => ({
  listTodayQueue: jest.fn(),
  startConsultation: jest.fn(),
  completeConsultation: jest.fn(),
  EncounterNotFoundError: class EncounterNotFoundError extends Error {},
  InvalidConsultationTransitionError: class InvalidConsultationTransitionError extends Error {},
}));

jest.mock('../../src/dashboard/auth', () => ({
  requireStaffSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { dashboardSession: unknown }).dashboardSession = {
      staffId: 'staff-1',
      staffName: 'Test Receptionist',
      clinicId: 'clinic-1',
      clinicName: 'Sunrise Family Clinic',
    };
    next();
  },
}));

import {
  EncounterNotFoundError,
  InvalidConsultationTransitionError,
  completeConsultation,
  listTodayQueue,
  startConsultation,
} from '../../src/services/consultationService';
import { checkinsRouter } from '../../src/dashboard/checkins';

const mockListQueue = listTodayQueue as jest.Mock;
const mockStart = startConsultation as jest.Mock;
const mockComplete = completeConsultation as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/checkins', checkinsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /checkins/today', () => {
  it('returns the queue scoped to the session clinic', async () => {
    mockListQueue.mockResolvedValue([{ encounterId: 'e1' }]);
    const res = await request(buildApp()).get('/checkins/today');
    expect(res.status).toBe(200);
    expect(mockListQueue).toHaveBeenCalledWith('clinic-1', undefined);
    expect(res.body.queue).toEqual([{ encounterId: 'e1' }]);
  });

  it('passes the department filter through', async () => {
    mockListQueue.mockResolvedValue([]);
    await request(buildApp()).get('/checkins/today?department=dept-1');
    expect(mockListQueue).toHaveBeenCalledWith('clinic-1', 'dept-1');
  });
});

describe('POST /checkins/:encounterId/start', () => {
  it('starts a consultation', async () => {
    mockStart.mockResolvedValue({ id: 'e1', consultationStatus: 'IN_CONSULTATION' });
    const res = await request(buildApp()).post('/checkins/e1/start');
    expect(res.status).toBe(200);
    expect(mockStart).toHaveBeenCalledWith('e1', { staffId: 'staff-1', clinicId: 'clinic-1' });
  });

  it('404s when the encounter is not found for this clinic', async () => {
    mockStart.mockRejectedValue(new EncounterNotFoundError('e1'));
    const res = await request(buildApp()).post('/checkins/e1/start');
    expect(res.status).toBe(404);
  });

  it('409s on an invalid transition', async () => {
    mockStart.mockRejectedValue(new InvalidConsultationTransitionError('bad transition'));
    const res = await request(buildApp()).post('/checkins/e1/start');
    expect(res.status).toBe(409);
  });
});

describe('POST /checkins/:encounterId/checkout', () => {
  it('completes a consultation with notes/prescription', async () => {
    mockComplete.mockResolvedValue({ id: 'e1', consultationStatus: 'DONE' });
    const res = await request(buildApp())
      .post('/checkins/e1/checkout')
      .send({ notes: 'Mild URTI', prescription: 'Amoxicillin' });

    expect(res.status).toBe(200);
    expect(mockComplete).toHaveBeenCalledWith(
      'e1',
      { staffId: 'staff-1', clinicId: 'clinic-1' },
      { notes: 'Mild URTI', prescription: 'Amoxicillin' },
    );
  });

  it('rejects an overly long prescription without calling the service', async () => {
    const res = await request(buildApp())
      .post('/checkins/e1/checkout')
      .send({ prescription: 'x'.repeat(3000) });

    expect(res.status).toBe(400);
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
