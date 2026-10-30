import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { redis } from '../config/redis';
import {
  CODE_NOT_SENT_MESSAGE,
  DASHBOARD_SESSION_TTL_SECONDS,
  OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS,
  OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS,
} from '../config/constants';
import { clearLockout, isLockedOut, lockoutMessage, LockoutSubject, recordWrongPin } from '../services/pinLockout';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { pinPolicyError } from '../utils/pinPolicy';
import { findPatientByPhoneOrCode, hashPatientPin, setPatientPin, verifyPatientPin } from '../services/patientService';
import { PatientIdentityError, patientIdentityInputSchema, preparePatientIdentity } from '../services/patientIdentity';
import { PendingSignupError, resendSignupCode, startPendingSignup, verifyPendingSignup } from '../services/pendingSignupService';
import { requestPinResetOtp, verifyPinResetOtp } from '../services/otpService';
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

/** The phone number in E.164 or the patient ID upper-cased, so every way of typing one maps to one counter. */
function normaliseIdentifier(identifier: string): string {
  if (/^ACI-/i.test(identifier)) return identifier.toUpperCase();
  try {
    return toE164(identifier);
  } catch {
    return identifier.toLowerCase();
  }
}

export const portalAuthRouter = Router();

const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phoneNumber: z.string().min(1),
  dateOfBirth: z.string().optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional(),
  pin: z.string().min(1),
  crossClinicConsent: z.boolean().optional(),
  /** "I accept the Terms of Service and have read the Privacy Notice" — required. */
  acceptLegal: z.boolean().optional(),
  // Optional — many patients won't have one, and nothing else in the
  // product depends on it (no email login, no email OTP). Only ever used
  // later for the staff-initiated visit-summary email at checkout.
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  /** Optional ID document and next of kin (C11). */
  identity: patientIdentityInputSchema.optional(),
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

  const pinError = pinPolicyError(parsed.data.pin, { phoneNumber: phoneE164 });
  if (pinError) {
    res.status(400).json({ error: pinError });
    return;
  }

  if (parsed.data.acceptLegal !== true) {
    res.status(400).json({ error: 'Please accept the Terms of Service and Privacy Notice to create your account' });
    return;
  }

  let identity;
  try {
    identity = preparePatientIdentity(parsed.data.identity ?? {}, 'fillIn');
  } catch (err) {
    if (err instanceof PatientIdentityError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // C3: no account yet. The signup waits until the phone is verified, by
  // the SMS code or at the clinic, and is kept so nothing is retyped.
  try {
    const { pendingId, smsSent } = await startPendingSignup({
      phoneNumberE164: phoneE164,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : undefined,
      sex: parsed.data.sex ?? 'UNKNOWN',
      email: parsed.data.email || undefined,
      identity,
      pinHash: await hashPatientPin(parsed.data.pin),
      crossClinicConsent: parsed.data.crossClinicConsent ?? false,
    });
    res.status(202).json({ pendingId, smsSent, ...(smsSent ? {} : { message: CODE_NOT_SENT_MESSAGE }) });
  } catch (err) {
    if (err instanceof PendingSignupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

function startPatientSession(res: Response, req: Request, token: string): void {
  res.cookie(PATIENT_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // req.secure (not env.NODE_ENV) reflects whether this request actually
    // arrived over HTTPS, via the trust proxy setting in app.ts.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS * 1000,
  });
}

const verifySignupSchema = z.object({ pendingId: z.string().min(1), code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits') });

/** The SMS code from signup: creates the account (phone verified) and logs the patient in. */
portalAuthRouter.post('/register/verify', async (req, res) => {
  const parsed = verifySignupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Enter the 6-digit code' });
    return;
  }
  try {
    const patient = await verifyPendingSignup(parsed.data.pendingId, parsed.data.code);
    const token = await createPatientSession({ patientId: patient.id, patientCode: patient.patientCode, firstName: patient.firstName });
    startPatientSession(res, req, token);
    res.status(201).json({ patientCode: patient.patientCode, firstName: patient.firstName });
  } catch (err) {
    if (err instanceof PendingSignupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** "Send the code again" for a pending signup. */
portalAuthRouter.post('/register/resend', async (req, res) => {
  const pendingId = typeof req.body?.pendingId === 'string' ? req.body.pendingId : '';
  if (!pendingId) {
    res.status(400).json({ error: 'Missing signup' });
    return;
  }
  try {
    const { smsSent } = await resendSignupCode(pendingId);
    res.json({ smsSent, ...(smsSent ? {} : { message: CODE_NOT_SENT_MESSAGE }) });
  } catch (err) {
    if (err instanceof PendingSignupError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  const patient = await findPatientByPhoneOrCode(identifier);
  // Counted per account: 0712…, +254 712… and the patient ID all reach the
  // same counter, so typing the number another way never buys more tries.
  const subject: LockoutSubject = patient ? `patient:${patient.id}` : `unknown:patient:${normaliseIdentifier(identifier)}`;

  if (await isLockedOut(subject)) {
    res.status(429).json({ error: lockoutMessage() });
    return;
  }

  const isValid = patient ? await verifyPatientPin(patient, parsed.data.pin) : false;

  if (!patient || !isValid) {
    const nowLocked = await recordWrongPin(subject);
    res.status(nowLocked ? 429 : 401).json({ error: nowLocked ? lockoutMessage() : 'Invalid phone number/patient ID or PIN' });
    return;
  }

  await clearLockout(subject);

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

  // Same answer whether or not the account exists, or the SMS went out, so
  // nobody can probe for accounts. The clinic fallback is always offered.
  res.json({
    message:
      'If that account exists, we sent a one-time code by SMS. If no code arrives, visit your clinic – the front desk will verify your phone and finish setting up your account.',
  });
});

const resetPinSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().min(1),
  newPin: z.string().min(1),
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

  // Checked before the code, so a rejected PIN doesn't use up the
  // one-time code — the patient can fix the PIN and resubmit.
  const pinError = pinPolicyError(parsed.data.newPin, { phoneNumber: patient.phoneNumber });
  if (pinError) {
    res.status(400).json({ error: pinError });
    return;
  }

  const via = await verifyPinResetOtp(patient.id, parsed.data.code.trim());
  if (!via) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  // setPatientPin also marks the phone verified, lifts any lockout, logs out
  // every existing session (the old PIN may be what someone else was using)
  // and is audit-logged.
  await setPatientPin(patient.id, parsed.data.newPin, via);

  res.json({ message: 'PIN updated. You can now log in with your new PIN.' });
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

  // Same per-account counter as login, so a wrong PIN here counts there too.
  if (await isLockedOut(`patient:${patientId}`)) {
    res.status(429).json({ error: lockoutMessage() });
    return;
  }

  const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null } });
  const isValid = patient ? await verifyPatientPin(patient, parsed.data.pin) : false;
  if (!patient || !isValid) {
    const nowLocked = await recordWrongPin(`patient:${patientId}`);
    res.status(nowLocked ? 429 : 401).json({ error: nowLocked ? lockoutMessage() : 'Incorrect PIN' });
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
