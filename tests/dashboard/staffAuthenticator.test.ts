/** Multi-factor login with an authenticator app: setup in Settings (not at login), app codes, replay, lockout, admin reset. */
process.env.STAFF_MFA_ENABLED = 'true';
process.env.STAFF_MFA_SMS_ENABLED = 'false';
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/services/smsService', () => ({ sendSms: jest.fn(async () => 'sent') }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/sessionRevocation', () => ({ isSessionRevoked: jest.fn(async () => false), revokeSessionsFor: jest.fn() }));
jest.mock('../../src/db/prisma', () => ({ prisma: { staff: { update: jest.fn(), findUnique: jest.fn(async () => null) } } }));
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
import { recordAuditEvent } from '../../src/services/auditService';
import { revokeSessionsFor } from '../../src/services/sessionRevocation';
import { prisma } from '../../src/db/prisma';
import { findActiveStaffWithClinicByCode, verifyStaffPin } from '../../src/services/staffService';
import { authRouter } from '../../src/dashboard/auth';
import { SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { resetAuthenticator } from '../../src/services/staffMfaService';
import { totpCodeForStep, totpStep } from '../../src/utils/totp';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const DOCTOR: Record<string, unknown> = { id: 'doc-1', staffCode: 'ACI-STF-DOC1', name: 'Dr A', role: 'DOCTOR', phoneNumber: '+254712345678', clinicId: 'c-1', departmentId: 'd-1', clinic: { name: 'Sunrise' }, totpSecret: null };

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/auth', authRouter);
  return a;
}
const login = () => request(app()).post('/auth/login').send({ staffCode: 'ACI-STF-DOC1', pin: '1234' });
const verify = (challengeId: string, code: string) => request(app()).post('/auth/login/verify').send({ challengeId, code });
const codeNow = (secret: string, offset = 0) => totpCodeForStep(secret.replace(/\s/g, ''), totpStep() + offset);

let current: Record<string, unknown>;
beforeEach(() => {
  resetFakeRedis();
  jest.clearAllMocks();
  current = { ...DOCTOR };
  (verifyStaffPin as jest.Mock).mockResolvedValue(true);
  (findActiveStaffWithClinicByCode as jest.Mock).mockImplementation(async () => current);
});

it('with no app yet, the PIN alone logs a doctor in: no QR code at the login screen, no SMS', async () => {
  const res = await login();
  expect(res.body).toMatchObject({ role: 'DOCTOR' });
  expect(String(res.headers['set-cookie'])).toContain(SESSION_COOKIE_NAME);
  expect(sendSms).not.toHaveBeenCalled();
});

/** A logged-in doctor (no app yet) as a cookie-keeping agent. */
async function loggedInAgent() {
  const agent = request.agent(app());
  expect((await agent.post('/auth/login').send({ staffCode: 'ACI-STF-DOC1', pin: '1234' })).body).toMatchObject({ role: 'DOCTOR' });
  return agent;
}

it('Settings: status says multi-factor login is available and not set up yet', async () => {
  const agent = await loggedInAgent();
  const res = await agent.get('/auth/mfa');
  expect(res.body).toEqual({ available: true, setUp: false, setUpAt: null });
});

it('Settings: setup shows a QR code; the first code from the app saves it, and the next login asks for the app code', async () => {
  const agent = await loggedInAgent();
  const start = await agent.post('/auth/mfa/setup');
  expect(start.body).toMatchObject({ setupId: expect.any(String), accountName: 'ACI-STF-DOC1' });
  expect(start.body.qrCodeSvg).toMatch(/^<svg/);
  const secret = start.body.secret.replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  const ok = await agent.post('/auth/mfa/setup/confirm').send({ setupId: start.body.setupId, code: codeNow(secret) });
  expect(ok.status).toBe(200);
  expect(prisma.staff.update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { totpSecret: secret, totpEnabledAt: expect.any(Date) } });
  expect((recordAuditEvent as jest.Mock).mock.calls.map((c) => c[0].action)).toContain('STAFF_AUTHENTICATOR_SET_UP');

  current = { ...DOCTOR, totpSecret: secret };
  const next = await login();
  expect(next.body).toMatchObject({ mfaRequired: true, method: 'authenticator' });
  expect(String(next.headers['set-cookie'] ?? '')).not.toContain(SESSION_COOKIE_NAME);
});

it('Settings: a wrong code saves nothing, and after 5 the setup must start again', async () => {
  const agent = await loggedInAgent();
  const start = await agent.post('/auth/mfa/setup');
  const good = codeNow(start.body.secret);
  const wrong = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) expect((await agent.post('/auth/mfa/setup/confirm').send({ setupId: start.body.setupId, code: wrong })).body.error).toMatch(/Wrong code/);
  expect((await agent.post('/auth/mfa/setup/confirm').send({ setupId: start.body.setupId, code: wrong })).body.error).toMatch(/start again/);
  expect((await agent.post('/auth/mfa/setup/confirm').send({ setupId: start.body.setupId, code: good })).status).toBe(400);
  expect(prisma.staff.update).not.toHaveBeenCalled();
});

it("Settings: one person's setup can't be confirmed by another", async () => {
  const agent = await loggedInAgent();
  const start = await agent.post('/auth/mfa/setup');
  current = { ...DOCTOR, id: 'doc-2', staffCode: 'ACI-STF-DOC2' };
  const other = request.agent(app());
  await other.post('/auth/login').send({ staffCode: 'ACI-STF-DOC2', pin: '1234' });
  const res = await other.post('/auth/mfa/setup/confirm').send({ setupId: start.body.setupId, code: codeNow(start.body.secret) });
  expect(res.status).toBe(400);
  expect(prisma.staff.update).not.toHaveBeenCalled();
});

it('Settings: front desk has no multi-factor setup', async () => {
  current = { ...DOCTOR, role: 'RECEPTIONIST' };
  const agent = request.agent(app());
  await agent.post('/auth/login').send({ staffCode: 'ACI-STF-DOC1', pin: '1234' });
  expect((await agent.get('/auth/mfa')).body).toMatchObject({ available: false });
  expect((await agent.post('/auth/mfa/setup')).status).toBe(403);
});

it('with an app set up, the doctor is asked for the app code, and the right one logs in', async () => {
  current = { ...DOCTOR, totpSecret: SECRET };
  const start = await login();
  expect(start.body).toEqual({ mfaRequired: true, challengeId: expect.any(String), method: 'authenticator' });
  expect(JSON.stringify(start.body)).not.toContain(SECRET);
  const ok = await verify(start.body.challengeId, codeNow(SECRET));
  expect(ok.status).toBe(200);
  expect(String(ok.headers['set-cookie'])).toContain(SESSION_COOKIE_NAME);
});

it('an app code from 30 s ago still works (phone clock drift)', async () => {
  current = { ...DOCTOR, totpSecret: SECRET };
  const start = await login();
  expect((await verify(start.body.challengeId, codeNow(SECRET, -1))).status).toBe(200);
});

it('the same app code cannot be used twice', async () => {
  current = { ...DOCTOR, totpSecret: SECRET };
  const code = codeNow(SECRET);
  const first = await login();
  expect((await verify(first.body.challengeId, code)).status).toBe(200);
  const second = await login();
  expect((await verify(second.body.challengeId, code)).status).toBe(401);
});

it('5 wrong codes lock the account for a few minutes, and logging in again with the right PIN does not reset that', async () => {
  current = { ...DOCTOR, totpSecret: SECRET };
  const good = codeNow(SECRET);
  const wrong = good === '000000' ? '111111' : '000000';
  let start = await login();
  for (let i = 0; i < 4; i++) expect((await verify(start.body.challengeId, wrong)).status).toBe(401);
  start = await login(); // right PIN again: must not clear the wrong-code count
  const locked = await verify(start.body.challengeId, wrong);
  expect(locked.status).toBe(429);
  expect(locked.body.error).toMatch(/Too many wrong codes/);
  const blocked = await login();
  expect(blocked.status).toBe(429);
});

it('front desk is never asked for a code', async () => {
  current = { ...DOCTOR, role: 'RECEPTIONIST' };
  const res = await login();
  expect(res.body).toMatchObject({ role: 'RECEPTIONIST' });
});

it('resetting the authenticator forgets the secret and logs the person out everywhere', async () => {
  await resetAuthenticator('doc-1');
  expect(prisma.staff.update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { totpSecret: null, totpEnabledAt: null } });
  expect(revokeSessionsFor).toHaveBeenCalledWith('staff:doc-1');
});
