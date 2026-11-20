import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { encryptValue, decryptValue } from '../utils/fieldCrypto';
import { generateTotpSecret, matchTotp, otpauthUrl } from '../utils/totp';
import { recordAuditEvent } from './auditService';
import { isSessionRevoked, revokeSessionsFor } from './sessionRevocation';
import { clearLockout, isLockedOut, lockoutMessage, recordWrongPin } from './pinLockout';
import { sendSms } from './smsService';

/**
 * Multi-factor login for the roles that can see or manage the most (clinic
 * admins and doctors). After the right staff ID and PIN they also enter a
 * 6-digit code:
 *
 * - **Authenticator app** (the default): Google Authenticator, Microsoft
 *   Authenticator or similar. Set up at the first login after MFA is
 *   switched on, by scanning a QR code and typing the first code. Needs no
 *   SMS or internet on the phone.
 * - **SMS code**: only when STAFF_MFA_SMS_ENABLED=true (real SMS delivery)
 *   and the person hasn't set up an app.
 *
 * A device can be remembered for 30 days; a PIN reset or deactivation
 * forgets every remembered device. A lost phone: the clinic admin resets
 * the person's authenticator and they set it up again at the next login.
 * SMS codes and device tokens are stored only as SHA-256 hashes; app
 * secrets are encrypted at rest (AES-256-GCM) in the database and in Redis.
 * Wrong codes lock the account for a few minutes (counted separately from
 * wrong PINs, so a correct PIN doesn't reset the count).
 */

export const MFA_ROLES: readonly string[] = ['ADMIN', 'DOCTOR'];
export const MFA_CODE_TTL_SECONDS = 5 * 60;
export const MFA_SETUP_TTL_SECONDS = 10 * 60;
export const MFA_MAX_ATTEMPTS = 5;
export const TRUSTED_DEVICE_DAYS = 30;
export const TRUSTED_DEVICE_COOKIE = 'acisi_staff_device';

export type MfaMethod = 'authenticator' | 'setup' | 'sms';

/** True for admins and doctors once STAFF_MFA_ENABLED=true (see config/env.ts). */
export function mfaRequiredFor(role: string): boolean {
  return env.STAFF_MFA_ENABLED && MFA_ROLES.includes(role);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const challengeKey = (id: string) => `mfa:challenge:${id}`;
const deviceKey = (token: string) => `mfa:trusted:${sha256(token)}`;
/** Last time step accepted per person, so an app code can't be used twice. */
const lastStepKey = (staffId: string) => `mfa:totp:last:${staffId}`;
const codeLockout = (staffId: string) => `mfa:staff:${staffId}` as const;

interface Challenge {
  staffId: string;
  staffCode: string;
  clinicId: string;
  method: MfaMethod;
  /** sms: hash of the code sent. */
  codeHash?: string;
  /** authenticator / setup: the app secret, encrypted. */
  secret?: string;
  attempts: number;
}

export class MfaError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 429 | 502,
  ) {
    super(message);
    this.name = 'MfaError';
  }
}

/** "+254712345678" -> "••• 678". */
export function phoneHint(phone: string): string {
  return `••• ${phone.slice(-3)}`;
}

export interface LoginChallengeResponse {
  mfaRequired: true;
  challengeId: string;
  method: MfaMethod;
  /** sms only. */
  phoneHint?: string;
  /** setup only: what the app needs. */
  setup?: { qrCodeSvg: string; secret: string; accountName: string };
}

interface StaffForMfa {
  id: string;
  staffCode: string;
  phoneNumber: string;
  clinicId: string;
  totpSecret?: string | null;
}

async function saveChallenge(id: string, challenge: Challenge, ttl: number): Promise<void> {
  await redis.set(challengeKey(id), JSON.stringify(challenge), 'EX', ttl);
}

/** Starts the second step of the login and says which kind of code to ask for. */
export async function startLoginChallenge(staff: StaffForMfa): Promise<LoginChallengeResponse> {
  if (await isLockedOut(codeLockout(staff.id))) throw new MfaError(lockoutMessage('codes'), 429);
  const challengeId = crypto.randomBytes(24).toString('hex');
  const base = { staffId: staff.id, staffCode: staff.staffCode, clinicId: staff.clinicId, attempts: 0 };

  if (staff.totpSecret) {
    await saveChallenge(challengeId, { ...base, method: 'authenticator', secret: encryptValue(staff.totpSecret) }, MFA_CODE_TTL_SECONDS);
    return { mfaRequired: true, challengeId, method: 'authenticator' };
  }

  if (env.STAFF_MFA_SMS_ENABLED) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await saveChallenge(challengeId, { ...base, method: 'sms', codeHash: sha256(`${challengeId}:${code}`) }, MFA_CODE_TTL_SECONDS);
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
    return { mfaRequired: true, challengeId, method: 'sms', phoneHint: phoneHint(staff.phoneNumber) };
  }

  // No app yet: set one up now. The secret is saved only once the first code checks out.
  const secret = generateTotpSecret();
  await saveChallenge(challengeId, { ...base, method: 'setup', secret: encryptValue(secret) }, MFA_SETUP_TTL_SECONDS);
  const qrCodeSvg = await QRCode.toString(otpauthUrl(secret, staff.staffCode), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { mfaRequired: true, challengeId, method: 'setup', setup: { qrCodeSvg, secret: secret.replace(/(.{4})/g, '$1 ').trim(), accountName: staff.staffCode } };
}

async function checkAppCode(challenge: Challenge, code: string): Promise<boolean> {
  const step = matchTotp(decryptValue(challenge.secret!), code);
  if (step === null) return false;
  const last = Number((await redis.get(lastStepKey(challenge.staffId))) ?? -1);
  if (step <= last) return false; // already used
  await redis.set(lastStepKey(challenge.staffId), String(step), 'EX', 10 * 60);
  return true;
}

/**
 * Checks a login code. Returns the staff ID and code on success (the
 * challenge is then used up). A wrong code counts an attempt on this
 * challenge and on the account's code lockout; after MFA_MAX_ATTEMPTS the
 * challenge stops working and the person starts again with their PIN.
 */
export async function verifyLoginCode(challengeId: string, code: string): Promise<{ staffId: string; staffCode: string; method: MfaMethod }> {
  const raw = await redis.get(challengeKey(challengeId));
  if (!raw) throw new MfaError('That code has expired. Log in again to get a new one.', 401);
  const challenge = JSON.parse(raw) as Challenge;
  if (await isLockedOut(codeLockout(challenge.staffId))) {
    await redis.del(challengeKey(challengeId));
    throw new MfaError(lockoutMessage('codes'), 429);
  }

  let ok: boolean;
  if (challenge.method === 'sms') {
    const given = Buffer.from(sha256(`${challengeId}:${code.trim()}`));
    const expected = Buffer.from(challenge.codeHash ?? '');
    ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  } else {
    ok = await checkAppCode(challenge, code);
  }

  if (ok) {
    await redis.del(challengeKey(challengeId));
    await clearLockout(codeLockout(challenge.staffId));
    if (challenge.method === 'setup') {
      await prisma.staff.update({ where: { id: challenge.staffId }, data: { totpSecret: decryptValue(challenge.secret!), totpEnabledAt: new Date() } });
      await recordAuditEvent({
        actorType: 'STAFF',
        actorId: challenge.staffId,
        staffId: challenge.staffId,
        clinicId: challenge.clinicId,
        action: 'STAFF_AUTHENTICATOR_SET_UP',
        entityType: 'Staff',
        entityId: challenge.staffId,
      });
    }
    return { staffId: challenge.staffId, staffCode: challenge.staffCode, method: challenge.method };
  }

  await recordAuditEvent({
    actorType: 'STAFF',
    actorId: challenge.staffId,
    staffId: challenge.staffId,
    clinicId: challenge.clinicId,
    action: 'STAFF_LOGIN_CODE_WRONG',
    entityType: 'Staff',
    entityId: challenge.staffId,
    metadata: { method: challenge.method },
  });
  const locked = await recordWrongPin(codeLockout(challenge.staffId));
  challenge.attempts += 1;
  if (locked || challenge.attempts >= MFA_MAX_ATTEMPTS) {
    await redis.del(challengeKey(challengeId));
    throw new MfaError(locked ? lockoutMessage('codes') : 'Too many wrong codes. Log in again to get a new one.', locked ? 429 : 401);
  }
  await saveChallenge(challengeId, challenge, challenge.method === 'setup' ? MFA_SETUP_TTL_SECONDS : MFA_CODE_TTL_SECONDS);
  throw new MfaError(challenge.method === 'sms' ? 'Wrong code. Check the SMS and try again.' : 'Wrong code. Check the app and try again (use the newest code).', 401);
}

/**
 * Forgets a staff member's authenticator app (lost or changed phone) and
 * every remembered device; they set the app up again at their next login.
 * Callers check who may do this and record their own audit event.
 */
export async function resetAuthenticator(staffId: string): Promise<void> {
  await prisma.staff.update({ where: { id: staffId }, data: { totpSecret: null, totpEnabledAt: null } });
  await redis.del(lastStepKey(staffId));
  // Same marker as a PIN reset: logs them out and forgets remembered devices.
  await revokeSessionsFor(`staff:${staffId}`);
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
