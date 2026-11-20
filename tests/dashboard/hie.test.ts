/** National HIE endpoints in the console: who may do what, and "not connected yet". */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({ ...jest.requireActual('../../src/dashboard/session'), loadDashboardSession: jest.fn() }));
jest.mock('../../src/services/idleTimeout', () => ({ markSessionActive: jest.fn() }));
jest.mock('../../src/hie/client', () => ({ ...jest.requireActual('../../src/hie/client'), hieConfigured: jest.fn(() => true) }));
jest.mock('../../src/hie/registryService', () => ({
  ...jest.requireActual('../../src/hie/registryService'),
  findFacilities: jest.fn(async () => [{ frCode: 'FID-1', officialName: 'Sunrise' }]),
  setClinicFacility: jest.fn(async () => ({ frCode: 'FID-1', officialName: 'Sunrise' })),
  verifyOwnPractitionerRecord: jest.fn(async () => ({ practitionerId: 'PUID-1' })),
  lookUpPatientInClientRegistry: jest.fn(async () => ({ result: 'saved', crId: 'CR1-1' })),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { clinic: { findUnique: jest.fn(async () => null) }, staff: { findUnique: jest.fn(async () => null) } } }));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { HieError } from '../../src/hie/client';
import { lookUpPatientInClientRegistry, setClinicFacility, verifyOwnPractitionerRecord } from '../../src/hie/registryService';
import { hieRouter } from '../../src/dashboard/hie';

const base = { staffId: 's1', staffCode: 'ACI-STF-1', staffName: 'X', clinicId: 'c1', clinicName: 'Sunrise', departmentId: null };
const as = (role: string) => (loadDashboardSession as jest.Mock).mockResolvedValue({ ...base, role });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/hie', hieRouter);
  return a;
}
const call = (method: 'get' | 'put' | 'post', path: string, body?: object) => request(app())[method](path).set('Cookie', `${SESSION_COOKIE_NAME}=tok`).send(body);

beforeEach(() => jest.clearAllMocks());

it('only clinic admins search for and set the facility', async () => {
  as('RECEPTIONIST');
  expect((await call('get', '/hie/facilities?name=Sunrise')).status).toBe(403);
  expect((await call('put', '/hie/facility', { frCode: 'FID-1' })).status).toBe(403);
  as('ADMIN');
  expect((await call('get', '/hie/facilities?name=Sunrise')).body.facilities).toHaveLength(1);
  expect((await call('put', '/hie/facility', { frCode: 'FID-1' })).status).toBe(200);
  expect(setClinicFacility).toHaveBeenCalledWith({ clinicId: 'c1', staffId: 's1', frCode: 'FID-1' });
});

it('only doctors and clinical officers verify their own registration', async () => {
  as('RECEPTIONIST');
  expect((await call('put', '/hie/me/practitioner', { regulator: 'KMPDC', registrationNumber: 'A123' })).status).toBe(403);
  as('DOCTOR');
  expect((await call('put', '/hie/me/practitioner', { regulator: 'XYZ', registrationNumber: 'A123' })).status).toBe(400);
  expect((await call('put', '/hie/me/practitioner', { regulator: 'KMPDC', registrationNumber: 'A123' })).status).toBe(200);
  expect(verifyOwnPractitionerRecord).toHaveBeenCalledWith({ staffId: 's1', clinicId: 'c1', regulator: 'KMPDC', registrationNumber: 'A123' });
});

it('only front desk looks patients up in the Client Registry', async () => {
  as('DOCTOR');
  expect((await call('post', '/hie/patients/p1/client-registry')).status).toBe(403);
  as('RECEPTIONIST');
  expect((await call('post', '/hie/patients/p1/client-registry')).body).toEqual({ result: 'saved', crId: 'CR1-1' });
});

it('says "not connected yet" (503) while the HIE is switched off', async () => {
  as('RECEPTIONIST');
  (lookUpPatientInClientRegistry as jest.Mock).mockRejectedValueOnce(new HieError('not_configured', "ACISI isn't connected to the national Health Information Exchange yet."));
  const res = await call('post', '/hie/patients/p1/client-registry');
  expect(res.status).toBe(503);
  expect(res.body.error).toMatch(/isn't connected/);
});

it('status shows connection, facility and the doctor’s own record', async () => {
  as('DOCTOR');
  const res = await call('get', '/hie/status');
  expect(res.body).toEqual({ connected: true, facility: null, practitioner: null });
});
