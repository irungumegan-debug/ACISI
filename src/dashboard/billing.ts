import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireStaffSession, AuthenticatedRequest } from './auth';
import {
  BillingError,
  getCheckoutView,
  recordPayment,
  requestStkPayment,
  saveBill,
  voidPayment,
} from '../services/billingService';
import { getDailySummary } from '../services/billingReportService';
import { isIsoDate, kenyaToday } from '../utils/kenyaTime';
import { MAX_AMOUNT_KES } from '../services/billingMath';

export const billingRouter = Router();

billingRouter.use(requireStaffSession);

/** Billing is front-desk work (receptionist, clinician, admin) — doctors are refused on the server. */
function requireFrontDesk(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthenticatedRequest).dashboardSession.role === 'DOCTOR') {
    res.status(403).json({ error: 'Only front-desk staff can take payments' });
    return;
  }
  next();
}

billingRouter.use(requireFrontDesk);

function session(req: Request) {
  return (req as AuthenticatedRequest).dashboardSession;
}

/** Runs a handler, turning a BillingError into its HTTP status and message. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof BillingError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  };
}

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request' });
}

/** Whole KES only: rejects decimals, negatives, strings and anything absurd. */
const kes = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number of KES`)
    .min(0, `${label} can't be negative`)
    .max(MAX_AMOUNT_KES, `${label} is too large`);

const idempotencyKey = z.string().trim().min(8).max(100);

billingRouter.get(
  '/visits/:encounterId',
  handle(async (req, res) => {
    res.json(await getCheckoutView(req.params.encounterId as string, session(req).clinicId));
  }),
);

const billSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(['CONSULTATION', 'LAB', 'MEDICATION', 'OTHER']),
        description: z.string().trim().min(1, 'Each item needs a description').max(100),
        amountKes: kes('Item amount'),
      }),
    )
    .min(1, 'Add at least one item to the bill')
    .max(50),
  discountKes: kes('Discount').default(0),
  discountReason: z.string().trim().max(200).nullish(),
});

billingRouter.put(
  '/visits/:encounterId/bill',
  handle(async (req, res) => {
    const parsed = billSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { clinicId, staffId } = session(req);
    await saveBill({ encounterId: req.params.encounterId as string, clinicId, staffId, ...parsed.data });
    res.json(await getCheckoutView(req.params.encounterId as string, clinicId));
  }),
);

const paymentSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('CASH'), tenderedKes: kes('Amount received'), idempotencyKey }),
  z.object({ method: z.literal('CARD'), amountKes: kes('Amount'), reference: z.string().trim().min(1, 'Enter the card reference').max(30), idempotencyKey }),
  z.object({ method: z.literal('MPESA_MANUAL'), amountKes: kes('Amount'), mpesaCode: z.string().trim().min(1, 'Enter the M-Pesa code').max(20), idempotencyKey }),
]);

billingRouter.post(
  '/bills/:billId/payments',
  handle(async (req, res) => {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { clinicId, staffId } = session(req);
    const result = await recordPayment({ ...parsed.data, billId: req.params.billId as string, clinicId, staffId });
    res.status(201).json({ paymentId: result.payment.id, changeKes: result.changeKes, billStatus: result.bill.status });
  }),
);

const stkSchema = z.object({ amountKes: kes('Amount'), phone: z.string().trim().max(20).optional(), idempotencyKey });

billingRouter.post(
  '/bills/:billId/mpesa-request',
  handle(async (req, res) => {
    const parsed = stkSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { clinicId, staffId } = session(req);
    const result = await requestStkPayment({ ...parsed.data, billId: req.params.billId as string, clinicId, staffId });
    res.status(201).json({ paymentId: result.payment.id, status: result.payment.status, resultDesc: result.payment.resultDesc });
  }),
);

const voidSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason for voiding this payment').max(200) });

/** Voiding is clinic-admin only. */
billingRouter.post(
  '/payments/:paymentId/void',
  requireAdmin,
  handle(async (req, res) => {
    const parsed = voidSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { clinicId, staffId } = session(req);
    const bill = await voidPayment({ paymentId: req.params.paymentId as string, clinicId, staffId, reason: parsed.data.reason });
    res.json({ billStatus: bill.status, paidKes: bill.paidKes });
  }),
);

/** Clinic-admin daily summary; ?date=YYYY-MM-DD (Kenyan date), defaulting to today. */
billingRouter.get(
  '/reports/daily',
  requireAdmin,
  handle(async (req, res) => {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : kenyaToday();
    if (!isIsoDate(date)) {
      res.status(400).json({ error: 'Use a date like 2026-10-03' });
      return;
    }
    if (date > kenyaToday()) {
      res.status(400).json({ error: "That date hasn't happened yet" });
      return;
    }
    res.json(await getDailySummary(session(req).clinicId, date));
  }),
);
