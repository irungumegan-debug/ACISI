import AfricasTalking from 'africastalking';
import { env } from './env';

const client = AfricasTalking({ apiKey: env.AT_API_KEY, username: env.AT_USERNAME });

/**
 * Use services/smsService.sendSms instead: it is the single place that
 * keeps SMS away from demo clinics' fake patients and staff.
 */
export const rawSmsClient = client.SMS;
