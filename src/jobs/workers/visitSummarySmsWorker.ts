import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { sendPatientSms } from '../../services/smsService';
import { logger } from '../../utils/logger';
import { formatKenyaDate } from '../../utils/kenyaTime';
import { buildVisitSummarySms } from '../../services/smsTemplates';
import { VisitSummarySmsJobData } from '../queue';

export function startVisitSummarySmsWorker(): Worker<VisitSummarySmsJobData> {
  return new Worker<VisitSummarySmsJobData>(
    'visit-summary-sms',
    async (job) => {
      const encounter = await prisma.encounter.findUnique({
        where: { id: job.data.encounterId },
        include: { patient: true, clinic: true },
      });

      if (!encounter) {
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary SMS job for missing Encounter, skipping');
        return;
      }

      if (encounter.patient.deletedAt) {
        logger.info({ encounterId: job.data.encounterId }, 'Visit summary SMS job for a deleted patient account, skipping');
        return;
      }

      // "Patient does not want SMS" (set by front desk) — no visit summary either.
      if (encounter.patient.smsOptOut) {
        logger.info({ encounterId: job.data.encounterId }, 'Visit summary SMS skipped: patient opted out of SMS');
        return;
      }

      // Never includes the diagnosis — see buildVisitSummarySms.
      const message = buildVisitSummarySms({
        clinicName: encounter.clinic.name,
        date: formatKenyaDate(encounter.createdAt),
        prescription: encounter.prescription,
      });

      const outcome = await sendPatientSms(encounter.patient, message, { purpose: 'VISIT_SUMMARY' });
      // Throwing lets the queue retry (3 tries) when Africa's Talking fails.
      if (outcome === 'failed') throw new Error('Visit summary SMS failed');
    },
    { connection: redisQueueConnection },
  );
}
