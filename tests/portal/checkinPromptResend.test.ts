import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/portal/session', () => ({
  ...jest.requireActual('../../src/portal/session'),
  loadPatientSession: jest.fn(),
}));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/checkInService', () => ({
  ...jest.requireActual('../../src/services/checkInService'),
  initiateCheckIn: jest.fn(),
  queryCheckInPayment: jest.fn(),
  resendCheckInPrompt: jest.fn(),
}));
jest.mock('../../src/db/prisma', () => ({
  prisma: { checkIn: { findFirst: jest.fn() }, encounter: { count: jest.fn(async () => 2) } },
}));

import { loadPatientSession, PATIENT_SESSION_COOKIE_NAME } from '../../src/portal/session';
import {
  PromptResendError,
  queryCheckInPayment,
  resendCheckInPrompt,
} from '../../src/services/checkInService';
import { prisma } from '../../src/db/prisma';
import { env } from '../../src/config/env';
import { portalCheckinRouter } from '../../src/portal/checkin';

const findCheckIn = prisma.checkIn.findFirst as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/checkin', portalCheckinRouter);
  return app;
}
const withCookie = (r: request.Test) => r.set('Cookie', `${PATIENT_SESSION_COOKIE_NAME}=tok`);

const ROW = {
  id: 'ci-1',
  status: 'FAILED',
  amountKes: 50,
  createdAt: new Date(Date.now() - 10 * 60_000),
  paymentRequestedAt: new Date(Date.now() - 10 * 60_000),
  queuedBeforePaymentAt: new Date(Date.now() - 10 * 60_000),
  feeSettledAt: null,
  paymentPromptResends: 1,
  departmentId: 'd1',
  clinic: { name: 'Uhai Clinic' },
  department: { name: 'General' },
  encounter: null,
};

// A made-up till: whatever is set on the server must never reach a patient.
(env as { MPESA_TILL_NUMBER?: string }).MPESA_TILL_NUMBER = '5123456';

beforeEach(() => {
  jest.clearAllMocks();
  (loadPatientSession as jest.Mock).mockResolvedValue({
    patientId: 'patient-1',
    patientCode: 'ACI-7F2K',
    firstName: 'Jane',
  });
  findCheckIn.mockResolvedValue(ROW);
});

describe('"Resend prompt" on the check-in screen (C20)', () => {
  it("the check-in screen says how many resends are left, and never shows ACISI's shortcode or till number", async () => {
    const res = await withCookie(request(buildApp()).get('/checkin/ci-1'));
    expect(res.status).toBe(200);
    expect(res.body.promptResend).toEqual({ resendsLeft: 2, availableAt: null });
    expect(JSON.stringify(res.body)).not.toContain(env.MPESA_SHORTCODE);
    expect(JSON.stringify(res.body)).not.toContain('5123456');
  });

  it('a prompt still live on the phone: the button works from a minute after it was sent', async () => {
    const sent = new Date(Date.now() - 30_000);
    findCheckIn.mockResolvedValue({ ...ROW, status: 'PENDING_PAYMENT', paymentRequestedAt: sent });
    const res = await withCookie(request(buildApp()).get('/checkin/ci-1'));
    expect(res.body.promptResend.availableAt).toBe(new Date(sent.getTime() + 60_000).toISOString());
    // Polling asks Safaricom about the latest (resent) prompt from ~20s after it.
    expect(queryCheckInPayment).toHaveBeenCalledWith('ci-1');
  });

  it('nothing to resend once paid', async () => {
    findCheckIn.mockResolvedValue({ ...ROW, status: 'PAID' });
    expect((await withCookie(request(buildApp()).get('/checkin/ci-1'))).body.promptResend).toBeNull();
  });

  it('resends for the logged-in patient only, and returns the updated check-in without the till number', async () => {
    (resendCheckInPrompt as jest.Mock).mockResolvedValue({
      checkInId: 'ci-1',
      status: 'PENDING_PAYMENT',
      resendsLeft: 1,
    });
    const res = await withCookie(request(buildApp()).post('/checkin/ci-1/resend-prompt'));
    expect(res.status).toBe(200);
    expect(resendCheckInPrompt).toHaveBeenCalledWith('ci-1', 'patient-1');
    expect(res.body).toMatchObject({ checkInId: 'ci-1', resendStatus: 'PENDING_PAYMENT' });
    expect(JSON.stringify(res.body)).not.toContain(env.MPESA_SHORTCODE);
    expect(JSON.stringify(res.body)).not.toContain('5123456');
  });

  it('passes on the reason a resend was refused', async () => {
    (resendCheckInPrompt as jest.Mock).mockRejectedValue(
      new PromptResendError('The prompt has already been resent 3 times.', 429),
    );
    const res = await withCookie(request(buildApp()).post('/checkin/ci-1/resend-prompt'));
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('The prompt has already been resent 3 times.');
  });

  it('needs a patient login', async () => {
    (loadPatientSession as jest.Mock).mockResolvedValue(null);
    expect((await request(buildApp()).post('/checkin/ci-1/resend-prompt')).status).toBe(401);
    expect(resendCheckInPrompt).not.toHaveBeenCalled();
  });
});
