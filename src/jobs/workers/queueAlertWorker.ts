import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { logger } from '../../utils/logger';
import { QueueAlertJobData } from '../queue';
import { sendNearlyNextSms } from '../../services/queueStatusService';

/** Once a minute: "you're nearly next" SMS to waiting patients (services/queueStatusService.ts). */
export function startQueueAlertWorker(): Worker<QueueAlertJobData> {
  return new Worker<QueueAlertJobData>(
    'queue-alerts',
    async () => {
      const result = await sendNearlyNextSms();
      if (result.sent + result.skipped > 0) logger.info(result, 'Nearly-next SMS sweep');
    },
    { connection: redisQueueConnection },
  );
}
