import { redis } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { UssdSessionContext } from './types';

const SESSION_KEY_PREFIX = 'ussd:session:';

function key(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

export function createFreshSession(sessionId: string, phoneNumberE164: string): UssdSessionContext {
  const now = Date.now();
  return {
    sessionId,
    state: 'MAIN_MENU',
    phoneNumberE164,
    data: {},
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadSession(sessionId: string): Promise<UssdSessionContext | null> {
  const raw = await redis.get(key(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UssdSessionContext;
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to parse cached USSD session; treating as dropped');
    return null;
  }
}

export async function saveSession(session: UssdSessionContext): Promise<void> {
  session.updatedAt = Date.now();
  await redis.set(key(session.sessionId), JSON.stringify(session), 'EX', env.USSD_SESSION_TTL_SECONDS);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(key(sessionId));
}
