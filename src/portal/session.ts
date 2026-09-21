import crypto from 'node:crypto';
import { redis } from '../config/redis';
import { DASHBOARD_SESSION_TTL_SECONDS } from '../config/constants';
import { logger } from '../utils/logger';

const SESSION_KEY_PREFIX = 'portal:session:';

/** Name of the httpOnly cookie carrying the patient portal's opaque session token. */
export const PATIENT_SESSION_COOKIE_NAME = 'acisi_patient_session';

export interface PatientSession {
  patientId: string;
  patientCode: string;
  firstName: string;
}

function key(token: string): string {
  return `${SESSION_KEY_PREFIX}${token}`;
}

/** Same opaque-token-in-Redis pattern as the staff dashboard session (src/dashboard/session.ts). */
export async function createPatientSession(session: PatientSession): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(key(token), JSON.stringify(session), 'EX', DASHBOARD_SESSION_TTL_SECONDS);
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
