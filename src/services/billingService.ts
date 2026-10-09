import { Bill, BillItemKind, ClinicPaymentSettings, Payment, PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { smsClient } from '../config/africastalking';
import { logger } from '../utils/logger';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { formatKenyaDate } from '../utils/kenyaTime';
import { generateBillNumber } from '../utils/idCodes';
import { recordAuditEvent } from './auditService';
import {
  assertWithinBalance,
  BillingError,
  computeBillTotals,
  computeCashPayment,
  deriveBillStatus,
  normaliseMpesaCode,
} from './billingMath';
import { buildPaymentReceiptSms } from './smsTemplates';
import { clinicStkConfigured, sendClinicStkPush } from '../mpesa/clinicStk';
import { scheduleClinicStkStatusCheck } from '../jobs/queue';

/**
 * Clinic checkout billing: the bill for a visit, and the payments against
 * it. Clinic money is only ever recorded here or requested into the
 * CLINIC's own till/paybill (clinicStk.ts) — never ACISI's, and ACISI never
 * holds it. Completely separate from the ACISI check-in fee
 * (checkInService), which this never touches.
 *
 * Every write that changes what's been paid runs in one transaction under a
 * per-bill advisory lock and recalculates the bill's paidKes/status inside
 * that same transaction, so concurrent payments can't over-collect.
 */

/** How long an STK prompt may stay "waiting" before it's treated as timed out. */
export const STK_TIMEOUT_MS = 2 * 60 * 1000;

const BILLABLE_VISIT_STATUSES = ['READY_FOR_CHECKOUT', 'DONE'] as const;

type Tx = Prisma.TransactionClient;

async function lockBill(tx: Tx, billId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${billId}`}))`;
}

export async function getPaymentSettings(clinicId: string, db: Tx | typeof prisma = prisma): Promise<ClinicPaymentSettings> {
  const existing = await db.clinicPaymentSettings.findUnique({ where: { clinicId } });
  // Until an admin sets anything up, a clinic takes cash only.
  return (
    existing ?? {
      clinicId,
      acceptsCash: true,
      acceptsCard: false,
      acceptsMobileMoney: false,
      mobileMoneyType: null,
      mobileMoneyNumber: null,
      paybillAccountFormat: null,
      defaultConsultationFeeKes: 0,
      updatedByStaffId: null,
      updatedAt: new Date(0),
    }
  );
}

function assertMethodAccepted(settings: ClinicPaymentSettings, method: PaymentMethod): void {
  const accepted =
    method === 'CASH' ? settings.acceptsCash : method === 'CARD' ? settings.acceptsCard : settings.acceptsMobileMoney;
  if (!accepted) throw new BillingError('This clinic does not accept that payment method. An admin can change this in Settings.');
}

/**
 * Recomputes paidKes (sum of SUCCEEDED payments) and status for a bill,
 * inside the caller's transaction. Returns whether this change took the
 * bill to PAID, which is what triggers the receipt SMS.
 */
async function recalculateBill(tx: Tx, billId: string): Promise<{ bill: Bill; becamePaid: boolean }> {
  const current = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
  const sum = await tx.payment.aggregate({ where: { billId, status: 'SUCCEEDED' }, _sum: { amountKes: true } });
  const paidKes = sum._sum.amountKes ?? 0;
  const status = deriveBillStatus(current.totalKes, paidKes);
  const becamePaid = status === 'PAID' && current.status !== 'PAID';
  const bill = await tx.bill.update({
    where: { id: billId },
    data: { paidKes, status, paidAt: status === 'PAID' ? (current.paidAt ?? new Date()) : null },
  });
  return { bill, becamePaid };
}

// --- Reading -----------------------------------------------------------------

export interface CheckoutView {
  encounterId: string;
  checkInId: string;
  visitStatus: string;
  patient: { id: string; name: string; patientCode: string; phoneNumber: string; smsOptOut: boolean };
  departmentName: string;
  /** The visit's department, with its own consultation fee if it has one (null: use the clinic default). */
  department: { id: string; name: string; consultationFeeKes: number | null };
  settings: {
    acceptsCash: boolean;
    acceptsCard: boolean;
    acceptsMobileMoney: boolean;
    mobileMoneyType: 'TILL' | 'PAYBILL' | null;
    mobileMoneyNumber: string | null;
    defaultConsultationFeeKes: number;
    /** Whether "Request payment" (STK push) is set up on this server. */
    stkAvailable: boolean;
  };
  bill: null | {
    id: string;
    billNumber: string;
    items: { kind: BillItemKind; description: string; amountKes: number }[];
    subtotalKes: number;
    discountKes: number;
    discountReason: string | null;
    totalKes: number;
    paidKes: number;
    balanceKes: number;
    status: string;
    paidAt: Date | null;
    receiptSmsSentAt: Date | null;
    createdAt: Date;
  };
  payments: {
    id: string;
    method: PaymentMethod;
    status: string;
    amountKes: number;
    cashTenderedKes: number | null;
    changeKes: number | null;
    reference: string | null;
    mpesaReceiptNumber: string | null;
    phoneNumber: string | null;
    resultDesc: string | null;
    takenByName: string;
    createdAt: Date;
    completedAt: Date | null;
    voidedAt: Date | null;
    voidedByName: string | null;
    voidReason: string | null;
  }[];
}

export async function getCheckoutView(encounterId: string, clinicId: string): Promise<CheckoutView> {
  const encounter = await prisma.encounter.findFirst({
    where: { id: encounterId, clinicId },
    include: {
      patient: true,
      checkIn: { select: { department: { select: { id: true, name: true, consultationFeeKes: true } } } },
      bill: {
        include: {
          items: { orderBy: { position: 'asc' } },
          payments: {
            orderBy: { createdAt: 'asc' },
            include: { takenByStaff: { select: { name: true } }, voidedByStaff: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!encounter) throw new BillingError('Visit not found', 404);

  const settings = await getPaymentSettings(clinicId);
  const bill = encounter.bill;

  return {
    encounterId: encounter.id,
    checkInId: encounter.checkInId,
    visitStatus: encounter.status,
    patient: {
      id: encounter.patient.id,
      name: `${encounter.patient.firstName} ${encounter.patient.lastName}`.trim(),
      patientCode: encounter.patient.patientCode,
      phoneNumber: encounter.patient.phoneNumber,
      smsOptOut: encounter.patient.smsOptOut,
    },
    departmentName: encounter.checkIn.department.name,
    department: encounter.checkIn.department,
    settings: {
      acceptsCash: settings.acceptsCash,
      acceptsCard: settings.acceptsCard,
      acceptsMobileMoney: settings.acceptsMobileMoney,
      mobileMoneyType: settings.mobileMoneyType,
      mobileMoneyNumber: settings.mobileMoneyNumber,
      defaultConsultationFeeKes: settings.defaultConsultationFeeKes,
      stkAvailable: settings.acceptsMobileMoney && clinicStkConfigured(),
    },
    bill: bill && {
      id: bill.id,
      billNumber: bill.billNumber,
      items: bill.items.map((i) => ({ kind: i.kind, description: i.description, amountKes: i.amountKes })),
      subtotalKes: bill.subtotalKes,
      discountKes: bill.discountKes,
      discountReason: bill.discountReason,
      totalKes: bill.totalKes,
      paidKes: bill.paidKes,
      balanceKes: Math.max(bill.totalKes - bill.paidKes, 0),
      status: bill.status,
      paidAt: bill.paidAt,
      receiptSmsSentAt: bill.receiptSmsSentAt,
      createdAt: bill.createdAt,
    },
    payments: (bill?.payments ?? []).map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountKes: p.amountKes,
      cashTenderedKes: p.cashTenderedKes,
      changeKes: p.changeKes,
      reference: p.reference,
      mpesaReceiptNumber: p.mpesaReceiptNumber ?? p.voidedMpesaReceiptNumber,
      phoneNumber: p.phoneNumber,
      resultDesc: p.resultDesc,
      takenByName: p.takenByStaff.name,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
      voidedAt: p.voidedAt,
      voidedByName: p.voidedByStaff?.name ?? null,
      voidReason: p.voidReason,
    })),
  };
}

// --- The bill -----------------------------------------------------------------

export interface BillItemInput {
  kind: BillItemKind;
  description: string;
  amountKes: number;
}

export interface SaveBillInput {
  encounterId: string;
  clinicId: string;
  staffId: string;
  items: BillItemInput[];
  discountKes: number;
  discountReason?: string | null;
}

/**
 * Creates or replaces the bill's lines and discount. Allowed once the doctor
 * has finished (ready for checkout) or after checkout (patient paying later).
 * The new total can never drop below what's already been paid.
 */
export async function saveBill(input: SaveBillInput): Promise<Bill> {
  const items = input.items.map((item) => ({ ...item, description: item.description.trim() }));
  items.forEach((item, i) => {
    if (!item.description) throw new BillingError(`Item ${i + 1} needs a description`);
  });
  const totals = computeBillTotals(items, input.discountKes, input.discountReason);
  const discountReason = totals.discountKes > 0 ? input.discountReason!.trim() : null;

  const encounter = await prisma.encounter.findFirst({ where: { id: input.encounterId, clinicId: input.clinicId } });
  if (!encounter) throw new BillingError('Visit not found', 404);
  if (!(BILLABLE_VISIT_STATUSES as readonly string[]).includes(encounter.status)) {
    throw new BillingError('A bill can only be made once the doctor has finished with the patient', 409);
  }

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill-encounter:${encounter.id}`}))`;
    let existing = await tx.bill.findUnique({ where: { encounterId: encounter.id } });
    if (existing) {
      await lockBill(tx, existing.id);
      if (totals.totalKes < existing.paidKes) {
        throw new BillingError(`The total can't be less than the KES ${existing.paidKes} already paid. Void a payment first.`, 409);
      }
      await tx.billItem.deleteMany({ where: { billId: existing.id } });
      existing = await tx.bill.update({
        where: { id: existing.id },
        data: { subtotalKes: totals.subtotalKes, discountKes: totals.discountKes, discountReason, totalKes: totals.totalKes },
      });
    } else {
      existing = await tx.bill.create({
        data: {
          billNumber: generateBillNumber(),
          encounterId: encounter.id,
          clinicId: input.clinicId,
          createdByStaffId: input.staffId,
          subtotalKes: totals.subtotalKes,
          discountKes: totals.discountKes,
          discountReason,
          totalKes: totals.totalKes,
        },
      });
    }
    await tx.billItem.createMany({
      data: items.map((item, position) => ({ billId: existing!.id, kind: item.kind, description: item.description, amountKes: item.amountKes, position })),
    });
    return recalculateBill(tx, existing.id);
  });
  const bill = saved.bill;

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'BILL_SAVED',
    entityType: 'Bill',
    entityId: bill.id,
    metadata: { totalKes: bill.totalKes, discountKes: bill.discountKes, itemCount: items.length },
  });
  // Lowering the total to what's already been paid settles the bill.
  if (saved.becamePaid) await sendPaidReceiptSms(bill.id);
  return bill;
}

// --- Payments -------------------------------------------------------------------

/**
 * Runs a payment-creating transaction; if an identical request (same
 * idempotency key) won a race and created the payment first, returns that
 * payment instead of failing.
 */
async function runOnce<T>(idempotencyKey: string, work: () => Promise<T>): Promise<T | { duplicateOf: Payment }> {
  try {
    return await work();
  } catch (err) {
    if ((err as { code?: string; meta?: { target?: string[] } })?.code === 'P2002') {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey } });
      if (existing) return { duplicateOf: existing };
      throw new BillingError('That clashes with a payment already recorded (for example the same M-Pesa code). Refresh and check.', 409);
    }
    throw err;
  }
}

interface PaymentBase {
  billId: string;
  clinicId: string;
  staffId: string;
  /** From the browser, one per payment attempt — makes retries safe. */
  idempotencyKey: string;
}

export type RecordPaymentInput = PaymentBase &
  (
    | { method: 'CASH'; tenderedKes: number }
    | { method: 'CARD'; amountKes: number; reference: string }
    | { method: 'MPESA_MANUAL'; amountKes: number; mpesaCode: string }
  );

/**
 * Throws if this M-Pesa code is already recorded anywhere — as another
 * clinic payment, or as an ACISI check-in fee receipt (from M-Pesa, or
 * entered by staff confirming the fee by hand). (A voided payment
 * releases its code, so a mistaken entry can be re-entered on the right bill.)
 */
async function assertMpesaCodeUnused(tx: Tx, code: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mpesa-code:${code}`}))`;
  const [clinicPayment, feeReceipt, manualFee] = await Promise.all([
    tx.payment.findUnique({ where: { mpesaReceiptNumber: code } }),
    tx.mpesaTransaction.findUnique({ where: { mpesaReceiptNumber: code } }),
    tx.checkIn.findUnique({ where: { manualMpesaCode: code } }),
  ]);
  if (clinicPayment || feeReceipt || manualFee) throw new BillingError(`M-Pesa code ${code} has already been used for a payment`, 409);
}

async function findBillForPayment(tx: Tx, billId: string, clinicId: string): Promise<Bill> {
  const bill = await tx.bill.findFirst({ where: { id: billId, clinicId } });
  if (!bill) throw new BillingError('Bill not found', 404);
  return bill;
}

/** A waiting STK prompt blocks other payments until it resolves or times out, so the patient can't be charged twice. */
async function assertNoPendingStk(tx: Tx, billId: string): Promise<void> {
  const pending = await tx.payment.findFirst({ where: { billId, status: 'PENDING' } });
  if (!pending) return;
  if (Date.now() - pending.createdAt.getTime() > STK_TIMEOUT_MS) {
    await tx.payment.update({
      where: { id: pending.id },
      data: { status: 'TIMED_OUT', resultDesc: 'No answer from M-Pesa in time' },
    });
    return;
  }
  throw new BillingError('An M-Pesa request is still waiting for the patient. Wait for it to finish (up to 2 minutes) or for it to time out.', 409);
}

/** Records a cash, card or manually-entered M-Pesa payment — all confirmed immediately. */
export async function recordPayment(input: RecordPaymentInput): Promise<{ payment: Payment; bill: Bill; changeKes: number | null }> {
  const repeat = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (repeat) {
    if (repeat.billId !== input.billId) throw new BillingError('Duplicate request', 409);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: repeat.billId } });
    return { payment: repeat, bill, changeKes: repeat.changeKes };
  }

  let reference: string | null = null;
  let mpesaCode: string | null = null;
  if (input.method === 'CARD') {
    reference = input.reference.trim();
    if (!/^[A-Za-z0-9-]{4,30}$/.test(reference)) {
      throw new BillingError('Enter the card machine reference or the last 4 digits of the card');
    }
  }
  if (input.method === 'MPESA_MANUAL') mpesaCode = normaliseMpesaCode(input.mpesaCode);

  const result = await runOnce(input.idempotencyKey, () => prisma.$transaction(async (tx) => {
    await lockBill(tx, input.billId);
    const bill = await findBillForPayment(tx, input.billId, input.clinicId);
    assertMethodAccepted(await getPaymentSettings(input.clinicId, tx), input.method);
    await assertNoPendingStk(tx, bill.id);

    const balance = bill.totalKes - bill.paidKes;
    let amountKes: number;
    let cashTenderedKes: number | null = null;
    let changeKes: number | null = null;
    if (input.method === 'CASH') {
      const cash = computeCashPayment(balance, input.tenderedKes);
      amountKes = cash.appliedKes;
      cashTenderedKes = input.tenderedKes;
      changeKes = cash.changeKes;
    } else {
      assertWithinBalance(input.amountKes, balance);
      amountKes = input.amountKes;
    }
    if (mpesaCode) await assertMpesaCodeUnused(tx, mpesaCode);

    const payment = await tx.payment.create({
      data: {
        billId: bill.id,
        clinicId: input.clinicId,
        method: input.method,
        status: 'SUCCEEDED',
        amountKes,
        cashTenderedKes,
        changeKes,
        reference,
        mpesaReceiptNumber: mpesaCode,
        idempotencyKey: input.idempotencyKey,
        takenByStaffId: input.staffId,
        completedAt: new Date(),
      },
    });
    const { bill: updated, becamePaid } = await recalculateBill(tx, bill.id);
    return { payment, bill: updated, becamePaid, changeKes };
  }));
  if ('duplicateOf' in result) {
    return { payment: result.duplicateOf, bill: await prisma.bill.findUniqueOrThrow({ where: { id: result.duplicateOf.billId } }), changeKes: result.duplicateOf.changeKes };
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'PAYMENT_RECORDED',
    entityType: 'Payment',
    entityId: result.payment.id,
    metadata: { billId: input.billId, method: input.method, amountKes: result.payment.amountKes },
  });
  if (result.becamePaid) await sendPaidReceiptSms(result.bill.id);
  return { payment: result.payment, bill: result.bill, changeKes: result.changeKes };
}

/** Fills in a paybill account reference template, e.g. "{patientCode}" -> "ACI-7F2K". */
export function buildAccountReference(format: string | null, values: { patientCode: string; billNumber: string }): string {
  const ref = (format?.trim() || '{billNumber}')
    .replace(/\{patientCode\}/g, values.patientCode)
    .replace(/\{billNumber\}/g, values.billNumber)
    .replace(/[^A-Za-z0-9-]/g, '');
  return (ref || values.billNumber).slice(0, 12);
}

/**
 * "Request payment": sends an M-Pesa prompt to the patient's phone paying
 * the CLINIC's till/paybill. The payment stays PENDING until Daraja's
 * callback (applyClinicStkResult) or the status check resolves it.
 */
export async function requestStkPayment(
  input: PaymentBase & { amountKes: number; phone?: string },
): Promise<{ payment: Payment; bill: Bill }> {
  if (!clinicStkConfigured()) {
    throw new BillingError('M-Pesa requests are not set up on this server yet. Use "Enter M-Pesa code" instead.', 409);
  }
  const repeat = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (repeat) {
    if (repeat.billId !== input.billId) throw new BillingError('Duplicate request', 409);
    return { payment: repeat, bill: await prisma.bill.findUniqueOrThrow({ where: { id: repeat.billId } }) };
  }

  const created = await runOnce(input.idempotencyKey, () => prisma.$transaction(async (tx) => {
    await lockBill(tx, input.billId);
    const bill = await findBillForPayment(tx, input.billId, input.clinicId);
    const settings = await getPaymentSettings(input.clinicId, tx);
    assertMethodAccepted(settings, 'MPESA_STK');
    await assertNoPendingStk(tx, bill.id);
    assertWithinBalance(input.amountKes, bill.totalKes - bill.paidKes);

    const encounter = await tx.encounter.findUniqueOrThrow({
      where: { id: bill.encounterId },
      include: { patient: { select: { phoneNumber: true, patientCode: true } }, clinic: { select: { name: true } } },
    });
    let phoneNumber: string;
    try {
      phoneNumber = toE164(input.phone?.trim() || encounter.patient.phoneNumber);
    } catch (err) {
      if (err instanceof InvalidPhoneNumberError) throw new BillingError('Enter a valid Kenyan phone number for the M-Pesa request');
      throw err;
    }

    const payment = await tx.payment.create({
      data: {
        billId: bill.id,
        clinicId: input.clinicId,
        method: 'MPESA_STK',
        status: 'PENDING',
        amountKes: input.amountKes,
        phoneNumber,
        idempotencyKey: input.idempotencyKey,
        takenByStaffId: input.staffId,
      },
    });
    return { payment, settings, patientCode: encounter.patient.patientCode, billNumber: bill.billNumber, clinicName: encounter.clinic.name };
  }));
  if ('duplicateOf' in created) {
    return { payment: created.duplicateOf, bill: await prisma.bill.findUniqueOrThrow({ where: { id: created.duplicateOf.billId } }) };
  }
  const { payment, settings, patientCode, billNumber, clinicName } = created;

  let sent: Payment;
  try {
    const response = await sendClinicStkPush({
      amountKes: payment.amountKes,
      phoneNumberE164: payment.phoneNumber as string,
      accountReference: buildAccountReference(settings.mobileMoneyType === 'PAYBILL' ? settings.paybillAccountFormat : null, {
        patientCode,
        billNumber,
      }),
      transactionDesc: clinicName,
      mobileMoneyType: settings.mobileMoneyType,
    });
    sent = await prisma.payment.update({
      where: { id: payment.id },
      data: { mpesaCheckoutRequestId: response.checkoutRequestId, mpesaMerchantRequestId: response.merchantRequestId },
    });
    await scheduleClinicStkStatusCheck({ paymentId: payment.id });
  } catch (err) {
    logger.error({ err, paymentId: payment.id }, 'Clinic STK push failed to start');
    sent = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', resultDesc: 'Could not reach M-Pesa. Try again, or enter the M-Pesa code manually.' },
    });
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'MPESA_PAYMENT_REQUESTED',
    entityType: 'Payment',
    entityId: payment.id,
    metadata: { billId: input.billId, amountKes: payment.amountKes, sent: sent.status === 'PENDING' },
  });
  return { payment: sent, bill: await prisma.bill.findUniqueOrThrow({ where: { id: payment.billId } }) };
}

/** Daraja result codes: 0 paid, 1032 the patient cancelled, 1037 no answer from their phone; anything else failed. */
export function stkStatusForResultCode(resultCode: number): 'SUCCEEDED' | 'CANCELLED' | 'TIMED_OUT' | 'FAILED' {
  if (resultCode === 0) return 'SUCCEEDED';
  if (resultCode === 1032) return 'CANCELLED';
  if (resultCode === 1037) return 'TIMED_OUT';
  return 'FAILED';
}

export interface ClinicStkResult {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  mpesaReceiptNumber?: string;
  rawPayload?: unknown;
}

/**
 * Applies Daraja's verdict on a clinic STK push (callback or status query).
 * Returns false if the checkout request isn't one of ours. A success always
 * wins — even after the payment was marked timed out — because the money
 * really did arrive; a repeat of the same result changes nothing.
 */
export async function applyClinicStkResult(result: ClinicStkResult): Promise<boolean> {
  const found = await prisma.payment.findUnique({ where: { mpesaCheckoutRequestId: result.checkoutRequestId } });
  if (!found) return false;

  const outcome = await prisma.$transaction(async (tx) => {
    await lockBill(tx, found.billId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
    const newStatus = stkStatusForResultCode(result.resultCode);

    if (payment.status === 'SUCCEEDED' || payment.status === 'VOIDED') return null; // already settled
    if (payment.status !== 'PENDING' && newStatus !== 'SUCCEEDED') return null; // nothing new

    let receipt: string | null = result.mpesaReceiptNumber?.trim().toUpperCase() || null;
    if (receipt) {
      const taken = await tx.payment.findUnique({ where: { mpesaReceiptNumber: receipt } });
      if (taken && taken.id !== payment.id) {
        logger.warn({ paymentId: payment.id, receipt }, 'M-Pesa receipt already recorded on another payment; storing without code');
        receipt = null;
      }
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: newStatus,
        resultCode: result.resultCode,
        resultDesc: result.resultDesc,
        mpesaReceiptNumber: newStatus === 'SUCCEEDED' ? receipt : null,
        rawCallbackPayload: (result.rawPayload ?? undefined) as Prisma.InputJsonValue | undefined,
        completedAt: newStatus === 'SUCCEEDED' ? new Date() : null,
      },
    });
    const recalculated = await recalculateBill(tx, payment.billId);
    return { status: newStatus, billId: payment.billId, ...recalculated };
  });

  if (outcome) {
    await recordAuditEvent({
      actorType: 'SYSTEM',
      action: outcome.status === 'SUCCEEDED' ? 'MPESA_PAYMENT_SUCCEEDED' : `MPESA_PAYMENT_${outcome.status}`,
      entityType: 'Payment',
      entityId: found.id,
      metadata: { resultCode: result.resultCode, resultDesc: result.resultDesc },
    });
    if (outcome.becamePaid) await sendPaidReceiptSms(outcome.billId);
  }
  return true;
}

/** Marks a still-waiting STK payment as timed out (used when Daraja gives no final answer). */
export async function markStkTimedOut(paymentId: string, reason = 'No answer from M-Pesa in time'): Promise<void> {
  await prisma.payment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'TIMED_OUT', resultDesc: reason } });
}

/**
 * Clinic admin only (enforced by the route): voids a payment entered by
 * mistake. The row is kept with who, when and why; the bill is recalculated.
 */
export async function voidPayment(input: { paymentId: string; clinicId: string; staffId: string; reason: string }): Promise<Bill> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new BillingError('Give a reason for voiding this payment');

  const bill = await prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findFirst({ where: { id: input.paymentId, clinicId: input.clinicId } });
    if (!existing) throw new BillingError('Payment not found', 404);
    await lockBill(tx, existing.billId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: existing.id } });
    if (payment.status !== 'SUCCEEDED') throw new BillingError('Only a completed payment can be voided', 409);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedByStaffId: input.staffId,
        voidReason: reason,
        // Release the code so it can be re-entered on the right bill; keep it on record.
        mpesaReceiptNumber: null,
        voidedMpesaReceiptNumber: payment.mpesaReceiptNumber,
      },
    });
    return (await recalculateBill(tx, payment.billId)).bill;
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: input.staffId,
    staffId: input.staffId,
    action: 'PAYMENT_VOIDED',
    entityType: 'Payment',
    entityId: input.paymentId,
    metadata: { reason },
  });
  return bill;
}

// --- Receipt ------------------------------------------------------------------

export type ReceiptSmsOutcome = 'sent' | 'opted_out' | 'already_sent' | 'failed';

/**
 * Sends the "paid" receipt SMS, once per bill (claimed atomically via
 * receiptSmsSentAt), unless the patient has opted out of SMS. Never throws —
 * a failed SMS must not affect the payment that triggered it.
 */
export async function sendPaidReceiptSms(billId: string): Promise<ReceiptSmsOutcome> {
  try {
    const bill = await prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      include: {
        clinic: { select: { name: true } },
        encounter: { include: { patient: { select: { id: true, phoneNumber: true, smsOptOut: true, deletedAt: true } } } },
        payments: { where: { status: 'SUCCEEDED' }, orderBy: { completedAt: 'asc' } },
      },
    });
    const patient = bill.encounter.patient;
    if (bill.paidKes <= 0) return 'already_sent'; // nothing was paid (KES 0 bill): no receipt to send
    if (patient.smsOptOut || patient.deletedAt) {
      await recordAuditEvent({ actorType: 'SYSTEM', action: 'RECEIPT_SMS_SKIPPED_OPT_OUT', entityType: 'Bill', entityId: bill.id });
      return 'opted_out';
    }
    const claimed = await prisma.bill.updateMany({ where: { id: bill.id, receiptSmsSentAt: null }, data: { receiptSmsSentAt: new Date() } });
    if (claimed.count === 0) return 'already_sent';

    const message = buildPaymentReceiptSms({
      clinicName: bill.clinic.name,
      totalPaidKes: bill.paidKes,
      date: formatKenyaDate(bill.paidAt ?? new Date()),
      payments: bill.payments.map((p) => ({ method: p.method, reference: p.mpesaReceiptNumber ?? p.reference })),
    });
    await smsClient.send({ to: [patient.phoneNumber], message });
    await recordAuditEvent({ actorType: 'SYSTEM', action: 'RECEIPT_SMS_SENT', entityType: 'Bill', entityId: bill.id });
    return 'sent';
  } catch (err) {
    logger.error({ err, billId }, 'Failed to send paid receipt SMS');
    return 'failed';
  }
}

export { BillingError };
