import express from 'express';

jest.mock('../../src/services/patientService', () => ({ findPatientByPhone: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({
  prisma: { encounter: { findMany: jest.fn() } },
}));
jest.mock('../../src/portal/auth', () => ({
  requirePatientSession: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { patientSession: unknown }).patientSession = { phoneNumberE164: '+254712345678' };
    next();
  },
}));

import request from 'supertest';
import { findPatientByPhone } from '../../src/services/patientService';
import { recordAuditEvent } from '../../src/services/auditService';
import { prisma } from '../../src/db/prisma';
import { portalVisitsRouter } from '../../src/portal/visits';

const mockFindPatient = findPatientByPhone as jest.Mock;
const mockFindEncounters = prisma.encounter.findMany as jest.Mock;
const mockAudit = recordAuditEvent as jest.Mock;

function buildApp() {
  const app = express();
  app.use('/visits', portalVisitsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /visits', () => {
  it('returns an empty list for a phone number with no patient record', async () => {
    mockFindPatient.mockResolvedValue(null);
    const res = await request(buildApp()).get('/visits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visits: [] });
    expect(mockFindEncounters).not.toHaveBeenCalled();
  });

  it('returns the patient\'s own visits and logs the access', async () => {
    mockFindPatient.mockResolvedValue({ id: 'patient-1' });
    mockFindEncounters.mockResolvedValue([
      {
        id: 'encounter-1',
        createdAt: new Date('2026-01-01'),
        consultationStatus: 'DONE',
        notes: 'Mild URTI',
        prescription: 'Amoxicillin',
        clinic: { name: 'Sunrise Family Clinic' },
        checkIn: { department: { name: 'General' } },
      },
    ]);

    const res = await request(buildApp()).get('/visits');

    expect(res.status).toBe(200);
    expect(res.body.visits).toEqual([
      {
        encounterId: 'encounter-1',
        clinicName: 'Sunrise Family Clinic',
        departmentName: 'General',
        visitedAt: '2026-01-01T00:00:00.000Z',
        status: 'DONE',
        notes: 'Mild URTI',
        prescription: 'Amoxicillin',
      },
    ]);
    expect(mockFindEncounters).toHaveBeenCalledWith(expect.objectContaining({ where: { patientId: 'patient-1' } }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'PATIENT_SELF_VIEWED_HISTORY' }));
  });
});
