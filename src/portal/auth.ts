import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { redis } from '../config/redis';
import {
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  DASHBOARD_SESSION_TTL_SECONDS,
  OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS,
  OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
} from '../config/constants';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import {
  findPatientByPhoneOrCode,
  registerPatient,
  setPatientPin,
  verifyPatientPin,
} from '../services/patientService';
import { requestPinResetOtp, verifyPinResetOtp } from '../services/otpService';
import {
  createPatientSession,
  destroyPatientSession,
  loadPatientSession,
  PatientSession,
  PATIENT_SESSION_COOKIE_NAME,
} from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedPatientRequest extends Request {
  patientSession: PatientSession;
}

const PIN_PATTERN = /^\d{4,6}$/;

function rateLimitKey(prefix: string, identifier: string): string {
  return `portal:${prefix}:${identifier}`;
}

async function isRateLimited(prefix: string, identifier: string, max: number): Promise<boolean> {
  const count = await redis.get(rateLimitKey(prefix, identifier));
  return Number(count ?? 0) >= max;
}

async function recordAttempt(prefix: string, identifier: string, windowSeconds: number): Promise<void> {
  const k = rateLimitKey(prefix, identifier);
  const count = await redis.incr(k);
  if (count === 1) {
    await redis.expire(k, windowSeconds);
  }
}

async function clearAttempts(prefix: string, identifier: string): Promise<void> {
  await redis.del(rateLimitKey(prefix, identifier));
}

export const portalAuthRouter = Router();

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: z.string().min(1),
  dateOfBirth: z.string().optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional(),
  pin: z.string().regex(PIN_PATTERN, 'PIN must be 4-6 digits'),
  crossClinicConsent: z.boolean().optional(),
  // Optional — many patients won't have one, and nothing else in the
  // product depends on it (no email login, no email OTP). Only ever used
  // later for the staff-initiated visit-summary email at checkout.
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
});

portalAuthRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please fill in all required fields with a valid PIN' });
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

  const patient = await registerPatient({
    phoneNumberE164: phoneE164,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined,
    sex: parsed.data.sex ?? 'UNKNOWN',
    consentChannel: 'PORTAL',
    crossClinicConsent: parsed.data.crossClinicConsent ?? false,
    pin: parsed.data.pin,
    email: parsed.data.email || undefined,
  }).catch((err) => {
    if (err?.code === 'P2002') return null;
    throw err;
  });

  if (!patient) {
    res.status(409).json({ error: 'An account with that phone number already exists' });
    return;
  }

  const token = await createPatientSession({
    patientId: patient.id,
    patientCode: patient.patientCode,
    firstName: patient.firstName,
  });

  res.cookie(PATIENT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // req.secure (not env.NODE_ENV, which Railway never sets to
    // 'production') reflects whether this request actually arrived over
    // HTTPS, via the trust proxy setting in app.ts honoring
    // X-Forwarded-Proto from the platform's TLS-terminating edge proxy.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS * 1000,
  });

  res.status(201).json({ patientCode: patient.patientCode, firstName: patient.firstName });
});

const loginSchema = z.object({
  identifier: z.string().min(1),
  pin: z.string().min(1),
});

portalAuthRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number/patient ID and PIN are required' });
    return;
  }

  const identifier = parsed.data.identifier.trim();

  if (await isRateLimited('login_attempts', identifier, LOGIN_RATE_LIMIT_MAX_ATTEMPTS)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }

  const patient = await findPatientByPhoneOrCode(identifier);
  const isValid = patient ? await verifyPatientPin(patient, parsed.data.pin) : false;

  if (!patient || !isValid) {
    await recordAttempt('login_attempts', identifier, LOGIN_RATE_LIMIT_WINDOW_SECONDS);
    res.status(401).json({ error: 'Invalid phone number/patient ID or PIN' });
    return;
  }

  await clearAttempts('login_attempts', identifier);

  const token = await createPatientSession({
    patientId: patient.id,
    patientCode: patient.patientCode,
    firstName: patient.firstName,
  });

  res.cookie(PATIENT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS * 1000,
  });

  res.json({ patientCode: patient.patientCode, firstName: patient.firstName });
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

const forgotPinSchema = z.object({ identifier: z.string().min(1) });

/**
 * Always returns the same generic response whether or not the identifier
 * matched a patient — same no-enumeration principle as the staff dashboard
 * login. Real "forgot PIN" also bootstraps a first PIN for a patient who
 * registered via USSD and never set one, per the identity model.
 */
portalAuthRouter.post('/forgot-pin', async (req, res) => {
  const parsed = forgotPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number or patient ID is required' });
    return;
  }

  const identifier = parsed.data.identifier.trim();

  if (await isRateLimited('otp_requests', identifier, OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS)) {
    res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    return;
  }
  await recordAttempt('otp_requests', identifier, OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS);

  const patient = await findPatientByPhoneOrCode(identifier);
  if (patient) {
    try {
      await requestPinResetOtp(patient);
    } catch (err) {
      logger.error({ err }, 'Failed to send PIN reset OTP');
    }
  }

  res.json({ message: 'If that account exists, we sent a one-time code by SMS.' });
});

const resetPinSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().min(1),
  newPin: z.string().regex(PIN_PATTERN, 'PIN must be 4-6 digits'),
});

portalAuthRouter.post('/reset-pin', async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid code and new PIN are required' });
    return;
  }

  const patient = await findPatientByPhoneOrCode(parsed.data.identifier.trim());
  if (!patient) {
    res.status(400).json({ error: 'Invalid code' });
    return;
  }

  const isValid = await verifyPinResetOtp(patient.id, parsed.data.code.trim());
  if (!isValid) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  await setPatientPin(patient.id, parsed.data.newPin);
  res.json({ message: 'PIN updated. You can now log in with your new PIN.' });
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
    logger.error({ err }, 'Failed to validate patient session');
    res.status(500).json({ error: 'Internal server error' });
  }
}
