import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { smsClient } from '../../config/africastalking';
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

      const message = job.data.succeeded
        ? `ACISI: Check-in confirmed at ${checkIn.clinic.name}. Payment of KES ${checkIn.amountKes} received. Thank you.`
        : `ACISI: Your check-in payment at ${checkIn.clinic.name} was not completed. Please try again at reception.`;

      await smsClient.send({ to: [checkIn.patient.phoneNumber], message });
    },
    { connection: redisQueueConnection },
  );
}
