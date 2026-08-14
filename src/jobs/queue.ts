import { Queue } from 'bullmq';
import { redisQueueConnection } from '../config/redis';

export interface SmsReceiptJobData {
  checkInId: string;
  patientId: string;
  succeeded: boolean;
}

export interface StkStatusCheckJobData {
  checkInId: string;
  checkoutRequestId: string;
}

export const smsReceiptQueue = new Queue<SmsReceiptJobData>('sms-receipts', {
  connection: redisQueueConnection,
});

export const stkStatusCheckQueue = new Queue<StkStatusCheckJobData>('stk-status-check', {
  connection: redisQueueConnection,
});

export async function enqueueSmsReceipt(data: SmsReceiptJobData): Promise<void> {
  await smsReceiptQueue.add('send-receipt', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

/**
 * Schedules a Daraja status query for a pending STK push. Used as a safety
 * net when the async callback never arrives (dropped delivery, network
 * partition) — see jobs/workers/stkStatusWorker.ts.
 */
export async function scheduleStkStatusCheck(data: StkStatusCheckJobData): Promise<void> {
  await stkStatusCheckQueue.add('check-status', data, {
    delay: 90_000,
    attempts: 1,
  });
}
