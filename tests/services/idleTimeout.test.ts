jest.unmock('../../src/services/idleTimeout');
/** Automatic logoff after 15 minutes without activity (staff and patients). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/sessionRevocation', () => ({ isSessionRevoked: jest.fn(async () => false) }));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { resetFakeRedis } from '../helpers/fakeRedis';
import { IDLE_LOGOFF_SECONDS } from '../../src/config/constants';
import { createDashboardSession, loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { createPatientSession, loadPatientSession } from '../../src/portal/session';
import { requireStaffSession } from '../../src/dashboard/auth';

const STAFF = { staffId: 's-1', staffCode: 'ACI-STF-1', staffName: 'A', role: 'RECEPTIONIST', clinicId: 'c-1', clinicName: 'C', departmentId: null };
const t0 = new Date('2026-11-14T08:00:00Z').getTime();

beforeEach(() => {
  resetFakeRedis();
  jest.useFakeTimers({ now: t0, doNotFake: ['nextTick', 'setImmediate'] });
});
afterEach(() => jest.useRealTimers());

it('is 15 minutes', () => expect(IDLE_LOGOFF_SECONDS).toBe(15 * 60));

it('a staff session is logged off after 15 quiet minutes, even though the 8-hour limit is far away', async () => {
  const token = await createDashboardSession(STAFF);
  jest.setSystemTime(t0 + 14 * 60 * 1000);
  expect(await loadDashboardSession(token)).not.toBeNull();
  jest.setSystemTime(t0 + 15 * 60 * 1000 + 1000);
  expect(await loadDashboardSession(token)).toBeNull();
  // And it stays gone.
  jest.setSystemTime(t0);
  expect(await loadDashboardSession(token)).toBeNull();
});

it('a patient session is logged off the same way', async () => {
  const token = await createPatientSession({ patientId: 'p-1', patientCode: 'ACI-1', firstName: 'J' });
  jest.setSystemTime(t0 + 16 * 60 * 1000);
  expect(await loadPatientSession(token)).toBeNull();
});

it('a change made by the person (or the activity ping) keeps the session; background reads do not', async () => {
  const token = await createDashboardSession(STAFF);
  const app = express();
  app.use(cookieParser());
  app.all('/x', requireStaffSession, (_req, res) => res.status(204).send());
  const call = (method: 'get' | 'post') => request(app)[method]('/x').set('Cookie', `${SESSION_COOKIE_NAME}=${token}`);

  jest.setSystemTime(t0 + 10 * 60 * 1000);
  expect((await call('get')).status).toBe(204); // a background read
  jest.setSystemTime(t0 + 16 * 60 * 1000);
  expect((await call('get')).status).toBe(401); // the read didn't count as activity

  const token2 = await createDashboardSession(STAFF);
  const call2 = (method: 'get' | 'post') => request(app)[method]('/x').set('Cookie', `${SESSION_COOKIE_NAME}=${token2}`);
  jest.setSystemTime(t0 + 26 * 60 * 1000);
  expect((await call2('post')).status).toBe(204); // activity at minute 26 (10 minutes after login)
  jest.setSystemTime(t0 + 40 * 60 * 1000);
  expect((await call2('get')).status).toBe(204); // 14 minutes after the activity: still in
});
