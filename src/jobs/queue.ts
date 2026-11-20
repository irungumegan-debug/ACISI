import { Queue } from 'bullmq';
import { redisQueueConnection } from '../config/redis';

/**
 * How many finished jobs each queue keeps in Redis. Without this BullMQ keeps
 * every finished job forever: the once-a-minute payment sweep alone added
 * ~1,440 a day and filled Redis's 64 MB cap (13 Nov 2026), which stops logins
 * and the queue. Recent ones stay for troubleshooting; older ones are deleted
 * as new jobs finish (which also trims any backlog left from before).
 */
export const JOB_RETENTION = {
  removeOnComplete: { count: 200, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 1000, age: 30 * 24 * 60 * 60 },
} as const;

const queueOptions = { connection: redisQueueConnection, defaultJobOptions: JOB_RETENTION };

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

export const smsReceiptQueue = new Queue<SmsReceiptJobData>('sms-receipts', queueOptions);

export const stkStatusCheckQueue = new Queue<StkStatusCheckJobData>('stk-status-check', queueOptions);

export interface ClinicStkStatusCheckJobData {
  paymentId: string;
}

/** Checkout payments to the clinic's till — separate from ACISI's own stk-status-check queue. */
export const clinicStkStatusCheckQueue = new Queue<ClinicStkStatusCheckJobData>('clinic-stk-status-check', queueOptions);

export const visitSummaryEmailQueue = new Queue<VisitSummaryEmailJobData>('visit-summary-email', queueOptions);

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
export interface HieShrSendJobData {
  encounterId: string;
}

/** Sending finished visits to DHA's Shared Health Record (see hie/shrService.ts). */
export const hieShrSendQueue = new Queue<HieShrSendJobData>('hie-shr-send', queueOptions);

/** Retries with backoff (30 s, 1 min, 2 min, 4 min...) so a short DHA outage doesn't lose the visit. */
export async function enqueueHieShrSend(encounterId: string): Promise<void> {
  await hieShrSendQueue.add('send-visit', { encounterId }, { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, jobId: `shr-${encounterId}-${Date.now()}` });
}

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
  await stkStatusCheckQueue.upsertJobScheduler('check-in-payment-sweep', { every: 60_000 }, { name: 'sweep', data: {}, opts: JOB_RETENTION });
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
export const maintenanceQueue = new Queue<MaintenanceJobData>('maintenance', queueOptions);

/**
 * Starts (or keeps — an idempotent upsert, safe on every boot) the hourly
 * housekeeping run, on the hour in Kenya time, so the 09:00 appointment
 * reminders go out at 09:00.
 */
export async function scheduleHourlyMaintenance(): Promise<void> {
  await maintenanceQueue.upsertJobScheduler('hourly-maintenance', { pattern: '0 * * * *', tz: 'Africa/Nairobi' }, { name: 'hourly', data: {}, opts: JOB_RETENTION });
}

/** The once-a-minute "you're nearly next" sweep carries no data. */
export type QueueAlertJobData = Record<string, never>;

export const queueAlertQueue = new Queue<QueueAlertJobData>('queue-alerts', queueOptions);

/**
 * Starts (idempotent, safe on every boot) the once-a-minute sweep that sends
 * waiting patients a "you're nearly next" SMS (see jobs/workers/queueAlertWorker.ts).
 */
export async function scheduleQueueAlertSweep(): Promise<void> {
  await queueAlertQueue.upsertJobScheduler('nearly-next-sweep', { every: 60_000 }, { name: 'sweep', data: {}, opts: JOB_RETENTION });
}
