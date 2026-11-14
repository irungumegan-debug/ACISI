/** Multi-factor login for clinic admins and doctors: SMS code after the PIN, remembered devices. */
process.env.STAFF_MFA_ENABLED = 'true';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ isSessionRevoked: jest.fn(async () => false), revokeSessionsFor: jest.fn() }));
jest.mock('../../src/services/staffService', () => ({
  ...jest.requireActual('../../src/services/staffService'),
  findActiveStaffWithClinicByCode: jest.fn(),
  verifyStaffPin: jest.fn(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { resetFakeRedis } from '../helpers/fakeRedis';
import { sendSms } from '../../src/services/smsService';
import { isSessionRevoked } from '../../src/services/sessionRevocation';
import { findActiveStaffWithClinicByCode, verifyStaffPin } from '../../src/services/staffService';
import { authRouter } from '../../src/dashboard/auth';
import { SESSION_COOKIE_NAME } from '../../src/dashboard/session';

const DOCTOR = { id: 'doc-1', staffCode: 'ACI-STF-DOC1', name: 'Dr A', role: 'DOCTOR', phoneNumber: '+254712345678', clinicId: 'c-1', departmentId: 'd-1', clinic: { name: 'Sunrise' } };
const RECEPTIONIST = { ...DOCTOR, id: 'rec-1', staffCode: 'ACI-STF-REC1', role: 'RECEPTIONIST' };

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/auth', authRouter);
  return a;
}

/** The code inside the SMS that was just "sent". */
function codeFromSms(): string {
  const msg = (sendSms as jest.Mock).mock.lastCall[1] as string;
  return /(\d{6})/.exec(msg)![1]!;
}

beforeEach(() => {
  resetFakeRedis();
  jest.clearAllMocks();
  (verifyStaffPin as jest.Mock).mockResolvedValue(true);
  (findActiveStaffWithClinicByCode as jest.Mock).mockImplementation(async (code: string) => (code === DOCTOR.staffCode ? DOCTOR : RECEPTIONIST));
});

it('front-desk staff log in with ID and PIN only', async () => {
  const res = await request(app()).post('/auth/login').send({ staffCode: RECEPTIONIST.staffCode, pin: '1234' });
  expect(res.body).toMatchObject({ role: 'RECEPTIONIST' });
  expect(sendSms).not.toHaveBeenCalled();
});

it('a doctor gets no session after the PIN alone: a code is sent by SMS to their own phone', async () => {
  const res = await request(app()).post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  expect(res.body).toMatchObject({ mfaRequired: true, phoneHint: '••• 678' });
  expect(String(res.headers['set-cookie'] ?? '')).not.toContain(SESSION_COOKIE_NAME);
  expect((sendSms as jest.Mock).mock.lastCall[0]).toBe('+254712345678');
  expect((sendSms as jest.Mock).mock.lastCall[2]).toBe('STAFF_LOGIN_CODE');
});

it('the right code gives the session; it works only once', async () => {
  const start = await request(app()).post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  const code = codeFromSms();
  const ok = await request(app()).post('/auth/login/verify').send({ challengeId: start.body.challengeId, code });
  expect(ok.status).toBe(200);
  expect(String(ok.headers['set-cookie'])).toContain(SESSION_COOKIE_NAME);
  const again = await request(app()).post('/auth/login/verify').send({ challengeId: start.body.challengeId, code });
  expect(again.status).toBe(401);
});

it('a wrong code is refused, and after 5 wrong codes even the right one stops working', async () => {
  const start = await request(app()).post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  const code = codeFromSms();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) expect((await request(app()).post('/auth/login/verify').send({ challengeId: start.body.challengeId, code: wrong })).status).toBe(401);
  expect((await request(app()).post('/auth/login/verify').send({ challengeId: start.body.challengeId, code })).status).toBe(401);
});

it('no SMS, no login: if the code cannot be sent, nobody gets in', async () => {
  (sendSms as jest.Mock).mockResolvedValueOnce('failed');
  const res = await request(app()).post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  expect(res.status).toBe(502);
  expect(String(res.headers['set-cookie'] ?? '')).not.toContain(SESSION_COOKIE_NAME);
});

it('"remember this device" skips the code for 30 days, until a PIN reset or deactivation', async () => {
  const agent = request.agent(app());
  const start = await agent.post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  const ok = await agent.post('/auth/login/verify').send({ challengeId: start.body.challengeId, code: codeFromSms(), rememberDevice: true });
  expect(String(ok.headers['set-cookie'])).toMatch(/acisi_staff_device=.*Max-Age=2592000/);

  (sendSms as jest.Mock).mockClear();
  const next = await agent.post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  expect(next.body).toMatchObject({ role: 'DOCTOR' });
  expect(sendSms).not.toHaveBeenCalled();

  (isSessionRevoked as jest.Mock).mockResolvedValue(true); // PIN reset or deactivation since
  const after = await agent.post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  expect(after.body).toMatchObject({ mfaRequired: true });
});

it('a remembered device belongs to one staff member only', async () => {
  const agent = request.agent(app());
  const start = await agent.post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
  await agent.post('/auth/login/verify').send({ challengeId: start.body.challengeId, code: codeFromSms(), rememberDevice: true });
  const otherDoctor = { ...DOCTOR, id: 'doc-2', staffCode: 'ACI-STF-DOC2' };
  (findActiveStaffWithClinicByCode as jest.Mock).mockResolvedValue(otherDoctor);
  const res = await agent.post('/auth/login').send({ staffCode: otherDoctor.staffCode, pin: '1234' });
  expect(res.body).toMatchObject({ mfaRequired: true });
});

it('is off unless STAFF_MFA_ENABLED=true, so nobody is locked out before real SMS works', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { env } = require('../../src/config/env') as { env: { STAFF_MFA_ENABLED: boolean } };
  env.STAFF_MFA_ENABLED = false;
  try {
    const res = await request(app()).post('/auth/login').send({ staffCode: DOCTOR.staffCode, pin: '1234' });
    expect(res.body).toMatchObject({ role: 'DOCTOR' });
    expect(sendSms).not.toHaveBeenCalled();
  } finally {
    env.STAFF_MFA_ENABLED = true;
  }
});
