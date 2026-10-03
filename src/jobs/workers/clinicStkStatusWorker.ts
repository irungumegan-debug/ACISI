import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { queryClinicStkStatus } from '../../mpesa/clinicStk';
import { applyClinicStkResult, markStkTimedOut } from '../../services/billingService';
import { logger } from '../../utils/logger';
import { ClinicStkStatusCheckJobData } from '../queue';

/**
 * Safety net for clinic checkout STK pushes (separate from ACISI's own
 * stkStatusWorker): ~90s after the prompt, if Daraja's callback still hasn't
 * resolved the payment, ask Daraja directly. A definite answer is applied;
 * anything else means the patient never responded, so the payment is marked
 * timed out and staff can retry or enter the M-Pesa code by hand. (A late
 * success callback still upgrades it to paid — see applyClinicStkResult.)
 */
export function startClinicStkStatusWorker(): Worker<ClinicStkStatusCheckJobData> {
  return new Worker<ClinicStkStatusCheckJobData>(
    'clinic-stk-status-check',
    async (job) => {
      const payment = await prisma.payment.findUnique({ where: { id: job.data.paymentId } });
      if (!payment || payment.status !== 'PENDING' || !payment.mpesaCheckoutRequestId) return;

      try {
        const result = await queryClinicStkStatus(payment.mpesaCheckoutRequestId);
        const code = Number(result.resultCode);
        if (Number.isInteger(code) && (code === 0 || code === 1032 || code === 1037 || code === 1 || code === 2001)) {
          await applyClinicStkResult({ checkoutRequestId: payment.mpesaCheckoutRequestId, resultCode: code, resultDesc: result.resultDesc, rawPayload: { source: 'stk-status-query', result } });
          return;
        }
        await markStkTimedOut(payment.id);
      } catch (err) {
        logger.warn({ err, paymentId: payment.id }, 'Clinic STK status query failed; marking timed out');
        await markStkTimedOut(payment.id);
      }
    },
    { connection: redisQueueConnection },
  );
}
