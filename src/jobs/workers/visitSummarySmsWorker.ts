import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { smsClient } from '../../config/africastalking';
import { logger } from '../../utils/logger';
import { VisitSummarySmsJobData } from '../queue';

export function startVisitSummarySmsWorker(): Worker<VisitSummarySmsJobData> {
  return new Worker<VisitSummarySmsJobData>(
    'visit-summary-sms',
    async (job) => {
      const encounter = await prisma.encounter.findUnique({
        where: { id: job.data.encounterId },
        include: {
          patient: true,
          clinic: true,
          checkIn: { include: { department: true } },
        },
      });

      if (!encounter) {
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary SMS job for missing Encounter, skipping');
        return;
      }

      const message =
        `ACISI — ${encounter.clinic.name}\n` +
        `Visit: ${encounter.checkIn.department.name}\n` +
        `Prescription: ${encounter.prescription || 'None'}\n` +
        `Thank you for visiting.`;

      await smsClient.send({ to: [encounter.patient.phoneNumber], message });
    },
    { connection: redisQueueConnection },
  );
}
