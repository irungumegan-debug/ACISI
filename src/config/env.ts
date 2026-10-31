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
  // USSD is not in use yet: /api/ussd answers 404 unless this is exactly
  // "true". The USSD code itself stays in src/ussd/, untouched, ready to be
  // switched back on.
  USSD_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().min(1, 'MPESA_CONSUMER_KEY is required'),
  MPESA_CONSUMER_SECRET: z.string().min(1, 'MPESA_CONSUMER_SECRET is required'),
  /**
   * Paybill: the paybill number. Buy Goods: the STORE (head-office) number,
   * which Daraja wants in BusinessShortCode, the password and the status
   * query; the till itself goes in MPESA_TILL_NUMBER.
   */
  MPESA_SHORTCODE: z.string().min(1, 'MPESA_SHORTCODE is required'),
  /**
   * Set for a Buy Goods till: prompts are sent as CustomerBuyGoodsOnline with
   * this till as PartyB. Leave unset for a Paybill. Never shown to patients.
   */
  MPESA_TILL_NUMBER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().regex(/^\d+$/, 'MPESA_TILL_NUMBER must be digits only').optional(),
  ),
  MPESA_PASSKEY: z.string().min(1, 'MPESA_PASSKEY is required'),
  MPESA_CALLBACK_URL: z.string().url('MPESA_CALLBACK_URL must be a valid URL'),

  CHECKIN_FEE_AMOUNT_KES: z.coerce.number().positive().default(100),
  // Restricting accounts over an unpaid check-in fee (C20). Off unless this
  // is exactly "true": switch it on only once the Terms of Service say so.
  // The profile notices and the "old fee + new fee" prompt work either way.
  FEE_RESTRICTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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

/** Safaricom's public sandbox shortcode: never valid on a live server. */
const DARAJA_SANDBOX_SHORTCODE = '174379';
/** The lowest check-in fee a live server will start with (catches a leftover test value such as 1). */
export const MIN_LIVE_CHECKIN_FEE_KES = 50;

/**
 * Extra rules for a live server (MPESA_ENV=production). ACISI's check-in
 * fee is taken by Buy Goods only, so a live server must have a till and can
 * never fall back to Paybill. Returns one message per problem; the app
 * refuses to start if there are any. Messages name settings, never values.
 */
export function productionMpesaProblems(e: Env): string[] {
  if (e.MPESA_ENV !== 'production') return [];
  const problems: string[] = [];
  if (!e.MPESA_TILL_NUMBER) {
    problems.push('MPESA_TILL_NUMBER: required when MPESA_ENV=production (check-in fees are paid by Buy Goods to the till)');
  } else if (e.MPESA_TILL_NUMBER === e.MPESA_SHORTCODE.trim()) {
    problems.push(
      'MPESA_TILL_NUMBER: must not be the same as MPESA_SHORTCODE (MPESA_SHORTCODE is the shortcode the passkey was issued for; the till goes in MPESA_TILL_NUMBER)',
    );
  }
  if (e.MPESA_SHORTCODE.trim() === DARAJA_SANDBOX_SHORTCODE) {
    problems.push("MPESA_SHORTCODE: is Safaricom's sandbox test shortcode; set the live shortcode the production passkey was issued for");
  }
  if (!e.MPESA_CALLBACK_URL.startsWith('https://')) {
    problems.push('MPESA_CALLBACK_URL: must start with https:// when MPESA_ENV=production');
  }
  if (e.CHECKIN_FEE_AMOUNT_KES < MIN_LIVE_CHECKIN_FEE_KES) {
    problems.push(`CHECKIN_FEE_AMOUNT_KES: must be at least ${MIN_LIVE_CHECKIN_FEE_KES} when MPESA_ENV=production (is a test value still set?)`);
  }
  return problems;
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  const issues = parsed.success
    ? productionMpesaProblems(parsed.data)
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
  return (parsed as { data: Env }).data;
}

function loadEnv(): Env {
  return parseEnv(process.env);
}

export const env = loadEnv();

export const mpesaBaseUrl =
  env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
