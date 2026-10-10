import AfricasTalking from 'africastalking';
import { env } from './env';
import { isDemoRecipient } from '../services/demoGuard';
import { logger } from '../utils/logger';

const client = AfricasTalking({ apiKey: env.AT_API_KEY, username: env.AT_USERNAME });

type SendOptions = Parameters<typeof client.SMS.send>[0];

/**
 * Every SMS ACISI sends goes through here. Demo recipients (a demo clinic's
 * fake patients and staff, see services/demoGuard.ts) are dropped; if no one
 * is left, nothing is sent and null is returned instead of the provider's
 * response. Logs never carry the number.
 */
export const smsClient = {
  async send(options: SendOptions): Promise<unknown | null> {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const real: string[] = [];
    for (const to of recipients) {
      if (!(await isDemoRecipient(to))) real.push(to);
    }
    if (real.length === 0) {
      logger.info('SMS not sent: the recipient is a demo patient or staff member');
      return null;
    }
    return client.SMS.send({ ...options, to: real });
  },
};
