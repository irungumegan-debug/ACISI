import { redis } from '../config/redis';
import { MPESA_FAILURE_WARNING_THRESHOLD } from '../config/constants';

/**
 * Is ACISI's M-Pesa check-in prompt working? Every check-in fee prompt
 * (ACISI's own till) reports here how it ended. After
 * MPESA_FAILURE_WARNING_THRESHOLD failures or time-outs in a row the owner
 * page shows "M-Pesa prompts are failing – check Daraja/Safaricom", with the
 * time of the last successful payment; the next payment clears it.
 *
 * Counted as a failure: the prompt could not be sent, the phone could not
 * be reached or the prompt expired, no answer within the hour (NEEDS_REVIEW),
 * or any other error from Safaricom. Not counted: what the patient decided
 * (cancelled, not enough balance, wrong PIN). Those show M-Pesa is working,
 * so they neither raise nor clear the warning.
 *
 * Only counters and times are stored: no phone number, amount or patient.
 */

const FAILURES_KEY = 'mpesa:health:consecutive_failures';
const FAILING_SINCE_KEY = 'mpesa:health:failing_since';
const LAST_SUCCESS_KEY = 'mpesa:health:last_success_at';

/** Daraja ResultCodes that are the patient's own decision, not a system fault: 1 insufficient balance, 1032 cancelled, 2001 wrong PIN. */
export const PATIENT_DECIDED_RESULT_CODES = new Set([1, 1032, 2001]);

export async function notePromptFailed(): Promise<void> {
  try {
    const count = await redis.incr(FAILURES_KEY);
    if (count === 1) await redis.set(FAILING_SINCE_KEY, new Date().toISOString());
  } catch {
    // Health tracking must never break a payment.
  }
}

export async function notePaymentSucceeded(): Promise<void> {
  try {
    await redis.del(FAILURES_KEY, FAILING_SINCE_KEY);
    await redis.set(LAST_SUCCESS_KEY, new Date().toISOString());
  } catch {
    // Health tracking must never break a payment.
  }
}

/** A definite answer from Safaricom: success clears, a system failure counts, a patient's decision does neither. */
export async function notePromptResult(resultCode: number): Promise<void> {
  if (resultCode === 0) return notePaymentSucceeded();
  if (PATIENT_DECIDED_RESULT_CODES.has(resultCode)) return;
  return notePromptFailed();
}

export interface MpesaHealth {
  failing: boolean;
  consecutiveFailures: number;
  failingSince: string | null;
  lastSuccessAt: string | null;
  threshold: number;
}

/** For the owner page: are M-Pesa prompts failing right now? */
export async function getMpesaHealth(): Promise<MpesaHealth> {
  const [failures, since, lastSuccess] = await Promise.all([
    redis.get(FAILURES_KEY),
    redis.get(FAILING_SINCE_KEY),
    redis.get(LAST_SUCCESS_KEY),
  ]);
  const consecutiveFailures = Number(failures ?? 0);
  return {
    failing: consecutiveFailures >= MPESA_FAILURE_WARNING_THRESHOLD,
    consecutiveFailures,
    failingSince: since,
    lastSuccessAt: lastSuccess,
    threshold: MPESA_FAILURE_WARNING_THRESHOLD,
  };
}
