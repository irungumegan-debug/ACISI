import { redis } from '../config/redis';
import { PIN_LOCKOUT } from '../config/constants';

/**
 * Wrong-PIN lockout counted per ACCOUNT, not per typed text or per session,
 * so typing a phone number another way (0712…, +254 712…, the patient ID)
 * never buys more tries. One counter per account is shared by every place
 * that checks that account's PIN: web login, the doctor's signing PIN and
 * the delete-account PIN. Limits come from PIN_LOCKOUT only.
 *
 * Subjects: `patient:<id>`, `staff:<id>`, `owner:<email>`, and for an
 * identifier that matches no account, `unknown:<normalised identifier>`
 * (so probing for accounts is slowed down too).
 */
export type LockoutSubject = `patient:${string}` | `staff:${string}` | `owner:${string}` | `unknown:${string}`;

const failKey = (subject: LockoutSubject) => `lockout:fails:${subject}`;
const lockKey = (subject: LockoutSubject) => `lockout:locked:${subject}`;

/** "Too many wrong PINs. Try again in 5 minutes." — built from PIN_LOCKOUT. */
export function lockoutMessage(what: 'PINs' | 'passwords' = 'PINs'): string {
  const minutes: number = PIN_LOCKOUT.lockMinutes;
  return `Too many wrong ${what}. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export async function isLockedOut(subject: LockoutSubject): Promise<boolean> {
  return (await redis.get(lockKey(subject))) !== null;
}

/** Counts one wrong PIN; returns true when this one locked the account. */
export async function recordWrongPin(subject: LockoutSubject): Promise<boolean> {
  const count = await redis.incr(failKey(subject));
  if (count === 1) {
    await redis.expire(failKey(subject), PIN_LOCKOUT.windowMinutes * 60);
  }
  if (count >= PIN_LOCKOUT.maxAttempts) {
    await redis.set(lockKey(subject), '1', 'EX', PIN_LOCKOUT.lockMinutes * 60);
    await redis.del(failKey(subject));
    return true;
  }
  return false;
}

/** After a correct PIN or a successful PIN reset: the slate is clean and any lock is lifted. */
export async function clearLockout(subject: LockoutSubject): Promise<void> {
  await redis.del(failKey(subject));
  await redis.del(lockKey(subject));
}
