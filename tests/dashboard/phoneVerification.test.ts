import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({ prisma: { patient: { findFirst: jest.fn() } } }));
jest.mock('../../src/services/pendingSignupService', () => {
  class PendingSignupError extends Error {
    constructor(
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  }
  return { findPendingSignupsByPhone: jest.fn(async () => []), completePendingSignupInPerson: jest.fn(), PendingSignupError };
});
jest.mock('../../src/services/otpService', () => ({ issueInPersonSetupCode: jest.fn() }));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { prisma } from '../../src/db/prisma';
import { completePendingSignupInPerson, findPendingSignupsByPhone } from '../../src/services/pendingSignupService';
import { issueInPersonSetupCode } from '../../src/services/otpService';
import { phoneVerificationRouter } from '../../src/dashboard/phoneVerification';

const SESSION = { staffId: 's1', staffCode: 'ACI-STF-TEST', staffName: 'R', role: 'RECEPTIONIST', clinicId: 'c1', clinicName: 'X', departmentId: null };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/phone-verification', phoneVerificationRouter);
  return app;
}
const withCookie = (r: request.Test) => r.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);

beforeEach(() => {
  jest.clearAllMocks();
  (loadDashboardSession as jest.Mock).mockResolvedValue(SESSION);
});

describe('front-desk phone verification (C3 fallback)', () => {
  it('looks up pending signups by any phone format', async () => {
    const res = await withCookie(request(buildApp()).get('/phone-verification/pending-signups?phone=0712%20345%20678'));
    expect(res.status).toBe(200);
    expect(findPendingSignupsByPhone).toHaveBeenCalledWith('+254712345678', 's1', 'c1');
  });

  it('will not finish a signup unless staff confirm the phone rang in front of them', async () => {
    const res = await withCookie(request(buildApp()).post('/phone-verification/pending-signups/pend-1/complete').send({}));
    expect(res.status).toBe(400);
    expect(completePendingSignupInPerson).not.toHaveBeenCalled();
  });

  it('finishes it once confirmed', async () => {
    (completePendingSignupInPerson as jest.Mock).mockResolvedValue({ patientCode: 'ACI-NEW1' });
    const res = await withCookie(request(buildApp()).post('/phone-verification/pending-signups/pend-1/complete').send({ phoneConfirmedInPerson: true }));
    expect(res.status).toBe(201);
    expect(completePendingSignupInPerson).toHaveBeenCalledWith('pend-1', 's1', 'c1');
  });

  it('gives a setup code only for a patient this clinic has seen, after confirmation', async () => {
    (prisma.patient.findFirst as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).post('/phone-verification/patients/p9/setup-code').send({ phoneConfirmedInPerson: true }))).status).toBe(404);

    (prisma.patient.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', patientCode: 'ACI-7F2K' });
    expect((await withCookie(request(buildApp()).post('/phone-verification/patients/p1/setup-code').send({}))).status).toBe(400);
    (issueInPersonSetupCode as jest.Mock).mockResolvedValue({ code: '123456', expiresAt: new Date() });
    const ok = await withCookie(request(buildApp()).post('/phone-verification/patients/p1/setup-code').send({ phoneConfirmedInPerson: true }));
    expect(ok.status).toBe(201);
    expect(issueInPersonSetupCode).toHaveBeenCalledWith('p1', 's1', 'c1');
  });

  it('doctors are refused', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue({ ...SESSION, role: 'DOCTOR' });
    expect((await withCookie(request(buildApp()).get('/phone-verification/pending-signups?phone=0712345678'))).status).toBe(403);
  });
});
