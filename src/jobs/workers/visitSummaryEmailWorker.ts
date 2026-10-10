import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { prisma } from '../../db/prisma';
import { emailClient, emailConfigured, emailFromHeader } from '../../config/email';
import { buildVisitRecordDataFromEncounter, renderVisitRecordPdf } from '../../services/visitRecordDocument';
import { logger } from '../../utils/logger';
import { VisitSummaryEmailJobData } from '../queue';

/**
 * Separate worker from smsReceiptWorker/visitSummarySmsWorker by design —
 * only ever enqueued when staff explicitly chose email delivery at
 * checkout and the patient had an email on file at that moment. Nothing
 * here can affect the SMS summary, which is sent by a completely
 * independent job regardless of this one's outcome.
 */
export function startVisitSummaryEmailWorker(): Worker<VisitSummaryEmailJobData> {
  return new Worker<VisitSummaryEmailJobData>(
    'visit-summary-email',
    async (job) => {
      if (!emailConfigured || !emailClient) {
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary email job skipped — email delivery is not configured');
        return;
      }

      const encounter = await prisma.encounter.findUnique({
        where: { id: job.data.encounterId },
        include: {
          patient: true,
          clinic: true,
          checkIn: { include: { department: true } },
          consultedByStaff: true,
        },
      });

      if (!encounter) {
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary email job for missing Encounter, skipping');
        return;
      }

      if (!encounter.patient.email) {
        // The checkout route only enqueues this when the patient has an
        // email on file — reaching here without one would mean it changed
        // between then and now (or a stale/duplicate job). Either way,
        // there's nowhere to send this, so skip rather than error.
        logger.warn({ encounterId: job.data.encounterId }, 'Visit summary email job for a patient with no email on file, skipping');
        return;
      }

      const pdf = await renderVisitRecordPdf(buildVisitRecordDataFromEncounter(encounter));
      const dateStamp = encounter.createdAt.toISOString().slice(0, 10);

      const result = await emailClient.emails.send({
        from: emailFromHeader,
        to: [encounter.patient.email],
        subject: `Your visit summary from ${encounter.clinic.name}`,
        text: `Hi ${encounter.patient.firstName},\n\nAttached is your visit summary and prescription from ${encounter.clinic.name}. Thank you for visiting.\n\n— ACISI`,
        attachments: [{ filename: `ACISI-visit-${dateStamp}.pdf`, content: pdf }],
      });

      if (result.error) {
        throw new Error(`Resend rejected the visit summary email: ${result.error.message}`);
      }
    },
    { connection: redisQueueConnection },
  );
}
