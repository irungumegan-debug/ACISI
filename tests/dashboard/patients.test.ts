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
  prisma: { patient: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, encounter: { findFirst: jest.fn() } },
}));
jest.mock('../../src/services/departmentService', () => ({ getDoctorDepartmentIds: jest.fn(async () => ['dept-1']) }));
jest.mock('../../src/services/visitRecordDocument', () => ({
  buildVisitRecordDataFromEncounter: jest.fn(() => ({})),
  renderVisitRecordPdf: jest.fn(async () => Buffer.from('%PDF-1.4 test')),
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
    expect(mockGetScopedHistory).toHaveBeenCalledWith('patient-1', 'clinic-A', { includeDiagnosis: false });
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


const DOCTOR = { ...SESSION, staffId: 'doc-1', role: 'DOCTOR', departmentId: 'dept-1' };
const QUEUE_FILTER = {
  clinicId: 'clinic-A',
  status: { in: ['WAITING', 'IN_CONSULTATION'] },
  checkIn: { departmentId: { in: ['dept-1'] } },
  OR: [{ assignedDoctorId: 'doc-1' }, { assignedDoctorId: null }],
};

describe('doctors are limited to their own queue by the SERVER (C1)', () => {
  it('search only returns patients currently in the doctor\'s department queue', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR);
    (prisma.patient.findMany as jest.Mock).mockResolvedValue([]);
    await withCookie(request(buildApp()).get('/patients?q=Jane'));
    const where = (prisma.patient.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ encounters: { some: QUEUE_FILTER } });
  });

  it('a patient outside the doctor\'s queue gets exactly the same 404 as one who does not exist', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR);
    mockFindFirstPatient.mockResolvedValue(null);
    const outside = await withCookie(request(buildApp()).get('/patients/patient-other-dept'));
    const missing = await withCookie(request(buildApp()).get('/patients/does-not-exist'));
    expect(outside.status).toBe(404);
    expect(outside.body).toEqual(missing.body);
    expect(mockFindFirstPatient.mock.calls[0][0].where).toEqual({ id: 'patient-other-dept', encounters: { some: QUEUE_FILTER } });
    expect(mockGetScopedHistory).not.toHaveBeenCalled();
  });

  it('a doctor viewing a patient in their queue gets diagnoses', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR);
    mockFindFirstPatient.mockResolvedValue({ id: 'patient-1', firstName: 'J', lastName: 'W', phoneNumber: '+254712345678', sex: 'FEMALE' });
    mockGetScopedHistory.mockResolvedValue({ history: [], hasHiddenHistoryElsewhere: false });
    await withCookie(request(buildApp()).get('/patients/patient-1'));
    expect(mockGetScopedHistory).toHaveBeenCalledWith('patient-1', 'clinic-A', { includeDiagnosis: true });
  });
});

describe('front desk never receives diagnoses (C2)', () => {
  it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN'])('%s gets history without diagnoses', async (role) => {
    mockLoadSession.mockResolvedValue({ ...SESSION, role });
    mockFindFirstPatient.mockResolvedValue({ id: 'patient-1', firstName: 'J', lastName: 'W', phoneNumber: '+254712345678', sex: 'FEMALE' });
    mockGetScopedHistory.mockResolvedValue({ history: [], hasHiddenHistoryElsewhere: false });
    await withCookie(request(buildApp()).get('/patients/patient-1'));
    expect(mockGetScopedHistory).toHaveBeenCalledWith('patient-1', 'clinic-A', { includeDiagnosis: false });
  });
});

describe('GET /patients/:id/visits/:encounterId/record (print visit record)', () => {
  const ENCOUNTER = { id: 'enc-1', patientId: 'patient-1', createdAt: new Date('2026-10-01') };

  it('gives front desk the PDF the patient asked for, and audit-logs the print with IDs only', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(ENCOUNTER);
    const res = await withCookie(request(buildApp()).get('/patients/patient-1/visits/enc-1/record'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((prisma.encounter.findFirst as jest.Mock).mock.calls[0][0].where).toMatchObject({ id: 'enc-1', patientId: 'patient-1', clinicId: 'clinic-A' });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VISIT_RECORD_PRINTED_FOR_PATIENT', entityId: 'enc-1', clinicId: 'clinic-A', metadata: { patientId: 'patient-1' } }),
    );
  });

  it('404s for a visit at another clinic', async () => {
    (prisma.encounter.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await withCookie(request(buildApp()).get('/patients/patient-1/visits/enc-elsewhere/record'));
    expect(res.status).toBe(404);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('is front-desk only', async () => {
    mockLoadSession.mockResolvedValue(DOCTOR);
    const res = await withCookie(request(buildApp()).get('/patients/patient-1/visits/enc-1/record'));
    expect(res.status).toBe(403);
  });
});
