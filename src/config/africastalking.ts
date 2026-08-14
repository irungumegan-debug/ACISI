import AfricasTalking from 'africastalking';
import { env } from './env';

const client = AfricasTalking({ apiKey: env.AT_API_KEY, username: env.AT_USERNAME });

export const smsClient = client.SMS;
