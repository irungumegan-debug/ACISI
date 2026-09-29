import { Worker } from 'bullmq';
import { redisQueueConnection } from '../../config/redis';
import { resetAllDoctorPresence } from '../../services/staffService';

/**
 * Runs once a day at Nairobi midnight (the repeatable schedule is
 * registered by queue.ts's scheduleDoctorPresenceDailyReset) — flips any
 * doctor still showing IN back to OUT. See
 * staffService.resetAllDoctorPresence for why this exists even though the
 * presence read itself already treats a stale login as expired the next day.
 */
export function startDoctorPresenceResetWorker(): Worker {
  return new Worker(
    'doctor-presence-reset',
    async () => {
      await resetAllDoctorPresence();
    },
    { connection: redisQueueConnection },
  );
}
