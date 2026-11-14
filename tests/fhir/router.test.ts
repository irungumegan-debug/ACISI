import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({ ...jest.requireActual('../../src/dashboard/session'), loadDashboardSession: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/departmentService', () => ({ getDoctorDepartmentIds: jest.fn(async () => ['dept-1']) }));
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    patient: { findFirst: jest.fn() },
    encounter: { findMany: jest.fn(async () => []) },
    clinic: { findUnique: jest.fn(async () => ({ id: 'c-1', name: 'Sunrise', county: null })) },
    patientAllergy: { findMany: jest.fn(async () => []) },
  },
}));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { prisma } from '../../src/db/prisma';
import { recordAuditEvent } from '../../src/services/auditService';
import { fhirRouter } from '../../src/fhir/router';

const PATIENT = { id: 'p-1', patientCode: 'ACI-1', firstName: 'Jane', lastName: 'W', sex: 'FEMALE', dateOfBirth: null, phoneNumber: '+254700000001', email: null, idType: null, idNumber: null, nextOfKinName: null, nextOfKinPhone: null, deletedAt: null };
const session = (role: string) => ({ staffId: 's-1', staffCode: 'X', staffName: 'S', role, clinicId: 'c-1', clinicName: 'Sunrise', departmentId: null });

function app() {
  const a = express();
  a.use(cookieParser());
  a.use('/fhir/r4', fhirRouter);
  return a;
}
const get = (path: string) => request(app()).get(`/fhir/r4${path}`).set('Cookie', `${SESSION_COOKIE_NAME}=t`);

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue(PATIENT);
});

it('serves the CapabilityStatement without a login, as FHIR JSON', async () => {
  const res = await request(app()).get('/fhir/r4/metadata');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('application/fhir+json');
  expect(res.body).toMatchObject({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' });
});

it('answers a missing login with a FHIR OperationOutcome', async () => {
  const res = await request(app()).get('/fhir/r4/Patient/p-1');
  expect(res.status).toBe(401);
  expect(res.body).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ code: 'login' }] });
});

it('front desk can read patient details, audit-logged', async () => {
  (loadDashboardSession as jest.Mock).mockResolvedValue(session('RECEPTIONIST'));
  const res = await get('/Patient/p-1');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ resourceType: 'Patient', id: 'p-1' });
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'FHIR_PATIENT_EXPORTED', entityId: 'p-1', metadata: { operation: 'read', resourceCount: 1 } }));
});

it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN', 'LAB_TECHNICIAN'])('%s cannot export the full record (diagnoses, lab results)', async (role) => {
  (loadDashboardSession as jest.Mock).mockResolvedValue(session(role));
  const res = await get('/Patient/p-1/$everything');
  expect(res.status).toBe(403);
  expect(res.body.resourceType).toBe('OperationOutcome');
  expect(prisma.encounter.findMany).not.toHaveBeenCalled();
});

it("a doctor gets the full record, for patients in their own queue and this clinic's visits only", async () => {
  (loadDashboardSession as jest.Mock).mockResolvedValue(session('DOCTOR'));
  const res = await get('/Patient/p-1/$everything');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ resourceType: 'Bundle', type: 'searchset' });
  const where = JSON.stringify((prisma.patient.findFirst as jest.Mock).mock.lastCall[0].where);
  expect(where).toContain('IN_CONSULTATION');
  expect((prisma.encounter.findMany as jest.Mock).mock.lastCall[0].where).toEqual({ patientId: 'p-1', clinicId: 'c-1' });
});

it('a patient outside the scope is "not found", as an OperationOutcome', async () => {
  (loadDashboardSession as jest.Mock).mockResolvedValue(session('DOCTOR'));
  (prisma.patient.findFirst as jest.Mock).mockResolvedValue(null);
  const res = await get('/Patient/p-9/$everything');
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ resourceType: 'OperationOutcome', issue: [{ code: 'not-found' }] });
});
