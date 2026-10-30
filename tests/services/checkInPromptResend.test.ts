jest.mock('../../src/db/prisma', () => ({
  prisma: {
    checkIn: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    patient: { findUniqueOrThrow: jest.fn() },
    clinic: { findUniqueOrThrow: jest.fn() },
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('../../src/config/redis', () => require('../helpers/fakeRedis').fakeRedisModule());
jest.mock('../../src/mpesa/stkPush', () => ({ initiateStkPush: jest.fn() }));
jest.mock('../../src/mpesa/verify', () => ({ queryStkPushStatus: jest.fn() }));
jest.mock('../../src/services/auditService', () => ({ recordAuditEvent: jest.fn() }));
jest.mock('../../src/services/mpesaHealth', () => ({
  notePromptFailed: jest.fn(),
  notePromptResult: jest.fn(),
}));
jest.mock('../../src/services/realtimeEvents', () => ({
  publishCheckInPaid: jest.fn(),
  publishCheckInFailed: jest.fn(),
  publishQueueChanged: jest.fn(),
}));
jest.mock('../../src/jobs/queue', () => ({ enqueueSmsReceipt: jest.fn() }));
jest.mock('../../src/services/doctorAssignmentService', () => ({ assignDoctorForCheckIn: jest.fn() }));
jest.mock('../../src/services/appointmentService', () => ({
  findArrivalMatch: jest.fn(),
  getAppointmentForArrival: jest.fn(),
  markAppointmentCompleted: jest.fn(),
}));

import { prisma } from '../../src/db/prisma';
import { initiateStkPush } from '../../src/mpesa/stkPush';
import { queryStkPushStatus } from '../../src/mpesa/verify';
import { recordAuditEvent } from '../../src/services/auditService';
import { notePromptFailed } from '../../src/services/mpesaHealth';
import { PromptResendError, resendCheckInPrompt } from '../../src/services/checkInService';
import { MAX_PROMPT_RESENDS_PER_CHECK_IN } from '../../src/config/constants';
import { resetFakeRedis } from '../helpers/fakeRedis';

const findFirst = prisma.checkIn.findFirst as jest.Mock;
const updateMany = prisma.checkIn.updateMany as jest.Mock;
const stk = initiateStkPush as jest.Mock;
const NOW = new Date('2026-11-02T08:00:00Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

const checkIn = (overrides: Record<string, unknown> = {}) => ({
  id: 'ci-12345678901',
  patientId: 'p1',
  clinicId: 'c1',
  status: 'FAILED',
  amountKes: 50,
  queuedBeforePaymentAt: secondsAgo(600),
  paymentRequestedAt: secondsAgo(600),
  createdAt: secondsAgo(600),
  feeSettledAt: null,
  paymentPromptResends: 0,
  mpesaCheckoutRequestId: 'ws_CO_old',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetFakeRedis();
  updateMany.mockResolvedValue({ count: 1 });
  (prisma.patient.findUniqueOrThrow as jest.Mock).mockResolvedValue({ phoneNumber: '+254712345678' });
  (prisma.clinic.findUniqueOrThrow as jest.Mock).mockResolvedValue({ name: 'Uhai Clinic' });
  stk.mockResolvedValue({ checkoutRequestId: 'ws_CO_new', merchantRequestId: 'mr-new' });
});

describe('"Resend prompt" on the check-in screen (C20)', () => {
  it('sends the same fee prompt again, counts the resend and logs it', async () => {
    findFirst.mockResolvedValue(checkIn());
    const res = await resendCheckInPrompt('ci-12345678901', 'p1', NOW);
    expect(res).toEqual({ checkInId: 'ci-12345678901', status: 'PENDING_PAYMENT', resendsLeft: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'ci-12345678901',
        status: 'FAILED',
        paymentPromptResends: { lt: 3 },
        feeSettledAt: null,
      }),
      data: expect.objectContaining({
        status: 'PENDING_PAYMENT',
        paymentRequestedAt: NOW,
        paymentPromptResends: { increment: 1 },
      }),
    });
    expect(stk).toHaveBeenCalledWith(
      expect.objectContaining({ amountKes: 50, phoneNumberE164: '+254712345678' }),
    );
    expect(prisma.checkIn.update).toHaveBeenCalledWith({
      where: { id: 'ci-12345678901' },
      data: { mpesaCheckoutRequestId: 'ws_CO_new', mpesaMerchantRequestId: 'mr-new' },
    });
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CHECK_IN_PROMPT_RESENT',
        entityId: 'ci-12345678901',
        metadata: { resendNumber: 1, status: 'PENDING_PAYMENT' },
      }),
    );
  });

  it(`at most ${MAX_PROMPT_RESENDS_PER_CHECK_IN} resends per check-in`, async () => {
    expect(MAX_PROMPT_RESENDS_PER_CHECK_IN).toBe(3);
    findFirst.mockResolvedValue(checkIn({ paymentPromptResends: 2 }));
    expect((await resendCheckInPrompt('ci-12345678901', 'p1', NOW)).resendsLeft).toBe(0);

    findFirst.mockResolvedValue(checkIn({ paymentPromptResends: 3 }));
    const err = await resendCheckInPrompt('ci-12345678901', 'p1', NOW).catch((e) => e);
    expect(err).toBeInstanceOf(PromptResendError);
    expect(err.status).toBe(429);
    expect(err.message).toContain('You are still in the queue');
    expect(stk).toHaveBeenCalledTimes(1);
  });

  it('a double press only resends once', async () => {
    findFirst.mockResolvedValue(checkIn({ paymentPromptResends: 2 }));
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([
      resendCheckInPrompt('ci-12345678901', 'p1', NOW),
      resendCheckInPrompt('ci-12345678901', 'p1', NOW),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(stk).toHaveBeenCalledTimes(1);
  });

  it('not while the last prompt may still be on the phone (first minute)', async () => {
    findFirst.mockResolvedValue(checkIn({ status: 'PENDING_PAYMENT', paymentRequestedAt: secondsAgo(20) }));
    const err = await resendCheckInPrompt('ci-12345678901', 'p1', NOW).catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/try again in 40 seconds/);
    expect(stk).not.toHaveBeenCalled();
  });

  it('after a minute, asks Safaricom first: if it was paid after all, no second prompt', async () => {
    const pending = checkIn({ status: 'PENDING_PAYMENT', paymentRequestedAt: secondsAgo(90) });
    findFirst.mockResolvedValue(pending);
    (prisma.checkIn.findUnique as jest.Mock)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'PAID' });
    (queryStkPushStatus as jest.Mock).mockRejectedValue(new Error('still processing'));
    const err = await resendCheckInPrompt('ci-12345678901', 'p1', NOW).catch((e) => e);
    expect(queryStkPushStatus).toHaveBeenCalledWith('ws_CO_old');
    expect(err.message).toBe('This check-in fee has already been paid.');
    expect(stk).not.toHaveBeenCalled();
  });

  it.each([
    ['paid', { status: 'PAID' }],
    ['already paid off by a later payment', { feeSettledAt: new Date() }],
    ['no fee', { status: 'NO_FEE' }],
  ])('nothing to resend when %s', async (_label, overrides) => {
    findFirst.mockResolvedValue(checkIn(overrides));
    await expect(resendCheckInPrompt('ci-12345678901', 'p1', NOW)).rejects.toBeInstanceOf(PromptResendError);
    expect(stk).not.toHaveBeenCalled();
  });

  it("only the patient's own check-in", async () => {
    findFirst.mockResolvedValue(null);
    const err = await resendCheckInPrompt('ci-12345678901', 'someone-else', NOW).catch((e) => e);
    expect(err.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'ci-12345678901', patientId: 'someone-else' } });
  });

  it('if the resent prompt cannot be sent, the fee is owed again and it counts towards the owner warning', async () => {
    findFirst.mockResolvedValue(checkIn());
    stk.mockRejectedValue(new Error('Daraja down'));
    const res = await resendCheckInPrompt('ci-12345678901', 'p1', NOW);
    expect(res.status).toBe('FAILED');
    expect(prisma.checkIn.update).toHaveBeenCalledWith({
      where: { id: 'ci-12345678901' },
      data: { status: 'FAILED' },
    });
    expect(notePromptFailed).toHaveBeenCalled();
  });
});
