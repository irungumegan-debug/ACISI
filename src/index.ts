import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { ensureOwnerFromEnv } from './services/ownerService';
import { startSmsReceiptWorker } from './jobs/workers/smsReceiptWorker';
import { startStkStatusWorker } from './jobs/workers/stkStatusWorker';
import { startVisitSummaryEmailWorker } from './jobs/workers/visitSummaryEmailWorker';
import { startHieShrWorker } from './jobs/workers/hieShrWorker';
import { startClinicStkStatusWorker } from './jobs/workers/clinicStkStatusWorker';
import { scheduleCheckInPaymentSweep, scheduleHourlyMaintenance, scheduleQueueAlertSweep } from './jobs/queue';
import { startQueueAlertWorker } from './jobs/workers/queueAlertWorker';
import { startMaintenanceWorker } from './jobs/workers/maintenanceWorker';

const app = createApp();
const smsWorker = startSmsReceiptWorker();
const stkStatusWorker = startStkStatusWorker();
const visitSummaryEmailWorker = startVisitSummaryEmailWorker();
const clinicStkStatusWorker = startClinicStkStatusWorker();
const maintenanceWorker = startMaintenanceWorker();
const queueAlertWorker = startQueueAlertWorker();
const hieShrWorker = startHieShrWorker();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'ACISI server listening');
});

scheduleCheckInPaymentSweep().catch((err) => logger.error({ err }, 'Could not schedule the check-in payment sweep'));
scheduleHourlyMaintenance().catch((err) => logger.error({ err }, 'Could not schedule hourly maintenance'));
scheduleQueueAlertSweep().catch((err) => logger.error({ err }, 'Could not schedule the nearly-next SMS sweep'));

void ensureOwnerFromEnv({ email: env.OWNER_EMAIL, name: env.OWNER_NAME, password: env.OWNER_PASSWORD });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await Promise.all([smsWorker.close(), stkStatusWorker.close(), visitSummaryEmailWorker.close(), clinicStkStatusWorker.close(), maintenanceWorker.close(), queueAlertWorker.close(), hieShrWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
