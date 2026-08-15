import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { queryStkPushStatus } from '../../mpesa/verify';
import { applyPaymentResult } from '../../services/checkInService';
import { logger } from '../../utils/logger';
import { StkStatusCheckJobData } from '../queue';

// Daraja result codes for a completed STK query that indicate the payment
// did not go through (as opposed to "still awaiting user action").
const FAILURE_RESULT_CODES = new Set(['1', '1032', '1037', '2001']);

/**
 * Safety net for callback delivery failures: 90s after an STK push is
 * triggered, actively asks Daraja for the outcome if our callback route
 * still hasn't heard back. Without this, a dropped callback would leave a
 * CheckIn stuck PENDING_PAYMENT forever even though the patient paid.
 */
export function startStkStatusWorker(): Worker<StkStatusCheckJobData> {
  return new Worker<StkStatusCheckJobData>(
    'stk-status-check',
    async (job) => {
      const checkIn = await prisma.checkIn.findUnique({ where: { id: job.data.checkInId } });
      if (!checkIn || checkIn.status !== 'PENDING_PAYMENT') {
        return; // Callback already arrived and resolved it.
      }

      try {
        const result = await queryStkPushStatus(job.data.checkoutRequestId);

        if (result.resultCode === '0') {
          await applyPaymentResult(
            {
              merchantRequestId: result.merchantRequestId,
              checkoutRequestId: result.checkoutRequestId,
              resultCode: 0,
              resultDesc: result.resultDesc,
              amountKes: Number(checkIn.amountKes),
            },
            { source: 'stk-status-query', result },
          );
        } else if (FAILURE_RESULT_CODES.has(result.resultCode)) {
          await applyPaymentResult(
            {
              merchantRequestId: result.merchantRequestId,
              checkoutRequestId: result.checkoutRequestId,
              resultCode: Number(result.resultCode),
              resultDesc: result.resultDesc,
            },
            { source: 'stk-status-query', result },
          );
        } else {
          logger.info({ checkInId: checkIn.id, result }, 'STK push still pending after status check');
        }
      } catch (err) {
        logger.error({ err, checkInId: checkIn.id }, 'STK status query failed');
      }
    },
    { connection: redisQueueConnection },
  );
}
