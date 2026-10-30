import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { logger } from '../../utils/logger';
import { MaintenanceJobData } from '../queue';
import { sendDueAppointmentReminders } from '../../services/appointmentReminderService';
import { deleteExpiredPendingSignups } from '../../services/pendingSignupService';

/**
 * Hourly housekeeping (scheduled by scheduleHourlyMaintenance). Each task
 * runs on its own: one failing never stops the others.
 */
export const MAINTENANCE_TASKS: { name: string; run: () => Promise<unknown> }[] = [
  { name: 'appointment-reminders', run: () => sendDueAppointmentReminders() },
  { name: 'expired-pending-signups', run: () => deleteExpiredPendingSignups() },
];

export async function runMaintenance(): Promise<void> {
  for (const task of MAINTENANCE_TASKS) {
    try {
      const result = await task.run();
      logger.info({ task: task.name, result }, 'Maintenance task done');
    } catch (err) {
      logger.error({ err, task: task.name }, 'Maintenance task failed');
    }
  }
}

export function startMaintenanceWorker(): Worker<MaintenanceJobData> {
  return new Worker<MaintenanceJobData>('maintenance', () => runMaintenance(), { connection: redisQueueConnection });
}
