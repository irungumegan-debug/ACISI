import crypto from 'node:crypto';
import { redis } from '../config/redis';
import { DASHBOARD_SESSION_TTL_SECONDS } from '../config/constants';
import { logger } from '../utils/logger';

const SESSION_KEY_PREFIX = 'dashboard:session:';

/** Name of the httpOnly cookie carrying the opaque session token. */
export const SESSION_COOKIE_NAME = 'acisi_staff_session';

export interface DashboardSession {
  staffId: string;
  staffName: string;
  clinicId: string;
  clinicName: string;
}

function key(token: string): string {
  return `${SESSION_KEY_PREFIX}${token}`;
}

/**
 * Opaque token, not a JWT — same "server holds the truth, client just holds
 * a lookup key" pattern as the USSD session store (src/ussd/session.ts).
 * No signing/verification complexity needed, and revocation is a single
 * Redis delete.
 */
export async function createDashboardSession(session: DashboardSession): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(key(token), JSON.stringify(session), 'EX', DASHBOARD_SESSION_TTL_SECONDS);
  return token;
}

export async function loadDashboardSession(token: string): Promise<DashboardSession | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DashboardSession;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse cached dashboard session; treating as invalid');
    return null;
  }
}

export async function destroyDashboardSession(token: string): Promise<void> {
  await redis.del(key(token));
}
