/**
 * Staff and doctors don't reset their own PIN by SMS (owner, 23 Nov 2026):
 * their clinic admin does (Settings → Staff → Reset PIN, tested in
 * clinicSettings tests). The old endpoints only point people there.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(), sendPatientSms: jest.fn() }));
jest.mock('../../src/services/staffService', () => ({
  ...jest.requireActual('../../src/services/staffService'),
  findActiveStaffWithClinicByCode: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { sendSms } from '../../src/services/smsService';
import { findActiveStaffWithClinicByCode } from '../../src/services/staffService';
import { authRouter, STAFF_PIN_RESET_BY_ADMIN_MESSAGE } from '../../src/dashboard/auth';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', authRouter);
  return app;
}

beforeEach(() => jest.clearAllMocks());

it('"Forgot PIN" for staff sends no SMS and says to ask the clinic admin', async () => {
  const res = await request(buildApp()).post('/auth/forgot-pin').send({ staffCode: 'ACI-STF-TEST' });
  expect(res.status).toBe(200);
  expect(res.body.message).toBe(STAFF_PIN_RESET_BY_ADMIN_MESSAGE);
  expect(res.body.message).toMatch(/clinic admin.*Settings → Staff.*Reset PIN/);
  expect(sendSms).not.toHaveBeenCalled();
  expect(findActiveStaffWithClinicByCode).not.toHaveBeenCalled();
});

it('a staff PIN can no longer be changed with a code', async () => {
  const res = await request(buildApp()).post('/auth/reset-pin').send({ staffCode: 'ACI-STF-TEST', code: '123456', newPin: '730194' });
  expect(res.status).toBe(410);
  expect(res.body.error).toBe(STAFF_PIN_RESET_BY_ADMIN_MESSAGE);
});
