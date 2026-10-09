import { Queue } from 'bullmq';
import { redisQueueConnection } from '../config/redis';

export interface SmsReceiptJobData {
  checkInId: string;
  patientId: string;
  succeeded: boolean;
}

/**
 * The once-a-minute sweep's job carries no data. Jobs queued by older
 * versions (one delayed check per STK push) carry a checkInId.
 */
export interface StkStatusCheckJobData {
  checkInId?: string;
}

export interface VisitSummarySmsJobData {
  encounterId: string;
}

export interface VisitSummaryEmailJobData {
  encounterId: string;
}

export const smsReceiptQueue = new Queue<SmsReceiptJobData>('sms-receipts', {
  connection: redisQueueConnection,
});

export const stkStatusCheckQueue = new Queue<StkStatusCheckJobData>('stk-status-check', {
  connection: redisQueueConnection,
});

export interface ClinicStkStatusCheckJobData {
  paymentId: string;
}

/** Checkout payments to the clinic's till — separate from ACISI's own stk-status-check queue. */
export const clinicStkStatusCheckQueue = new Queue<ClinicStkStatusCheckJobData>('clinic-stk-status-check', {
  connection: redisQueueConnection,
});

export const visitSummarySmsQueue = new Queue<VisitSummarySmsJobData>('visit-summary-sms', {
  connection: redisQueueConnection,
});

export const visitSummaryEmailQueue = new Queue<VisitSummaryEmailJobData>('visit-summary-email', {
  connection: redisQueueConnection,
});

export async function enqueueSmsReceipt(data: SmsReceiptJobData): Promise<void> {
  await smsReceiptQueue.add('send-receipt', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Sent only at front-desk checkout (encounterService.checkoutEncounter) —
 * distinct from enqueueSmsReceipt, which fires right after payment. This one
 * carries the doctor's diagnosis/prescription, so it can only go out once
 * the consultation is actually done.
 */
export async function enqueueVisitSummarySms(data: VisitSummarySmsJobData): Promise<void> {
  await visitSummarySmsQueue.add('send-visit-summary', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Only enqueued when staff explicitly chose email delivery at checkout AND
 * the patient has an email on file — a completely separate queue/worker
 * from enqueueVisitSummarySms above, so nothing about this path (including
 * it failing) can ever affect the SMS summary, which fires unconditionally
 * regardless of this.
 */
export async function enqueueVisitSummaryEmail(data: VisitSummaryEmailJobData): Promise<void> {
  await visitSummaryEmailQueue.add('send-visit-summary-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Starts (or keeps — it's an idempotent upsert, safe on every boot) the
 * once-a-minute sweep that asks Safaricom about check-in fees still awaiting
 * M-Pesa, and hands the ones unresolved after an hour to staff — see
 * jobs/workers/stkStatusWorker.ts and checkInService.sweepPendingCheckInPayments.
 */
export async function scheduleCheckInPaymentSweep(): Promise<void> {
  await stkStatusCheckQueue.upsertJobScheduler('check-in-payment-sweep', { every: 60_000 }, { name: 'sweep', data: {} });
}

/**
 * Safety net for a clinic checkout STK push: if Daraja's callback hasn't
 * resolved the payment within ~90s, ask Daraja directly, and mark it timed
 * out if there's still no answer (see clinicStkStatusWorker).
 */
export async function scheduleClinicStkStatusCheck(data: ClinicStkStatusCheckJobData): Promise<void> {
  await clinicStkStatusCheckQueue.add('check-clinic-stk', data, { delay: 90_000, attempts: 2, backoff: { type: 'fixed', delay: 15_000 } });
}
