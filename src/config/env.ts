import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  AT_USERNAME: z.string().min(1, 'AT_USERNAME is required'),
  AT_API_KEY: z.string().min(1, 'AT_API_KEY is required'),
  AT_USSD_SERVICE_CODE: z.string().optional(),

  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().min(1, 'MPESA_CONSUMER_KEY is required'),
  MPESA_CONSUMER_SECRET: z.string().min(1, 'MPESA_CONSUMER_SECRET is required'),
  MPESA_SHORTCODE: z.string().min(1, 'MPESA_SHORTCODE is required'),
  MPESA_PASSKEY: z.string().min(1, 'MPESA_PASSKEY is required'),
  MPESA_CALLBACK_URL: z.string().url('MPESA_CALLBACK_URL must be a valid URL'),

  CHECKIN_FEE_AMOUNT_KES: z.coerce.number().positive().default(100),

  STAFF_PIN_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  USSD_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(170),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const mpesaBaseUrl =
  env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
