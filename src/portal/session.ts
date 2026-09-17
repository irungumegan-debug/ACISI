import crypto from 'node:crypto';
import { redis } from '../config/redis';
import { PATIENT_SESSION_TTL_SECONDS } from '../config/constants';
import { logger } from '../utils/logger';

const SESSION_KEY_PREFIX = 'portal:session:';

/** Name of the httpOnly cookie carrying the opaque patient session token. */
export const PATIENT_SESSION_COOKIE_NAME = 'acisi_patient_session';

export interface PatientSession {
  phoneNumberE164: string;
}

function key(token: string): string {
  return `${SESSION_KEY_PREFIX}${token}`;
}

/**
 * Same opaque-token-in-Redis pattern as the staff dashboard session
 * (src/dashboard/session.ts) and the USSD session store — server holds the
 * truth, the browser just holds a lookup key. Deliberately stores only the
 * phone number, not a patientId: a patient can OTP-verify before they have
 * any ACISI record at all (e.g. before their first check-in), so every
 * protected route re-resolves the Patient row by phone at request time.
 */
export async function createPatientSession(session: PatientSession): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(key(token), JSON.stringify(session), 'EX', PATIENT_SESSION_TTL_SECONDS);
  return token;
}

export async function loadPatientSession(token: string): Promise<PatientSession | null> {
  const raw = await redis.get(key(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PatientSession;
  } catch (err) {
    logger.warn({ err }, 'Failed to parse cached patient session; treating as invalid');
    return null;
  }
}

export async function destroyPatientSession(token: string): Promise<void> {
  await redis.del(key(token));
}
