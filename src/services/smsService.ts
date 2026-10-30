import { smsClient } from '../config/africastalking';
import { redis } from '../config/redis';
import { SMS_FAILURE_WARNING_THRESHOLD } from '../config/constants';
import { logger } from '../utils/logger';

/**
 * The one place ACISI sends an SMS. Every message goes through sendSms, so
 * Africa's Talking failures are counted in one place: after
 * SMS_FAILURE_WARNING_THRESHOLD failures in a row the owner page shows a
 * warning, and the next successful send clears it.
 *
 * Patient messages go through sendPatientSms, which applies "does not want
 * SMS" to everything that isn't essential. Essential means needed for the
 * account itself or asked for in person: PIN and phone codes, the
 * "Request records" code, the account-deletion confirmation.
 */

const FAILURES_KEY = 'sms:health:consecutive_failures';
const FAILING_SINCE_KEY = 'sms:health:failing_since';
const LAST_SUCCESS_KEY = 'sms:health:last_success_at';

export type SmsOutcome = 'sent' | 'failed' | 'opted_out' | 'deleted_account';

/**
 * Africa's Talking resolves even when it rejects a recipient (bad number,
 * no credit, blacklisted), reporting it per recipient instead. Treat the
 * send as failed unless a recipient was actually accepted.
 */
export function smsWasAccepted(response: unknown): boolean {
  const recipients = (response as { SMSMessageData?: { Recipients?: { status?: string; statusCode?: number }[] } })
    ?.SMSMessageData?.Recipients;
  if (!Array.isArray(recipients)) return true;
  return recipients.some((r) => r.status === 'Success' || (r.statusCode !== undefined && r.statusCode >= 100 && r.statusCode <= 102));
}

async function noteFailure(): Promise<void> {
  try {
    const count = await redis.incr(FAILURES_KEY);
    if (count === 1) await redis.set(FAILING_SINCE_KEY, new Date().toISOString());
  } catch {
    // Health tracking must never break sending.
  }
}

async function noteSuccess(): Promise<void> {
  try {
    await redis.del(FAILURES_KEY, FAILING_SINCE_KEY);
    await redis.set(LAST_SUCCESS_KEY, new Date().toISOString());
  } catch {
    // Health tracking must never break sending.
  }
}

/**
 * Sends one SMS. Never throws: returns 'sent' or 'failed' (failures are
 * counted for the owner warning and logged by purpose only, never the
 * number or the text).
 */
export async function sendSms(to: string, message: string, purpose: string): Promise<'sent' | 'failed'> {
  try {
    const response = await smsClient.send({ to: [to], message });
    if (!smsWasAccepted(response)) throw new Error('Recipient rejected by SMS provider');
    // Health tracking runs in the background: it never delays or breaks a send.
    void noteSuccess();
    return 'sent';
  } catch (err) {
    void noteFailure();
    logger.error({ err, purpose }, 'SMS send failed');
    return 'failed';
  }
}

export interface SmsPatient {
  phoneNumber: string;
  smsOptOut: boolean;
  deletedAt: Date | null;
}

/**
 * A message to a patient. Non-essential messages respect "does not want
 * SMS"; nothing at all goes to a deleted account.
 */
export async function sendPatientSms(
  patient: SmsPatient,
  message: string,
  options: { purpose: string; essential?: boolean },
): Promise<SmsOutcome> {
  if (patient.deletedAt) return 'deleted_account';
  if (patient.smsOptOut && !options.essential) return 'opted_out';
  return sendSms(patient.phoneNumber, message, options.purpose);
}

export interface SmsHealth {
  failing: boolean;
  consecutiveFailures: number;
  failingSince: string | null;
  lastSuccessAt: string | null;
  threshold: number;
}

/** For the owner page: is SMS sending failing right now? */
export async function getSmsHealth(): Promise<SmsHealth> {
  const [failures, since, lastSuccess] = await Promise.all([
    redis.get(FAILURES_KEY),
    redis.get(FAILING_SINCE_KEY),
    redis.get(LAST_SUCCESS_KEY),
  ]);
  const consecutiveFailures = Number(failures ?? 0);
  return {
    failing: consecutiveFailures >= SMS_FAILURE_WARNING_THRESHOLD,
    consecutiveFailures,
    failingSince: since,
    lastSuccessAt: lastSuccess,
    threshold: SMS_FAILURE_WARNING_THRESHOLD,
  };
}
