import { rawSmsClient } from '../config/africastalking';
import { logger } from '../utils/logger';
import { isDemoRecipient } from './demoGuard';

/**
 * The only way ACISI sends an SMS. Refuses demo recipients (see
 * demoGuard.ts) and returns null instead of sending, so a demo clinic's fake
 * patients and staff never get a message. Everything else goes straight to
 * Africa's Talking, and the provider's response is returned as-is. Any
 * future channel (WhatsApp included) must go through the same check.
 */
export async function sendSms(input: { to: string; message: string }): Promise<unknown | null> {
  if (await isDemoRecipient(input.to)) {
    logger.info('SMS not sent: the recipient is a demo patient or staff member');
    return null;
  }
  return rawSmsClient.send({ to: [input.to], message: input.message });
}
