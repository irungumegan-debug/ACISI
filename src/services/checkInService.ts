import { CheckIn } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { initiateStkPush } from '../mpesa/stkPush';
import { ParsedStkCallback } from '../mpesa/types';
import { enqueueSmsReceipt, scheduleStkStatusCheck } from '../jobs/queue';
import { publishCheckInPaid } from './realtimeEvents';

interface InitiateCheckInInput {
  ussdSessionId: string;
  patientId: string;
  clinicId: string;
  clinicName: string;
  departmentId: string;
  phoneNumberE164: string;
}

interface InitiateCheckInResult {
  checkIn: CheckIn;
  /** True if this call found an existing CheckIn for the session (recovery replay) rather than creating one. */
  wasAlreadyInitiated: boolean;
}

/**
 * Creates the CheckIn row and triggers the STK push. ussdSessionId is unique
 * on CheckIn, so if a dropped-session replay (src/ussd/session.ts) calls
 * this twice for the same session, the second call reuses the existing row
 * instead of double-charging the patient.
 */
export async function initiateCheckIn(input: InitiateCheckInInput): Promise<InitiateCheckInResult> {
  const existing = await prisma.checkIn.findUnique({ where: { ussdSessionId: input.ussdSessionId } });
  if (existing) {
    return { checkIn: existing, wasAlreadyInitiated: true };
  }

  const checkIn = await prisma.checkIn.create({
    data: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      departmentId: input.departmentId,
      ussdSessionId: input.ussdSessionId,
      amountKes: env.CHECKIN_FEE_AMOUNT_KES,
      status: 'PENDING_PAYMENT',
    },
  });

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: input.patientId,
    action: 'CHECK_IN_CREATED',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { clinicId: input.clinicId, departmentId: input.departmentId },
  });

  try {
    const stkResponse = await initiateStkPush({
      amountKes: env.CHECKIN_FEE_AMOUNT_KES,
      phoneNumberE164: input.phoneNumberE164,
      // Daraja caps AccountReference at 12 chars.
      accountReference: checkIn.id.slice(-10),
      transactionDesc: `Check-in fee: ${input.clinicName}`,
    });

    const updated = await prisma.checkIn.update({
      where: { id: checkIn.id },
      data: {
        mpesaCheckoutRequestId: stkResponse.checkoutRequestId,
        mpesaMerchantRequestId: stkResponse.merchantRequestId,
      },
    });

    await scheduleStkStatusCheck({ checkInId: updated.id, checkoutRequestId: stkResponse.checkoutRequestId });

    return { checkIn: updated, wasAlreadyInitiated: false };
  } catch (err) {
    logger.error({ err, checkInId: checkIn.id }, 'STK push failed to initiate; marking check-in FAILED');
    const failed = await prisma.checkIn.update({ where: { id: checkIn.id }, data: { status: 'FAILED' } });
    return { checkIn: failed, wasAlreadyInitiated: false };
  }
}

/**
 * Shared tail of "this CheckIn just got paid," whatever the payment method:
 * marks it PAID, creates the Encounter (WAITING — this is what makes the
 * visit show up in the doctor's queue and the patient's portable history),
 * publishes the live-queue event, and enqueues the payment receipt SMS.
 * Callers are responsible for anything method-specific before this (e.g.
 * recording the MpesaTransaction row) and for their own audit event.
 */
async function finalizePaidCheckIn(checkIn: CheckIn): Promise<CheckIn> {
  const updated = await prisma.checkIn.update({
    where: { id: checkIn.id },
    data: { status: 'PAID', paidAt: new Date() },
    include: { patient: true },
  });

  await prisma.encounter.create({
    data: { patientId: checkIn.patientId, clinicId: checkIn.clinicId, checkInId: checkIn.id },
  });

  publishCheckInPaid({
    checkInId: updated.id,
    patientId: updated.patientId,
    patientName: `${updated.patient.firstName} ${updated.patient.lastName}`,
    clinicId: updated.clinicId,
    amountKes: Number(updated.amountKes),
    paidAt: (updated.paidAt as Date).toISOString(),
  });

  await enqueueSmsReceipt({ checkInId: updated.id, patientId: updated.patientId, succeeded: true });

  return updated;
}

/**
 * Applies a parsed Daraja STK callback (or query-worker result) to the
 * matching CheckIn: logs the MpesaTransaction, marks PAID/FAILED, and on
 * success creates the Encounter that makes this visit show up in the
 * patient's portable history.
 */
export async function applyPaymentResult(parsed: ParsedStkCallback, rawPayload: unknown): Promise<void> {
  const checkIn = await prisma.checkIn.findUnique({
    where: { mpesaCheckoutRequestId: parsed.checkoutRequestId },
  });

  if (!checkIn) {
    logger.warn({ checkoutRequestId: parsed.checkoutRequestId }, 'Received M-Pesa result for unknown CheckIn');
    return;
  }

  if (checkIn.status !== 'PENDING_PAYMENT') {
    logger.info({ checkInId: checkIn.id, status: checkIn.status }, 'Ignoring duplicate M-Pesa result');
    return;
  }

  await prisma.mpesaTransaction.create({
    data: {
      checkInId: checkIn.id,
      merchantRequestId: parsed.merchantRequestId,
      checkoutRequestId: parsed.checkoutRequestId,
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      mpesaReceiptNumber: parsed.mpesaReceiptNumber,
      transactionDate: parsed.transactionDate,
      phoneNumber: parsed.phoneNumber ?? '',
      amountKes: parsed.amountKes ?? checkIn.amountKes,
      rawCallbackPayload: rawPayload as never,
    },
  });

  const succeeded = parsed.resultCode === 0;

  if (succeeded) {
    await finalizePaidCheckIn(checkIn);
  } else {
    await prisma.checkIn.update({ where: { id: checkIn.id }, data: { status: 'FAILED' } });
    await enqueueSmsReceipt({ checkInId: checkIn.id, patientId: checkIn.patientId, succeeded: false });
  }

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: succeeded ? 'CHECK_IN_PAID' : 'CHECK_IN_PAYMENT_FAILED',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { resultCode: parsed.resultCode, resultDesc: parsed.resultDesc },
  });
}

export class CheckInNotPendingError extends Error {
  constructor() {
    super('This check-in is not awaiting payment');
    this.name = 'CheckInNotPendingError';
  }
}

/**
 * Real, permanent, audited manual payment confirmation — for clinics that
 * are bank-only or take payment through their own till directly, without an
 * M-Pesa STK push. Never bypasses the STK flow for a check-in that already
 * has one in progress; only usable while still PENDING_PAYMENT. Scoped to
 * the confirming staff member's own clinic by the caller (dashboard route),
 * same as every other staff-facing check-in action.
 */
export async function confirmCheckInPaidManually(checkInId: string, clinicId: string, staffId: string): Promise<CheckIn> {
  const checkIn = await prisma.checkIn.findFirst({ where: { id: checkInId, clinicId } });
  if (!checkIn) {
    throw new Error('Check-in not found');
  }
  if (checkIn.status !== 'PENDING_PAYMENT') {
    throw new CheckInNotPendingError();
  }

  const updated = await finalizePaidCheckIn(checkIn);

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'CHECK_IN_PAID_MANUALLY',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { confirmedByStaffId: staffId },
  });

  return updated;
}

/**
 * Dev-only convenience for local testing without a real M-Pesa sandbox —
 * never used by the real, staff-audited manual payment confirmation feature
 * above (confirmCheckInPaidManually). Callers (scripts/devMarkCheckInPaid.ts)
 * must gate this behind NODE_ENV/MPESA_ENV themselves.
 */
export async function devMarkCheckInPaid(checkInId: string): Promise<CheckIn> {
  const checkIn = await prisma.checkIn.findUnique({ where: { id: checkInId } });
  if (!checkIn) {
    throw new Error('Check-in not found');
  }
  if (checkIn.status !== 'PENDING_PAYMENT') {
    throw new CheckInNotPendingError();
  }

  const updated = await finalizePaidCheckIn(checkIn);

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: 'CHECK_IN_PAID_DEV_SCRIPT',
    entityType: 'CheckIn',
    entityId: checkIn.id,
  });

  return updated;
}
