import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { queryCheckInPayment, sweepPendingCheckInPayments } from '../../services/checkInService';
import { StkStatusCheckJobData } from '../queue';

/**
 * Safety net for callback delivery failures: once a minute (scheduled by
 * scheduleCheckInPaymentSweep), asks Safaricom about every check-in still
 * PENDING_PAYMENT 1–60 minutes after its STK push, and moves any still
 * unresolved after 60 minutes to NEEDS_REVIEW for front desk. Without this,
 * a dropped callback would leave a CheckIn stuck PENDING_PAYMENT forever
 * even though the patient paid.
 */
export function startStkStatusWorker(): Worker<StkStatusCheckJobData> {
  return new Worker<StkStatusCheckJobData>(
    'stk-status-check',
    async (job) => {
      // A per-check-in job left in Redis by the previous version.
      if (job.data.checkInId) {
        await queryCheckInPayment(job.data.checkInId);
        return;
      }
      await sweepPendingCheckInPayments();
    },
    { connection: redisQueueConnection },
  );
}
