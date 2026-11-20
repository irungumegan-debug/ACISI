import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { sendVisitToShr } from '../../hie/shrService';
import { HieShrSendJobData } from '../queue';

/** Sends a finished visit to DHA's Shared Health Record; BullMQ retries on failure. */
export function startHieShrWorker(): Worker<HieShrSendJobData> {
  return new Worker<HieShrSendJobData>(
    'hie-shr-send',
    async (job) => {
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;
      await sendVisitToShr(job.data.encounterId, attempt, attempt >= maxAttempts);
    },
    { connection: redisQueueConnection },
  );
}
