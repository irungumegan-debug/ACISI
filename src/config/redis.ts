import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

// lazyConnect defers the actual TCP connection until first use, so simply
// importing this module (e.g. transitively, via Jest auto-mocking another
// module) never dials Redis.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

// BullMQ requires a connection with maxRetriesPerRequest: null.
export const redisQueueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

for (const client of [redis, redisQueueConnection]) {
  client.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });
}
