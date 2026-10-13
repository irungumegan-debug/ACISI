import { smsClient } from '../config/africastalking';
import { logger, errorSummary } from '../utils/logger';

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

/**
 * Sends one SMS through the existing Africa's Talking integration (sandbox
 * when AT_USERNAME is "sandbox"). Never throws and never logs the number or
 * the text — callers pass a `purpose` and an internal id for the log line.
 */
export async function sendSms(
  phoneNumberE164: string,
  message: string,
  log: { purpose: string; patientId?: string },
): Promise<boolean> {
  try {
    const response = await smsClient.send({ to: [phoneNumberE164], message });
    if (!smsWasAccepted(response)) {
      logger.warn({ purpose: log.purpose, patientId: log.patientId }, 'SMS rejected by provider');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err: errorSummary(err), purpose: log.purpose, patientId: log.patientId }, 'Failed to send SMS');
    return false;
  }
}
