import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { sendPatientSms } from '../../services/smsService';
import { logger } from '../../utils/logger';
import { SmsReceiptJobData } from '../queue';

export function startSmsReceiptWorker(): Worker<SmsReceiptJobData> {
  return new Worker<SmsReceiptJobData>(
    'sms-receipts',
    async (job) => {
      const checkIn = await prisma.checkIn.findUnique({
        where: { id: job.data.checkInId },
        include: { patient: true, clinic: true },
      });

      if (!checkIn) {
        logger.warn({ checkInId: job.data.checkInId }, 'SMS receipt job for missing CheckIn, skipping');
        return;
      }

      if (checkIn.patient.deletedAt) {
        logger.info({ checkInId: job.data.checkInId }, 'SMS receipt job for a deleted patient account, skipping');
        return;
      }

      const message = job.data.succeeded
        ? `ACISI: Check-in confirmed at ${checkIn.clinic.name}. Payment of KES ${checkIn.amountKes} received. Thank you.`
        : `ACISI: Your check-in payment at ${checkIn.clinic.name} was not completed. Please try again at reception.`;

      // Not essential: respects "does not want SMS" (C13).
      const outcome = await sendPatientSms(checkIn.patient, message, { purpose: 'CHECK_IN_FEE_RECEIPT' });
      if (outcome === 'opted_out') {
        logger.info({ checkInId: job.data.checkInId }, 'Check-in fee SMS skipped: patient opted out of SMS');
      }
      // Throwing lets the queue retry (3 tries) when Africa's Talking fails.
      if (outcome === 'failed') throw new Error('Check-in fee SMS failed');
    },
    { connection: redisQueueConnection },
  );
}
