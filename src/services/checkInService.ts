import crypto from 'node:crypto';
import { CheckIn, CheckInStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { errorSummary, logger } from '../utils/logger';
import { redis } from '../config/redis';
import { queryStkPushStatus } from '../mpesa/verify';
import { normaliseMpesaCode } from './billingMath';
import { recordAuditEvent } from './auditService';
import { initiateStkPush } from '../mpesa/stkPush';
import { ParsedStkCallback } from '../mpesa/types';
import { enqueueSmsReceipt } from '../jobs/queue';
import { DEMO_CHECKIN_FEE_KES } from './demoGuard';
import { publishCheckInFailed, publishCheckInPaid } from './realtimeEvents';
import { assignDoctorForCheckIn } from './doctorAssignmentService';
import { findArrivalMatch, getAppointmentForArrival, markAppointmentCompleted } from './appointmentService';

interface InitiateCheckInInput {
  ussdSessionId: string;
  patientId: string;
  clinicId: string;
  clinicName: string;
  departmentId: string;
  phoneNumberE164: string;
  /**
   * Set only when the caller already knows exactly which appointment this
   * arrival fulfills (the staff-arrival path below) — skips the automatic
   * same-day lookup. Left undefined for every other caller (USSD, web
   * portal), which instead get auto-matched against findArrivalMatch so a
   * booked patient links up however they actually show up.
   */
  appointmentId?: string;
}

interface InitiateCheckInResult {
  checkIn: CheckIn;
  /** True if this call found an existing CheckIn for the session (recovery replay) rather than creating one. */
  wasAlreadyInitiated: boolean;
}

/** ACISI's check-in fee at this clinic: the demo fee at a demo clinic (see demoGuard.ts), the normal fee everywhere else. */
export async function checkInFeeKes(clinicId: string): Promise<number> {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { isDemo: true } });
  return clinic?.isDemo ? DEMO_CHECKIN_FEE_KES : env.CHECKIN_FEE_AMOUNT_KES;
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

  const appointmentId =
    input.appointmentId !== undefined
      ? input.appointmentId
      : ((await findArrivalMatch(input.patientId, input.clinicId, input.departmentId))?.id ?? null);

  const amountKes = await checkInFeeKes(input.clinicId);

  const checkIn = await prisma.checkIn.create({
    data: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      departmentId: input.departmentId,
      ussdSessionId: input.ussdSessionId,
      amountKes,
      status: 'PENDING_PAYMENT',
      appointmentId,
    },
  });

  // The appointment is "done" the moment it produces a real arrival — this
  // CheckIn's own status (PENDING_PAYMENT/PAID/FAILED) tracks payment
  // completely separately, same as every other CheckIn.
  if (appointmentId) {
    await markAppointmentCompleted(appointmentId);
  }

  await recordAuditEvent({
    actorType: 'PATIENT',
    actorId: input.patientId,
    action: 'CHECK_IN_CREATED',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { clinicId: input.clinicId, departmentId: input.departmentId, appointmentId },
  });

  try {
    const stkResponse = await initiateStkPush({
      amountKes,
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

    // No callback? The portal's polling (from ~20s) and the once-a-minute
    // sweep ask Safaricom directly — see queryCheckInPayment.

    return { checkIn: updated, wasAlreadyInitiated: false };
  } catch (err) {
    logger.error({ err, checkInId: checkIn.id }, 'STK push failed to initiate; marking check-in FAILED');
    const failed = await prisma.checkIn.update({ where: { id: checkIn.id }, data: { status: 'FAILED' } });
    // Without this, a staff member already watching the live queue would
    // never see this arrival until they manually reload the page — the row
    // is created and visible on a fresh load either way, but nothing tells
    // an already-open dashboard to refetch on a failure the way it does on
    // a successful payment (claimPaid's publishCheckInPaid below).
    publishCheckInFailed({ checkInId: failed.id, clinicId: failed.clinicId });
    return { checkIn: failed, wasAlreadyInitiated: false };
  }
}

/** Where a check-in's payment outcome came from — the only thing besides ids and codes that payment logs carry. */
export type PaymentSource = 'callback' | 'query' | 'staff';

/**
 * The one log line for every payment outcome, whatever its source. Only
 * these four fields, ever: never the phone number, receipt or transaction
 * code, or a Daraja payload.
 */
function logPaymentOutcome(
  checkInId: string | null,
  source: PaymentSource,
  resultCode: number | null,
  status: CheckInStatus | null,
): void {
  logger.info({ checkInId, source, resultCode, status }, 'Check-in payment');
}

/**
 * States an automated M-Pesa answer (callback or status query) may still
 * resolve. NEEDS_REVIEW is included: it only means nobody knew yet, so a
 * late definite answer still settles it. Anything else (PAID, FAILED,
 * CANCELLED, NO_FEE) has already been decided, and a later answer is a no-op.
 */
const AWAITING_MPESA: CheckInStatus[] = ['PENDING_PAYMENT', 'NEEDS_REVIEW'];

/**
 * Moves a check-in to PAID and starts the visit — exactly once, however many
 * sources (callback, status query, staff) race to do it. The status change
 * is a conditional update (`status IN from`), so only one caller can win;
 * everyone else gets null and must do nothing. In the same transaction as
 * the win: `withinTx` (e.g. the MpesaTransaction row) and the Encounter
 * (WAITING — what puts the patient in the doctor's queue and their portable
 * history), assigned to a doctor in the department (doctorAssignmentService).
 * After commit: the live-queue event and the receipt SMS. Callers record
 * their own audit event.
 */
async function claimPaid(
  checkIn: CheckIn,
  from: CheckInStatus[],
  extra: Prisma.CheckInUncheckedUpdateManyInput = {},
  withinTx?: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<CheckIn | null> {
  const assignedDoctorId = await assignDoctorForCheckIn(checkIn.clinicId, checkIn.departmentId);

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.checkIn.updateMany({
      where: { id: checkIn.id, status: { in: from } },
      data: { ...extra, status: 'PAID', paidAt: new Date() },
    });
    if (count === 0) return null;
    if (withinTx) await withinTx(tx);
    await tx.encounter.create({
      data: {
        patientId: checkIn.patientId,
        clinicId: checkIn.clinicId,
        checkInId: checkIn.id,
        assignedDoctorId,
      },
    });
    return tx.checkIn.findUniqueOrThrow({ where: { id: checkIn.id }, include: { patient: true } });
  });
  if (!updated) return null;

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
 * Applies a definite M-Pesa answer for a check-in's STK push — from Daraja's
 * callback or from the status query — to the matching CheckIn: PAID on
 * ResultCode 0, FAILED otherwise. Whichever answer arrives first wins; a
 * later one (or a duplicate callback) finds the check-in already decided and
 * changes nothing. Writes the one payment log line.
 *
 * Returns the CheckIn's id and status afterwards, or null if no CheckIn
 * matches.
 */
export async function applyPaymentResult(
  parsed: ParsedStkCallback,
  rawPayload: unknown,
  source: Exclude<PaymentSource, 'staff'> = 'callback',
): Promise<{ checkInId: string; status: CheckInStatus } | null> {
  const checkIn = await prisma.checkIn.findUnique({
    where: { mpesaCheckoutRequestId: parsed.checkoutRequestId },
  });

  if (!checkIn) {
    logPaymentOutcome(null, source, parsed.resultCode, null);
    return null;
  }

  const recordTransaction = (tx: Prisma.TransactionClient) =>
    tx.mpesaTransaction.create({
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
  let won: boolean;

  if (succeeded) {
    won = (await claimPaid(checkIn, AWAITING_MPESA, {}, recordTransaction)) !== null;
  } else {
    won = await prisma.$transaction(async (tx) => {
      const { count } = await tx.checkIn.updateMany({
        where: { id: checkIn.id, status: { in: AWAITING_MPESA } },
        data: { status: 'FAILED' },
      });
      if (count === 0) return false;
      await recordTransaction(tx);
      return true;
    });
    if (won) {
      await enqueueSmsReceipt({ checkInId: checkIn.id, patientId: checkIn.patientId, succeeded: false });
      publishCheckInFailed({ checkInId: checkIn.id, clinicId: checkIn.clinicId });
    }
  }

  if (!won) {
    // Already decided by an earlier answer, or by staff: nothing to do.
    const current = await prisma.checkIn.findUnique({ where: { id: checkIn.id }, select: { status: true } });
    const status = current?.status ?? checkIn.status;
    logPaymentOutcome(checkIn.id, source, parsed.resultCode, status);
    return { checkInId: checkIn.id, status };
  }

  const status: CheckInStatus = succeeded ? 'PAID' : 'FAILED';
  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: succeeded ? 'CHECK_IN_PAID' : 'CHECK_IN_PAYMENT_FAILED',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: { resultCode: parsed.resultCode, resultDesc: parsed.resultDesc, source },
  });
  logPaymentOutcome(checkIn.id, source, parsed.resultCode, status);
  return { checkInId: checkIn.id, status };
}

/**
 * Daraja status-query ResultCodes that definitely mean "this STK push did
 * not go through": 1 insufficient balance, 1019 expired, 1032 cancelled by
 * the patient, 1037 phone unreachable, 2001 wrong PIN. Anything else
 * (including the query itself erroring with "transaction is being
 * processed") leaves the check-in pending for the next try.
 */
const DEFINITE_FAILURE_CODES = new Set([1, 1019, 1032, 1037, 2001]);

/** Ask Safaricom about a given check-in at most this often, however many tabs poll and workers run. */
const QUERY_THROTTLE_SECONDS = 10;

/**
 * Asks Safaricom's M-Pesa Express Query API (stkpushquery) for the outcome
 * of a check-in's STK push and applies a definite answer — the fallback for
 * when the callback never arrives. Used by the patient portal while it polls
 * (from ~20s after the push) and by the once-a-minute sweep. Does nothing
 * unless the check-in is still awaiting M-Pesa, and never queries the same
 * check-in more than once per QUERY_THROTTLE_SECONDS.
 *
 * Returns the check-in's status afterwards.
 */
export async function queryCheckInPayment(checkInId: string): Promise<CheckInStatus | null> {
  const checkIn = await prisma.checkIn.findUnique({ where: { id: checkInId } });
  if (!checkIn) return null;
  if (!AWAITING_MPESA.includes(checkIn.status) || !checkIn.mpesaCheckoutRequestId) return checkIn.status;

  const gotSlot = await redis.set(
    `mpesa:checkin-query:${checkIn.id}`,
    '1',
    'EX',
    QUERY_THROTTLE_SECONDS,
    'NX',
  );
  if (gotSlot !== 'OK') return checkIn.status;

  let result: Awaited<ReturnType<typeof queryStkPushStatus>>;
  try {
    result = await queryStkPushStatus(checkIn.mpesaCheckoutRequestId);
  } catch {
    // Daraja answers "still processing" with an HTTP error, and a network
    // blip looks the same from here: either way, leave it pending.
    // (queryStkPushStatus already logged the Daraja error.)
    logPaymentOutcome(checkIn.id, 'query', null, checkIn.status);
    return checkIn.status;
  }

  const resultCode = Number(result.resultCode);
  if (resultCode !== 0 && !DEFINITE_FAILURE_CODES.has(resultCode)) {
    logPaymentOutcome(checkIn.id, 'query', Number.isFinite(resultCode) ? resultCode : null, checkIn.status);
    return checkIn.status;
  }

  const applied = await applyPaymentResult(
    {
      merchantRequestId: result.merchantRequestId ?? checkIn.mpesaMerchantRequestId ?? '',
      checkoutRequestId: checkIn.mpesaCheckoutRequestId,
      resultCode,
      resultDesc: result.resultDesc,
      amountKes: resultCode === 0 ? Number(checkIn.amountKes) : undefined,
    },
    { source: 'stk-status-query', resultCode: result.resultCode, resultDesc: result.resultDesc },
    'query',
  );
  return applied?.status ?? checkIn.status;
}

/** A pending check-in is queried by the sweep from this age… */
export const SWEEP_MIN_AGE_MS = 60 * 1000;
/** …until this age, after which it is handed to staff as NEEDS_REVIEW. */
export const NEEDS_REVIEW_AFTER_MS = 60 * 60 * 1000;

/**
 * The once-a-minute safety net (see jobs/workers/stkStatusWorker.ts): queries
 * Safaricom for every check-in that has been PENDING_PAYMENT for 1–60
 * minutes, then moves any still pending after 60 minutes to NEEDS_REVIEW so
 * it shows up for front desk instead of sitting silently forever.
 */
export async function sweepPendingCheckInPayments(
  now: Date = new Date(),
): Promise<{ queried: number; needsReview: number }> {
  const reviewCutoff = new Date(now.getTime() - NEEDS_REVIEW_AFTER_MS);

  const pending = await prisma.checkIn.findMany({
    where: {
      status: 'PENDING_PAYMENT',
      mpesaCheckoutRequestId: { not: null },
      createdAt: { gte: reviewCutoff, lte: new Date(now.getTime() - SWEEP_MIN_AGE_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const { id } of pending) {
    try {
      await queryCheckInPayment(id);
    } catch (err) {
      logger.error({ err: errorSummary(err), checkInId: id }, 'Check-in payment query failed');
    }
  }

  const stale = await prisma.checkIn.findMany({
    where: { status: 'PENDING_PAYMENT', createdAt: { lt: reviewCutoff } },
    select: { id: true, clinicId: true },
  });
  let needsReview = 0;
  for (const checkIn of stale) {
    const { count } = await prisma.checkIn.updateMany({
      where: { id: checkIn.id, status: 'PENDING_PAYMENT' },
      data: { status: 'NEEDS_REVIEW' },
    });
    if (count === 0) continue; // An answer arrived in the meantime.
    needsReview += 1;
    publishCheckInFailed({ checkInId: checkIn.id, clinicId: checkIn.clinicId });
    await recordAuditEvent({
      actorType: 'SYSTEM',
      action: 'CHECK_IN_PAYMENT_NEEDS_REVIEW',
      entityType: 'CheckIn',
      entityId: checkIn.id,
    });
    logPaymentOutcome(checkIn.id, 'query', null, 'NEEDS_REVIEW');
  }

  return { queried: pending.length, needsReview };
}

export class CheckInNotPendingError extends Error {
  constructor() {
    super('This check-in has already been paid or cancelled');
    this.name = 'CheckInNotPendingError';
  }
}

/** A bad (400) or already-used (409) M-Pesa code entered by staff. */
export class InvalidMpesaCodeError extends Error {
  constructor(
    message: string,
    public status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = 'InvalidMpesaCodeError';
  }
}

/**
 * Real, permanent, audited manual confirmation of ACISI's own check-in fee
 * — a flat platform fee patients pay to use ACISI at all, entirely separate
 * from however a clinic collects its own consultation fee from the patient.
 * Exists so staff can rescue a check-in when the automated M-Pesa flow
 * didn't get it resolved: the prompt never started, Daraja had an off
 * moment, no callback and no query answer (NEEDS_REVIEW), a short balance, a
 * mistyped number. Staff enter the M-Pesa transaction code from the
 * patient's SMS; it's stored on the check-in with who confirmed it and when,
 * and refused if that code was already used for any payment.
 *
 * Usable while PENDING_PAYMENT, FAILED or NEEDS_REVIEW — never once a
 * check-in is PAID or CANCELLED. If M-Pesa's own answer lands at the same
 * moment, only one of them takes effect (see claimPaid). Scoped to the
 * confirming staff member's own clinic by the caller (dashboard route).
 */
export async function confirmCheckInPaidManually(
  checkInId: string,
  clinicId: string,
  staffId: string,
  rawMpesaCode: string,
): Promise<CheckIn> {
  let mpesaCode: string;
  try {
    mpesaCode = normaliseMpesaCode(rawMpesaCode);
  } catch (err) {
    throw new InvalidMpesaCodeError(err instanceof Error ? err.message : 'Enter a valid M-Pesa code');
  }

  const checkIn = await prisma.checkIn.findFirst({ where: { id: checkInId, clinicId } });
  if (!checkIn) {
    throw new Error('Check-in not found');
  }
  if (
    checkIn.status !== 'PENDING_PAYMENT' &&
    checkIn.status !== 'FAILED' &&
    checkIn.status !== 'NEEDS_REVIEW'
  ) {
    throw new CheckInNotPendingError();
  }

  // Same lock and checks as a clinic payment's M-Pesa code
  // (billingService.assertMpesaCodeUnused), so one code can never pay for
  // two things, even with two screens submitting at once.
  const assertCodeUnused = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mpesa-code:${mpesaCode}`}))`;
    const [otherCheckIn, feeReceipt, clinicPayment] = await Promise.all([
      tx.checkIn.findFirst({ where: { manualMpesaCode: mpesaCode, id: { not: checkIn.id } } }),
      tx.mpesaTransaction.findUnique({ where: { mpesaReceiptNumber: mpesaCode } }),
      tx.payment.findUnique({ where: { mpesaReceiptNumber: mpesaCode } }),
    ]);
    if (otherCheckIn || feeReceipt || clinicPayment) {
      throw new InvalidMpesaCodeError(`M-Pesa code ${mpesaCode} has already been used for a payment`, 409);
    }
  };

  const confirmedAt = new Date();
  let updated: CheckIn | null;
  try {
    updated = await claimPaid(
      checkIn,
      ['PENDING_PAYMENT', 'FAILED', 'NEEDS_REVIEW'],
      { manualMpesaCode: mpesaCode, paymentConfirmedByStaffId: staffId, paymentConfirmedAt: confirmedAt },
      assertCodeUnused,
    );
  } catch (err) {
    // Belt and braces: the unique index on manualMpesaCode.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new InvalidMpesaCodeError(`M-Pesa code ${mpesaCode} has already been used for a payment`, 409);
    }
    throw err;
  }
  if (!updated) {
    // M-Pesa's answer (or another receptionist) got there first.
    throw new CheckInNotPendingError();
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'CHECK_IN_PAID_MANUALLY',
    entityType: 'CheckIn',
    entityId: checkIn.id,
    metadata: {
      confirmedByStaffId: staffId,
      confirmedAt: confirmedAt.toISOString(),
      previousStatus: checkIn.status,
    },
  });
  logPaymentOutcome(checkIn.id, 'staff', null, 'PAID');

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

  const updated = await claimPaid(checkIn, ['PENDING_PAYMENT']);
  if (!updated) {
    throw new CheckInNotPendingError();
  }

  await recordAuditEvent({
    actorType: 'SYSTEM',
    action: 'CHECK_IN_PAID_DEV_SCRIPT',
    entityType: 'CheckIn',
    entityId: checkIn.id,
  });

  return updated;
}

/**
 * Staff explicitly checking a booked patient in, rather than the patient
 * arriving and checking in themselves — e.g. a patient who called ahead, or
 * whose booking staff want to convert directly. Reuses the exact same
 * initiateCheckIn (same fee, same STK push to the patient's own phone) as
 * every other check-in, just pre-linked to a specific appointment instead of
 * relying on the automatic same-day match. Records its own audit event,
 * distinct from initiateCheckIn's patient-attributed CHECK_IN_CREATED, so
 * the staff action itself is accountable.
 */
export async function checkInPatientForAppointment(
  appointmentId: string,
  clinicId: string,
  staffId: string,
): Promise<InitiateCheckInResult> {
  const appointment = await getAppointmentForArrival(appointmentId, clinicId);

  const result = await initiateCheckIn({
    ussdSessionId: `STAFF-${crypto.randomUUID()}`,
    patientId: appointment.patientId,
    clinicId: appointment.clinicId,
    clinicName: appointment.clinicName,
    departmentId: appointment.departmentId,
    phoneNumberE164: appointment.phoneNumberE164,
    appointmentId: appointment.id,
  });

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staffId,
    staffId,
    action: 'APPOINTMENT_STAFF_CHECKED_IN',
    entityType: 'Appointment',
    entityId: appointment.id,
    metadata: { checkInId: result.checkIn.id },
  });

  return result;
}
