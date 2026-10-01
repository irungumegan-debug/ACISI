import crypto from 'node:crypto';
import { redis } from '../config/redis';
import { OWNER_SESSION_TTL_SECONDS } from '../config/constants';
import { logger } from '../utils/logger';
import { isSessionRevoked } from '../services/sessionRevocation';

const SESSION_KEY_PREFIX = 'owner:session:';

/** Name of the httpOnly cookie carrying the owner site's opaque session token. */
export const OWNER_SESSION_COOKIE_NAME = 'acisi_owner_session';

export interface OwnerSession {
  ownerId: string;
  email: string;
  name: string;
  /** Epoch ms the session was created — see DashboardSession.issuedAt. */
  issuedAt?: number;
}

function key(token: string): string {
  return `${SESSION_KEY_PREFIX}${token}`;
}

/** Same opaque-token-in-Redis pattern as the staff dashboard session (src/dashboard/session.ts). */
export async function createOwnerSession(session: OwnerSession): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(key(token), JSON.stringify({ ...session, issuedAt: Date.now() }), 'EX', OWNER_SESSION_TTL_SECONDS);
  return token;
}

export async function loadOwnerSession(token: string): Promise<OwnerSession | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  let session: OwnerSession;
  try {
    session = JSON.parse(raw) as OwnerSession;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse cached owner session; treating as invalid');
    return null;
  }
  // Revoked by scripts/createOwner.ts whenever the password is reset.
  if (await isSessionRevoked([`owner:${session.ownerId}`], session.issuedAt)) {
    await redis.del(key(token));
    return null;
  }
  return session;
}

export async function destroyOwnerSession(token: string): Promise<void> {
  await redis.del(key(token));
}
