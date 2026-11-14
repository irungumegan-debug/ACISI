/**
 * Finished jobs must not pile up in Redis: the once-a-minute payment sweep
 * filled the 64 MB cap with ~45,000 finished jobs (13 Nov 2026).
 */
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation((name: string, opts: unknown) => ({ name, opts, upsertJobScheduler: jest.fn(), add: jest.fn() })),
}));
jest.mock('../../src/config/redis', () => ({ redisQueueConnection: {} }));

import * as queues from '../../src/jobs/queue';

const all = [queues.smsReceiptQueue, queues.stkStatusCheckQueue, queues.clinicStkStatusCheckQueue, queues.visitSummaryEmailQueue, queues.maintenanceQueue] as unknown as {
  name: string;
  opts: { defaultJobOptions: unknown };
  upsertJobScheduler: jest.Mock;
}[];

it('every queue keeps only a bounded number of finished jobs', () => {
  for (const q of all) expect(q.opts.defaultJobOptions).toEqual(queues.JOB_RETENTION);
  expect(queues.JOB_RETENTION.removeOnComplete.count).toBeLessThanOrEqual(500);
  expect(queues.JOB_RETENTION.removeOnFail.count).toBeLessThanOrEqual(5000);
});

it('the repeating jobs (payment sweep, hourly housekeeping) carry the same limits', async () => {
  await queues.scheduleCheckInPaymentSweep();
  await queues.scheduleHourlyMaintenance();
  const sweep = (queues.stkStatusCheckQueue as unknown as { upsertJobScheduler: jest.Mock }).upsertJobScheduler.mock.calls[0];
  const hourly = (queues.maintenanceQueue as unknown as { upsertJobScheduler: jest.Mock }).upsertJobScheduler.mock.calls[0];
  expect(sweep[2].opts).toEqual(queues.JOB_RETENTION);
  expect(hourly[2].opts).toEqual(queues.JOB_RETENTION);
});
