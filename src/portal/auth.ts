import { NextFunction, Request, Response, Router } from 'express';
import { Patient } from '@prisma/client';
import { z } from 'zod';
import { redis } from '../config/redis';
import {
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  DASHBOARD_SESSION_TTL_SECONDS,
  PATIENT_LONG_SESSION_TTL_SECONDS,
  PATIENT_OTP_MAX_SENDS_PER_IP_PER_HOUR,
} from '../config/constants';
import {
  completeSelfSignup,
  completeSetupWithPin,
  confirmPatientPin,
  loginWithPin,
  markIdSaved,
  PatientAuthError,
  requestPatientOtp,
  selectSetupPerson,
  startSetupFlow,
  verifySetupDateOfBirth,
} from '../services/patientAuthService';
import { deletePatientAccount, PatientNotFoundError } from '../services/patientDeletionService';
import { prisma } from '../db/prisma';
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

function sendAuthError(err: unknown, res: Response): boolean {
  if (err instanceof PatientAuthError) {
    res.status(err.status).json({ error: err.message, ...(err.details ?? {}) });
    return true;
  }
  return false;
}

/** Sets the session cookie: 8 hours, or 30 days with "keep me signed in" (personal devices). */
async function startSession(req: Request, res: Response, patient: Patient, keepSignedIn: boolean, issuedAfter = 0): Promise<void> {
  const ttl = keepSignedIn ? PATIENT_LONG_SESSION_TTL_SECONDS : DASHBOARD_SESSION_TTL_SECONDS;
  const token = await createPatientSession({ patientId: patient.id, patientCode: patient.patientCode, firstName: patient.firstName }, ttl, issuedAfter);
  res.cookie(PATIENT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // req.secure (not env.NODE_ENV) reflects whether this request actually
    // arrived over HTTPS, via the trust proxy setting in app.ts honoring
    // X-Forwarded-Proto from the TLS-terminating proxy in front of us.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: ttl * 1000,
  });
}

function sessionBody(patient: Patient) {
  return { patientCode: patient.patientCode, firstName: patient.firstName, idSaved: Boolean(patient.idSavedAt) };
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(40),
  pin: z.string().max(12),
  /** Set when the PIN matched several people on a shared phone and the patient picked one. */
  patientId: z.string().max(64).optional(),
  keepSignedIn: z.boolean().default(false),
});

/** Everyday login: phone number or ACISI ID + 6-digit PIN. No SMS. */
portalAuthRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number or ACISI ID, and PIN, are required' });
    return;
  }
  try {
    const result = await loginWithPin(parsed.data.identifier, parsed.data.pin, { patientId: parsed.data.patientId });
    if (result.kind === 'choose') {
      res.json({ choose: result.people });
      return;
    }
    await startSession(req, res, result.patient, parsed.data.keepSignedIn);
    res.json(sessionBody(result.patient));
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

/** Per-IP cap across all phone numbers, so the OTP endpoint can't be used to run up the SMS bill. */
async function ipOverOtpLimit(req: Request): Promise<boolean> {
  const k = `portal:otp_ip:${req.ip ?? 'unknown'}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, 60 * 60);
  return count > PATIENT_OTP_MAX_SENDS_PER_IP_PER_HOUR;
}

const otpRequestSchema = z.object({ phone: z.string().trim().min(1).max(20), purpose: z.enum(['login', 'reset']) });

/**
 * Sends the one-time code: "login" for a first login (or signup), "reset"
 * for a forgotten PIN. The answer is the same whether or not an account
 * exists for the number.
 */
portalAuthRouter.post('/otp/request', async (req, res) => {
  const parsed = otpRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your phone number' });
    return;
  }
  if (await ipOverOtpLimit(req)) {
    res.status(429).json({ error: 'Too many codes requested. Try again later.' });
    return;
  }
  try {
    await requestPatientOtp(parsed.data.phone, parsed.data.purpose);
    res.json({ message: 'If this number can use ACISI, we sent a 6-digit code by SMS. It expires in 5 minutes.' });
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

const otpVerifySchema = otpRequestSchema.extend({ code: z.string().trim().min(1).max(10) });

/** Checks the code and starts the short setup flow; returns who is on this phone. */
portalAuthRouter.post('/otp/verify', async (req, res) => {
  const parsed = otpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter the 6-digit code from the SMS' });
    return;
  }
  try {
    res.json(await startSetupFlow(parsed.data.phone, parsed.data.purpose, parsed.data.code));
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

const flowSchema = z.object({ flowToken: z.string().max(80) });

portalAuthRouter.post('/setup/select', async (req, res) => {
  const parsed = flowSchema.extend({ patientId: z.string().max(64) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Choose who you are' });
    return;
  }
  try {
    await selectSetupPerson(parsed.data.flowToken, parsed.data.patientId);
    res.status(204).send();
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

portalAuthRouter.post('/setup/verify-dob', async (req, res) => {
  const parsed = flowSchema.extend({ dateOfBirth: z.string().max(10) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your date of birth' });
    return;
  }
  try {
    await verifySetupDateOfBirth(parsed.data.flowToken, parsed.data.dateOfBirth);
    res.status(204).send();
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

const setPinSchema = flowSchema.extend({ pin: z.string().max(12), pinConfirm: z.string().max(12), keepSignedIn: z.boolean().default(false) });

/** Sets the PIN (first login or forgot PIN) and logs the patient in. The screen then shows their ACISI ID. */
portalAuthRouter.post('/setup/set-pin', async (req, res) => {
  const parsed = setPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your new PIN twice' });
    return;
  }
  try {
    const { patient, revokedAt } = await completeSetupWithPin(parsed.data.flowToken, parsed.data.pin, parsed.data.pinConfirm);
    await startSession(req, res, patient, parsed.data.keepSignedIn, revokedAt);
    res.json(sessionBody(patient));
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

const signupSchema = setPinSchema.extend({
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  dateOfBirth: z.string().max(10),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']),
  /** "I accept the Terms of Service and have read the Privacy Notice" — required. */
  acceptLegal: z.boolean().default(false),
  // Optional — only ever used for the staff-initiated visit-summary email at checkout.
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
});

/** Self-signup on the portal, after the phone number was confirmed by OTP. */
portalAuthRouter.post('/setup/register', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Please fill in all required fields' });
    return;
  }
  try {
    const patient = await completeSelfSignup(parsed.data.flowToken, parsed.data);
    await startSession(req, res, patient, parsed.data.keepSignedIn);
    res.status(201).json(sessionBody(patient));
  } catch (err) {
    if (!sendAuthError(err, res)) throw err;
  }
});

portalAuthRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[PATIENT_SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyPatientSession(token);
  }
  res.clearCookie(PATIENT_SESSION_COOKIE_NAME);
  res.status(204).send();
});

portalAuthRouter.get('/me', requirePatientSession, async (req, res) => {
  const session = (req as AuthenticatedPatientRequest).patientSession;
  const patient = await prisma.patient.findFirst({ where: { id: session.patientId, deletedAt: null }, select: { idSavedAt: true } });
  res.json({ ...session, idSaved: Boolean(patient?.idSavedAt) });
});

/** The patient ticked "I have saved my ACISI ID" on the screen shown after setting their PIN. */
portalAuthRouter.post('/id-saved', requirePatientSession, async (req, res) => {
  await markIdSaved((req as AuthenticatedPatientRequest).patientSession.patientId);
  res.status(204).send();
});

const deleteAccountSchema = z.object({ pin: z.string().min(1) });

/**
 * Patient-initiated account deletion. Re-asks for the PIN even though the
 * patient is already logged in, so an unattended logged-in phone isn't
 * enough to wipe someone's account. Shares the login rate limit, keyed by
 * patient, so it can't be used to brute-force a PIN either.
 */
portalAuthRouter.post('/account/delete', requirePatientSession, async (req, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter your PIN to confirm' });
    return;
  }

  const { patientId } = (req as AuthenticatedPatientRequest).patientSession;

  if (await isRateLimited('delete_attempts', patientId, LOGIN_RATE_LIMIT_MAX_ATTEMPTS)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }

  let isValid: boolean;
  try {
    isValid = await confirmPatientPin(patientId, parsed.data.pin);
  } catch (err) {
    if (sendAuthError(err, res)) return;
    throw err;
  }
  if (!isValid) {
    await recordAttempt('delete_attempts', patientId, LOGIN_RATE_LIMIT_WINDOW_SECONDS);
    res.status(401).json({ error: 'Incorrect PIN' });
    return;
  }

  try {
    await deletePatientAccount(patientId, { type: 'PATIENT' });
  } catch (err) {
    if (err instanceof PatientNotFoundError) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    throw err;
  }

  await clearAttempts('delete_attempts', patientId);
  res.clearCookie(PATIENT_SESSION_COOKIE_NAME);
  res.status(204).send();
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
