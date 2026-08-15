import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startSmsReceiptWorker } from './jobs/workers/smsReceiptWorker';
import { startStkStatusWorker } from './jobs/workers/stkStatusWorker';

const app = createApp();
const smsWorker = startSmsReceiptWorker();
const stkStatusWorker = startStkStatusWorker();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'ACISI server listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await Promise.all([smsWorker.close(), stkStatusWorker.close()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
