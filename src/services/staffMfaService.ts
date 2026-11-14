import crypto from 'node:crypto';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { recordAuditEvent } from './auditService';
import { isSessionRevoked } from './sessionRevocation';
import { sendSms } from './smsService';

/**
 * Multi-factor login for the roles that can see or manage the most (clinic
 * admins and doctors): after the right staff ID and PIN, a 6-digit code is
 * sent by SMS to the staff member's own phone. A device can be remembered
 * for 30 days so the code isn't needed at every login; a PIN reset or
 * deactivation forgets every remembered device (same revocation markers as
 * sessions). Codes and device tokens are stored only as SHA-256 hashes.
 */

export const MFA_ROLES: readonly string[] = ['ADMIN', 'DOCTOR'];
export const MFA_CODE_TTL_SECONDS = 5 * 60;
export const MFA_MAX_ATTEMPTS = 5;
export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_COOKIE = 'acisi_staff_device';

/** True for admins and doctors once STAFF_MFA_ENABLED=true (see config/env.ts). */
export function mfaRequiredFor(role: string): boolean {
  return env.STAFF_MFA_ENABLED && MFA_ROLES.includes(role);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const challengeKey = (id: string) => `mfa:challenge:${id}`;
const deviceKey = (token: string) => `mfa:trusted:${sha256(token)}`;

interface Challenge {
  staffId: string;
  staffCode: string;
  codeHash: string;
  attempts: number;
}

export class MfaError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 502,
  ) {
    super(message);
    this.name = 'MfaError';
  }
}

/** "+254712345678" -> "••• 678". */
export function phoneHint(phone: string): string {
  return `••• ${phone.slice(-3)}`;
}

/** Sends a login code to the staff member's phone. Returns the challenge ID the browser sends back with the code. */
export async function startLoginChallenge(staff: { id: string; staffCode: string; phoneNumber: string; clinicId: string }): Promise<string> {
  const challengeId = crypto.randomBytes(24).toString('hex');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const challenge: Challenge = { staffId: staff.id, staffCode: staff.staffCode, codeHash: sha256(`${challengeId}:${code}`), attempts: 0 };
  await redis.set(challengeKey(challengeId), JSON.stringify(challenge), 'EX', MFA_CODE_TTL_SECONDS);

  const sent = await sendSms(staff.phoneNumber, `ACISI: Your login code is ${code}. It expires in 5 minutes. Never share it with anyone.`, 'STAFF_LOGIN_CODE');
  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: staff.id,
    staffId: staff.id,
    clinicId: staff.clinicId,
    action: sent === 'sent' ? 'STAFF_LOGIN_CODE_SENT' : 'STAFF_LOGIN_CODE_SMS_FAILED',
    entityType: 'Staff',
    entityId: staff.id,
  });
  if (sent !== 'sent') {
    await redis.del(challengeKey(challengeId));
    throw new MfaError("We couldn't send your login code by SMS. Please try again in a minute.", 502);
  }
  return challengeId;
}

/**
 * Checks a login code. Returns the staff ID and code on success (the code is
 * then used up). A wrong code counts an attempt; after MFA_MAX_ATTEMPTS the
 * code stops working and the person starts again with their PIN.
 */
export async function verifyLoginCode(challengeId: string, code: string): Promise<{ staffId: string; staffCode: string }> {
  const raw = await redis.get(challengeKey(challengeId));
  if (!raw) throw new MfaError('That code has expired. Log in again to get a new one.', 401);
  const challenge = JSON.parse(raw) as Challenge;
  const given = Buffer.from(sha256(`${challengeId}:${code.trim()}`));
  const expected = Buffer.from(challenge.codeHash);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
    await redis.del(challengeKey(challengeId));
    return { staffId: challenge.staffId, staffCode: challenge.staffCode };
  }
  challenge.attempts += 1;
  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    await redis.del(challengeKey(challengeId));
    throw new MfaError('Too many wrong codes. Log in again to get a new one.', 401);
  }
  await redis.set(challengeKey(challengeId), JSON.stringify(challenge), 'EX', MFA_CODE_TTL_SECONDS);
  throw new MfaError('Wrong code. Check the SMS and try again.', 401);
}

/** Remembers this device for TRUSTED_DEVICE_DAYS. Returns the token for the cookie (stored only hashed). */
export async function rememberDevice(staffId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(deviceKey(token), JSON.stringify({ staffId, issuedAt: Date.now() }), 'EX', TRUSTED_DEVICE_DAYS * 24 * 60 * 60);
  return token;
}

/** True when this browser was remembered for this staff member and nothing (PIN reset, deactivation) has revoked it since. */
export async function isTrustedDevice(staffId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const raw = await redis.get(deviceKey(token));
  if (!raw) return false;
  const device = JSON.parse(raw) as { staffId: string; issuedAt: number };
  if (device.staffId !== staffId) return false;
  if (await isSessionRevoked([`staff:${staffId}`], device.issuedAt)) {
    await redis.del(deviceKey(token));
    return false;
  }
  return true;
}
