import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

jest.mock('../../src/dashboard/session', () => ({
  ...jest.requireActual('../../src/dashboard/session'),
  loadDashboardSession: jest.fn(),
}));
jest.mock('../../src/services/billingService', () => ({
  ...jest.requireActual('../../src/services/billingMath'),
  getCheckoutView: jest.fn(),
  saveBill: jest.fn(),
  recordPayment: jest.fn(),
  requestStkPayment: jest.fn(),
  voidPayment: jest.fn(),
}));
jest.mock('../../src/services/billingReportService', () => ({ getDailySummary: jest.fn() }));

import { loadDashboardSession, SESSION_COOKIE_NAME } from '../../src/dashboard/session';
import { BillingError, getCheckoutView, recordPayment, saveBill, voidPayment } from '../../src/services/billingService';
import { getDailySummary } from '../../src/services/billingReportService';
import { billingRouter } from '../../src/dashboard/billing';

const RECEPTIONIST = {
  staffId: 'staff-1',
  staffCode: 'ACI-STF-TEST',
  staffName: 'Test Receptionist',
  role: 'RECEPTIONIST',
  clinicId: 'clinic-A',
  clinicName: 'Sunrise',
  departmentId: null,
};
const asRole = (role: string) => (loadDashboardSession as jest.Mock).mockResolvedValue({ ...RECEPTIONIST, role });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/billing', billingRouter);
  return app;
}
const withCookie = (req: request.Test) => req.set('Cookie', `${SESSION_COOKIE_NAME}=tok`);
const KEY = 'abcdef12-3456';

beforeEach(() => {
  jest.clearAllMocks();
  asRole('RECEPTIONIST');
  (getCheckoutView as jest.Mock).mockResolvedValue({ encounterId: 'enc-1' });
  (recordPayment as jest.Mock).mockResolvedValue({ payment: { id: 'pay-1' }, bill: { status: 'PAID' }, changeKes: 700 });
  (voidPayment as jest.Mock).mockResolvedValue({ status: 'UNPAID', paidKes: 0 });
  (getDailySummary as jest.Mock).mockResolvedValue({ totals: {} });
});

describe('billing routes: who can use them', () => {
  it('refuses a request with no session', async () => {
    (loadDashboardSession as jest.Mock).mockResolvedValue(null);
    expect((await withCookie(request(buildApp()).get('/billing/visits/enc-1'))).status).toBe(401);
  });

  it('refuses doctors', async () => {
    asRole('DOCTOR');
    const res = await withCookie(request(buildApp()).post('/billing/bills/b-1/payments').send({ method: 'CASH', tenderedKes: 500, idempotencyKey: KEY }));
    expect(res.status).toBe(403);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('only lets admins void payments and see the daily summary', async () => {
    for (const role of ['RECEPTIONIST', 'CLINICIAN']) {
      asRole(role);
      expect((await withCookie(request(buildApp()).post('/billing/payments/pay-1/void').send({ reason: 'Wrong patient' }))).status).toBe(403);
      expect((await withCookie(request(buildApp()).get('/billing/reports/daily'))).status).toBe(403);
    }
    expect(voidPayment).not.toHaveBeenCalled();

    asRole('ADMIN');
    const res = await withCookie(request(buildApp()).post('/billing/payments/pay-1/void').send({ reason: 'Wrong patient' }));
    expect(res.status).toBe(200);
    expect(voidPayment).toHaveBeenCalledWith({ paymentId: 'pay-1', clinicId: 'clinic-A', staffId: 'staff-1', reason: 'Wrong patient' });
  });
});

describe('server-side validation', () => {
  it.each([
    ['decimal amount', { method: 'CASH', tenderedKes: 99.5, idempotencyKey: KEY }],
    ['string amount', { method: 'CASH', tenderedKes: '500', idempotencyKey: KEY }],
    ['negative amount', { method: 'CARD', amountKes: -5, reference: '4242', idempotencyKey: KEY }],
    ['missing idempotency key', { method: 'CASH', tenderedKes: 500 }],
    ['unknown method', { method: 'BITCOIN', amountKes: 5, idempotencyKey: KEY }],
  ])('rejects a payment with %s', async (_label, body) => {
    expect((await withCookie(request(buildApp()).post('/billing/bills/b-1/payments').send(body))).status).toBe(400);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('rejects a bill with decimal amounts or no items', async () => {
    for (const body of [{ items: [] }, { items: [{ kind: 'CONSULTATION', description: 'Consult', amountKes: 500.5 }] }]) {
      expect((await withCookie(request(buildApp()).put('/billing/visits/enc-1/bill').send(body))).status).toBe(400);
    }
    expect(saveBill).not.toHaveBeenCalled();
  });

  it('requires a void reason', async () => {
    asRole('ADMIN');
    expect((await withCookie(request(buildApp()).post('/billing/payments/pay-1/void').send({ reason: '' }))).status).toBe(400);
  });

  it('records a valid cash payment and returns the change', async () => {
    const res = await withCookie(request(buildApp()).post('/billing/bills/b-1/payments').send({ method: 'CASH', tenderedKes: 2000, idempotencyKey: KEY }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ paymentId: 'pay-1', changeKes: 700, billStatus: 'PAID' });
    expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({ billId: 'b-1', clinicId: 'clinic-A', staffId: 'staff-1', tenderedKes: 2000 }));
  });

  it('turns a billing rule error into its status and message', async () => {
    (recordPayment as jest.Mock).mockRejectedValue(new BillingError('M-Pesa code QAB12CD34E has already been used for a payment', 409));
    const res = await withCookie(
      request(buildApp()).post('/billing/bills/b-1/payments').send({ method: 'MPESA_MANUAL', amountKes: 500, mpesaCode: 'QAB12CD34E', idempotencyKey: KEY }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already been used');
  });
});

describe('GET /reports/daily', () => {
  beforeEach(() => asRole('ADMIN'));

  it('accepts a past date', async () => {
    expect((await withCookie(request(buildApp()).get('/billing/reports/daily?date=2026-01-15'))).status).toBe(200);
    expect(getDailySummary).toHaveBeenCalledWith('clinic-A', '2026-01-15');
  });

  it.each(['2026-13-01', 'yesterday', '2999-01-01'])('rejects %s', async (date) => {
    expect((await withCookie(request(buildApp()).get(`/billing/reports/daily?date=${date}`))).status).toBe(400);
  });
});
