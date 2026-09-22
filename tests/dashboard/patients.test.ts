import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));

jest.mock('../../src/services/patientService', () => ({ getScopedHistory: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));

jest.mock('../../src/db/prisma', () => ({
  prisma: { patient: { findMany: jest.fn(), findFirst: jest.fn() } },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { getScopedHistory } from '../../src/services/patientService';
import { prisma } from '../../src/db/prisma';
import { patientsRouter } from '../../src/dashboard/patients';

const mockLoadSession = loadDashboardSession as jest.Mock;
const mockGetScopedHistory = getScopedHistory as jest.Mock;
const mockFindFirstPatient = prisma.patient.findFirst as jest.Mock;

const SESSION = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  clinicName: 'Sunrise Family Clinic',
  departmentId: null,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/patients', patientsRouter);
  return app;
}

function withCookie(req: request.Test) {
  return req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSession.mockResolvedValue(SESSION);
});

describe('GET /patients/:id', () => {
  it('returns 404 for a patient with no relationship to this clinic', async () => {
    mockFindFirstPatient.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).get('/patients/patient-999'));
    expect(res.status).toBe(404);
    expect(mockGetScopedHistory).not.toHaveBeenCalled();
  });

  it('scopes history through getScopedHistory (own-clinic always visible, cross-clinic consent-gated)', async () => {
    mockFindFirstPatient.mockResolvedValue({
      id: 'patient-1',
      firstName: 'Jane',
      lastName: 'Wanjiru',
      phoneNumber: '+254712345678',
      dateOfBirth: null,
      sex: 'FEMALE',
    });
    mockGetScopedHistory.mockResolvedValue({ history: [], hasHiddenHistoryElsewhere: true });

    const res = await withCookie(request(buildApp()).get('/patients/patient-1'));

    expect(res.status).toBe(200);
    expect(mockGetScopedHistory).toHaveBeenCalledWith('patient-1', 'clinic-A');
    expect(res.body.hasHiddenHistoryElsewhere).toBe(true);
  });
});
