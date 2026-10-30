import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));
jest.mock('../../src/services/recordSharingService', () => {
  class RecordSharingError extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  }
  return { getSharingOverview: jest.fn(), setStandingSharing: jest.fn(), showCodeToPatient: jest.fn(), RecordSharingError };
});

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import { getSharingOverview, RecordSharingError, setStandingSharing, showCodeToPatient } from '../../src/services/recordSharingService';
import { portalSharingRouter } from '../../src/portal/sharing';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/sharing', portalSharingRouter);
  return app;
}
const asPatient = (req: request.Test) => req.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadPatientSession as jest.Mock).mockResolvedValue({ patientId: 'p-1', patientCode: 'ACI-7F2K', firstName: 'Jane' });
  (getSharingOverview as jest.Mock).mockResolvedValue({ allowSharing: false, accessToday: [], decisions: [], openRequests: [] });
});

describe('patient sharing controls (C4, C5)', () => {
  it('requires a logged-in patient', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue(null);
    expect((await asPatient(request(buildApp()).get('/sharing'))).status).toBe(401);
  });

  it('the Account switch changes only the logged-in patient\'s own choice', async () => {
    const res = await asPatient(request(buildApp()).put('/sharing').send({ allowSharing: true }));
    expect(res.status).toBe(200);
    expect(setStandingSharing).toHaveBeenCalledWith('p-1', true);
  });

  it('refuses anything but true/false', async () => {
    expect((await asPatient(request(buildApp()).put('/sharing').send({ allowSharing: 'yes' }))).status).toBe(400);
    expect(setStandingSharing).not.toHaveBeenCalled();
  });

  it('"Show my code" is for the logged-in patient\'s own request', async () => {
    (showCodeToPatient as jest.Mock).mockResolvedValue({ code: '123456', expiresAt: new Date(), clinicName: 'Baraka' });
    const res = await asPatient(request(buildApp()).post('/sharing/requests/r1/code'));
    expect(res.status).toBe(200);
    expect(showCodeToPatient).toHaveBeenCalledWith('p-1', 'r1');
  });

  it('a request that is not theirs or no longer open is a 404 with a clear message', async () => {
    (showCodeToPatient as jest.Mock).mockRejectedValue(new (RecordSharingError as unknown as new (m: string, s: number) => Error)('This request is no longer open.', 404));
    const res = await asPatient(request(buildApp()).post('/sharing/requests/r-other/code'));
    expect(res.status).toBe(404);
  });
});
