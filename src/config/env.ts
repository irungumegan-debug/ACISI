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

  // --- Email (visit-summary delivery, opt-in at checkout) ---
  // Both optional, unlike the AT/Daraja vars above: email is a genuinely
  // optional delivery channel (many patients have none on file, and staff
  // must actively choose it), so the app must keep working fully — SMS
  // included — before either of these is ever configured.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().optional(),

  // --- Clinic checkout payments via M-Pesa (optional; SANDBOX ONLY for now) ---
  // A separate Daraja app from ACISI's own (MPESA_* above, which only ever
  // collects the patient check-in fee). Used to send STK push prompts that
  // pay the CLINIC — ACISI never holds clinic money. Credentials live only
  // here, never in the database or code. If any are missing, "Request
  // payment" is unavailable and staff use the manual M-Pesa code instead.
  // Only 'sandbox' is accepted until per-clinic live credentials exist (see
  // "Planned features" in CLAUDE.md).
  CLINIC_MPESA_ENV: z.literal('sandbox').default('sandbox'),
  CLINIC_DARAJA_CONSUMER_KEY: z.string().optional(),
  CLINIC_DARAJA_CONSUMER_SECRET: z.string().optional(),
  /** Daraja sandbox shortcode — Safaricom's test paybill is 174379. */
  CLINIC_DARAJA_SHORTCODE: z.string().default('174379'),
  CLINIC_DARAJA_PASSKEY: z.string().optional(),
  /** Public HTTPS URL of /api/mpesa/clinic-callback. */
  CLINIC_MPESA_CALLBACK_URL: z.string().url().optional(),

  // --- Owner account bootstrap (optional) ---
  // Lets the owner account for the /owner site be created from the host's
  // environment settings (e.g. Railway variables) instead of a shell. Read
  // once at startup by ownerService.ensureOwnerFromEnv: if all three are set
  // and no owner exists for OWNER_EMAIL, one is created with a bcrypt hash of
  // OWNER_PASSWORD. Never overwrites an existing owner, so OWNER_PASSWORD
  // can (and should) be deleted once the account exists.
  OWNER_EMAIL: z.string().optional(),
  OWNER_NAME: z.string().optional(),
  OWNER_PASSWORD: z.string().optional(),

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
