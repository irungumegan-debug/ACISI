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
  prisma: { patient: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() } },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { getScopedHistory } from '../../src/services/patientService';
import { recordAuditEvent } from '../../src/services/auditService';
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

describe('PATCH /patients/:id/details (ID document and next of kin)', () => {
  const mockUpdate = prisma.patient.update as jest.Mock;
  const STORED = { idType: 'NATIONAL_ID', idNumber: '12345678', nextOfKinName: 'Peter Otieno', nextOfKinPhone: '+254722000111' };

  it('saves normalised details for a patient this clinic has seen, and audits which fields changed (not values)', async () => {
    mockFindFirstPatient.mockResolvedValue({ id: 'patient-1' });
    mockUpdate.mockResolvedValue({ id: 'patient-1', ...STORED });
    const res = await withCookie(
      request(buildApp())
        .patch('/patients/patient-1/details')
        .send({ idType: 'NATIONAL_ID', idNumber: '1234 5678', nextOfKinName: 'Peter Otieno', nextOfKinPhone: '0722000111' }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(STORED);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'patient-1' }, data: STORED });
    const audit = (recordAuditEvent as jest.Mock).mock.calls[0][0];
    expect(audit).toMatchObject({ action: 'PATIENT_DETAILS_UPDATED', entityId: 'patient-1' });
    expect(JSON.stringify(audit)).not.toContain('12345678');
  });

  it('clears fields sent empty', async () => {
    mockFindFirstPatient.mockResolvedValue({ id: 'patient-1' });
    mockUpdate.mockResolvedValue({ id: 'patient-1', idType: null, idNumber: null, nextOfKinName: null, nextOfKinPhone: null });
    await withCookie(request(buildApp()).patch('/patients/patient-1/details').send({ idType: '', idNumber: '', nextOfKinName: '', nextOfKinPhone: '' }));
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'patient-1' },
      data: { idType: null, idNumber: null, nextOfKinName: null, nextOfKinPhone: null },
    });
  });

  it('refuses invalid details with a clear message', async () => {
    const res = await withCookie(request(buildApp()).patch('/patients/patient-1/details').send({ idType: 'NATIONAL_ID', idNumber: '12' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A national ID number is 6 to 9 digits');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s for a patient this clinic hasn't seen", async () => {
    mockFindFirstPatient.mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).patch('/patients/patient-9/details').send({ nextOfKinName: 'Peter Otieno' }));
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses doctors', async () => {
    mockLoadSession.mockResolvedValue({ ...SESSION, role: 'DOCTOR' });
    const res = await withCookie(request(buildApp()).patch('/patients/patient-1/details').send({ nextOfKinName: 'Peter Otieno' }));
    expect(res.status).toBe(403);
  });
});
