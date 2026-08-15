import { CheckIn } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { recordAuditEvent } from './auditService';
import { initiateStkPush } from '../mpesa/stkPush';
import { ParsedStkCallback } from '../mpesa/types';
import { enqueueSmsReceipt, scheduleStkStatusCheck } from '../jobs/queue';

interface InitiateCheckInInput {
  ussdSessionId: string;
  patientId: string;
  clinicId: string;
  clinicName: string;
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
    metadata: { clinicId: input.clinicId },
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

  await prisma.checkIn.update({
    where: { id: checkIn.id },
    data: { status: succeeded ? 'PAID' : 'FAILED', paidAt: succeeded ? new Date() : null },
  });

  if (succeeded) {
    await prisma.encounter.create({
      data: { patientId: checkIn.patientId, clinicId: checkIn.clinicId, checkInId: checkIn.id },
    });
  }

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: succeeded ? 'CHECK_IN_PAID' : 'CHECK_IN_PAYMENT_FAILED',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { resultCode: parsed.resultCode, resultDesc: parsed.resultDesc },
  });

  await enqueueSmsReceipt({
    checkInId: checkIn.id,
    patientId: checkIn.patientId,
    succeeded,
  });
}
