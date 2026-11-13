/**
 * The Lab technician role sees only lab work. Front-desk routes used to
 * refuse only doctors; they now allow front-desk roles only, so a lab
 * technician (and any future role) is refused everywhere else by default.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/dashboard/session', () => ({ ...jest.requireActual('../../src/dashboard/session'), loadDashboardSession: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/departmentService', () => ({
  ...jest.requireActual('../../src/services/departmentService'),
  getDoctorDepartmentIds: jest.fn(async () => []),
}));
// Any database call answers "nothing found": the role checks must refuse before any data is read.
jest.mock('../../src/db/prisma', () => {
  const model = new Proxy({}, { get: (_t, method: string) => jest.fn(async () => (method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null)) });
  return { prisma: new Proxy({}, { get: (_t, name: string) => (name === '$transaction' ? jest.fn(async () => []) : model) }) };
});

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { dashboardRouter } from '../../src/dashboard/router';

const LAB = { staffId: 'lab-1', staffCode: 'ACI-STF-LAB1', staffName: 'Lab One', role: 'LAB_TECHNICIAN', clinicId: 'clinic-1', clinicName: 'Sunrise' };

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/staff', dashboardRouter);
  return a;
}

function call(method: 'get' | 'post' | 'put' | 'patch', path: string) {
  const r = request(app())[method](`/api/staff${path}`).set('Cookie', `${SESSION_COOKIE_NAME}=t`);
  return method === 'get' ? r : r.send({});
}

beforeEach(() => (loadDashboardSession as jest.Mock).mockResolvedValue(LAB));

const FRONT_DESK_DOCTOR_AND_ADMIN_ROUTES: ['get' | 'post' | 'put' | 'patch', string][] = [
  ['get', '/checkins/today'],
  ['post', '/checkins/ci-1/confirm-payment'],
  ['post', '/checkins/ci-1/checkout'],
  ['get', '/checkins/ci-1/doctor-options'],
  ['post', '/checkins/ci-1/doctor'],
  ['get', '/walk-in/lookup'],
  ['post', '/walk-in'],
  ['get', '/billing/visits/enc-1'],
  ['put', '/billing/visits/enc-1/bill'],
  ['get', '/appointments'],
  ['get', '/phone-verification/pending-signups'],
  ['patch', '/patients/p-1/sms-preference'],
  ['patch', '/patients/p-1/details'],
  ['get', '/patients/p-1/visits/enc-1/record'],
  ['post', '/patients/p-1/record-requests'],
  ['get', '/doctor/queue'],
  ['get', '/doctor/lab-tests'],
  ['post', '/doctor/encounters/enc-1/lab-orders'],
  ['post', '/doctor/encounters/enc-1/consult'],
  ['get', '/clinic/staff'],
  ['get', '/lab-tests'],
  ['post', '/lab-tests'],
];

describe('a lab technician', () => {
  it.each(FRONT_DESK_DOCTOR_AND_ADMIN_ROUTES)('is refused on %s %s', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(403);
  });

  it('finds no patients through patient search or the patient page', async () => {
    expect((await call('get', '/patients?q=Jane')).body).toEqual({ patients: [] });
    expect((await call('get', '/patients/p-1')).status).toBe(404);
    expect((await call('get', '/files/patient/p-1')).status).toBe(404);
  });

  it('can open the lab queue', async () => {
    const res = await call('get', '/lab/queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queue: [] });
  });
});

describe('other roles on the lab queue', () => {
  it.each(['RECEPTIONIST', 'CLINICIAN', 'ADMIN', 'DOCTOR'])('%s is refused', async (role) => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...LAB, role });
    expect((await call('get', '/lab/queue')).status).toBe(403);
    expect((await call('post', '/lab/orders/o-1/complete')).status).toBe(403);
  });

  it('a doctor can no longer check a patient out (front desk only)', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...LAB, role: 'DOCTOR' });
    expect((await call('post', '/checkins/ci-1/checkout')).status).toBe(403);
  });
});
