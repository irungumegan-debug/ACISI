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
 * Only enqueued when staff explicitly chose email delivery at checkout AND
 * the patient has an email on file — a completely separate queue/worker
 * from every SMS.
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

/** The hourly housekeeping job carries no data. */
export type MaintenanceJobData = Record<string, never>;

/** Hourly housekeeping: appointment reminders, expired pending signups, unpaid-fee notices (see maintenanceWorker). */
export const maintenanceQueue = new Queue<MaintenanceJobData>('maintenance', {
  connection: redisQueueConnection,
});

/**
 * Starts (or keeps — an idempotent upsert, safe on every boot) the hourly
 * housekeeping run, on the hour in Kenya time, so the 09:00 appointment
 * reminders go out at 09:00.
 */
export async function scheduleHourlyMaintenance(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler('hourly-maintenance', { pattern: '0 * * * *', tz: 'Africa/Nairobi' }, { name: 'hourly', data: {} });
}
