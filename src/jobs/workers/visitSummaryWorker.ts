import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { smsClient } from '../../config/africastalking';
import { logger } from '../../utils/logger';
import { VisitSummarySmsJobData } from '../queue';

/**
 * Sends the checkout SMS — visit date, department, prescription, notes —
 * once staff complete a consultation (consultationService.completeConsultation).
 * Separate job/worker from smsReceiptWorker.ts: that one confirms payment at
 * check-in, this one summarizes the visit at checkout — different message,
 * different trigger point.
 */
export function startVisitSummaryWorker(): Worker<VisitSummarySmsJobData> {
  return new Worker<VisitSummarySmsJobData>(
    'visit-summary-sms',
    async (job) => {
      const encounter = await prisma.encounter.findUnique({
        where: { id: job.data.encounterId },
        include: { patient: true, clinic: true, checkIn: { include: { department: true } } },
      });

      if (!encounter) {
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary SMS job for missing Encounter, skipping');
        return;
      }

      const visitDate = (encounter.completedAt ?? encounter.createdAt).toLocaleDateString('en-GB');
      const departmentName = encounter.checkIn.department?.name ?? 'General';

      const parts = [
        `ACISI visit summary — ${encounter.clinic.name} (${departmentName}), ${visitDate}.`,
        encounter.prescription ? `Prescription: ${encounter.prescription}.` : 'No prescription issued.',
      ];
      if (encounter.notes) {
        parts.push(`Notes: ${encounter.notes}.`);
      }
      parts.push('Thank you for visiting ACISI.');

      await smsClient.send({ to: [encounter.patient.phoneNumber], message: parts.join(' ') });
    },
    { connection: redisQueueConnection },
  );
}
