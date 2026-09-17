import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { redis } from '../config/redis';
import { env } from '../config/env';
import { smsClient } from '../config/africastalking';
import {
  PATIENT_OTP_MAX_VERIFY_ATTEMPTS,
  PATIENT_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS,
  PATIENT_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
  PATIENT_OTP_TTL_SECONDS,
  PATIENT_SESSION_TTL_SECONDS,
} from '../config/constants';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { generateOtpCode, hashOtpCode } from '../utils/otp';
import { isRateLimited, recordAttempt } from '../utils/rateLimit';
import {
  PATIENT_SESSION_COOKIE_NAME,
  PatientSession,
  createPatientSession,
  destroyPatientSession,
  loadPatientSession,
} from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedPatientRequest extends Request {
  patientSession: PatientSession;
}

interface StoredOtp {
  codeHash: string;
  attempts: number;
}

function otpKey(phoneE164: string): string {
  return `portal:otp:${phoneE164}`;
}

function otpRequestRateLimitKey(phoneE164: string): string {
  return `portal:otp_requests:${phoneE164}`;
}

export const portalAuthRouter = Router();

const requestOtpSchema = z.object({ phoneNumber: z.string().min(1) });

/**
 * Always responds with the same generic message whether or not this phone
 * number has an ACISI record — same anti-enumeration posture as the dashboard
 * login's "invalid phone number or PIN" for both an unknown number and a
 * wrong PIN.
 */
portalAuthRouter.post('/otp/request', async (req, res) => {
  const parsed = requestOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }

  let phoneE164: string;
  try {
    phoneE164 = toE164(parsed.data.phoneNumber);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }
    throw err;
  }

  const rateLimitKey = otpRequestRateLimitKey(phoneE164);
  if (await isRateLimited(rateLimitKey, PATIENT_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS)) {
    res.status(429).json({ error: 'Too many codes requested. Please try again later.' });
    return;
  }
  await recordAttempt(rateLimitKey, PATIENT_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS);

  const code = generateOtpCode();
  const stored: StoredOtp = { codeHash: hashOtpCode(code), attempts: 0 };
  await redis.set(otpKey(phoneE164), JSON.stringify(stored), 'EX', PATIENT_OTP_TTL_SECONDS);

  try {
    await smsClient.send({
      to: [phoneE164],
      message: `Your ACISI verification code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`,
    });
  } catch (err) {
    logger.error({ err, phoneE164 }, 'Failed to send patient portal OTP SMS');
    res.status(502).json({ error: 'Could not send a verification code right now. Please try again shortly.' });
    return;
  }

  res.json({ message: 'A verification code has been sent by SMS.' });
});

const verifyOtpSchema = z.object({ phoneNumber: z.string().min(1), code: z.string().min(1) });

portalAuthRouter.post('/otp/verify', async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number and code are required' });
    return;
  }

  let phoneE164: string;
  try {
    phoneE164 = toE164(parsed.data.phoneNumber);
  } catch (err) {
    if (err instanceof InvalidPhoneNumberError) {
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }
    throw err;
  }

  const raw = await redis.get(otpKey(phoneE164));
  if (!raw) {
    res.status(401).json({ error: 'That code has expired. Please request a new one.' });
    return;
  }

  const stored = JSON.parse(raw) as StoredOtp;

  if (stored.attempts >= PATIENT_OTP_MAX_VERIFY_ATTEMPTS) {
    await redis.del(otpKey(phoneE164));
    res.status(401).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    return;
  }

  const isValid = stored.codeHash === hashOtpCode(parsed.data.code.trim());
  if (!isValid) {
    const remainingTtl = await redis.ttl(otpKey(phoneE164));
    stored.attempts += 1;
    if (remainingTtl > 0) {
      await redis.set(otpKey(phoneE164), JSON.stringify(stored), 'EX', remainingTtl);
    }
    res.status(401).json({ error: 'Incorrect code' });
    return;
  }

  await redis.del(otpKey(phoneE164));

  const token = await createPatientSession({ phoneNumberE164: phoneE164 });
  res.cookie(PATIENT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: PATIENT_SESSION_TTL_SECONDS * 1000,
  });

  res.json({ phoneNumber: phoneE164 });
});

portalAuthRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[PATIENT_SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyPatientSession(token);
  }
  res.clearCookie(PATIENT_SESSION_COOKIE_NAME);
  res.status(204).send();
});

portalAuthRouter.get('/me', requirePatientSession, (req, res) => {
  res.json((req as AuthenticatedPatientRequest).patientSession);
});

export async function requirePatientSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[PATIENT_SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const session = await loadPatientSession(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    (req as AuthenticatedPatientRequest).patientSession = session;
    next();
  } catch (err) {
    logger.error({ err }, 'Failed to validate patient portal session');
    res.status(500).json({ error: 'Internal server error' });
  }
}
