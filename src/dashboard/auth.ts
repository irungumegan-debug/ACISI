import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { redis } from '../config/redis';
import { OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS, OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS } from '../config/constants';
import { clearLockout, isLockedOut, lockoutMessage, LockoutSubject, recordWrongPin } from '../services/pinLockout';
import {
  findActiveStaffWithClinicByCode,
  InvalidPinFormatError,
  resetStaffPinBySelf,
  verifyStaffPin,
} from '../services/staffService';
import { requestStaffPinResetOtp, verifyStaffPinResetOtp } from '../services/otpService';
import { pinPolicyError } from '../utils/pinPolicy';
import {
  createDashboardSession,
  dashboardSessionTtlSeconds,
  destroyDashboardSession,
  loadDashboardSession,
  DashboardSession,
  SESSION_COOKIE_NAME,
} from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  dashboardSession: DashboardSession;
}


const loginSchema = z.object({
  staffCode: z.string().min(1),
  pin: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Staff ID and PIN are required' });
    return;
  }

  const staffCode = parsed.data.staffCode.trim().toUpperCase();
  const staff = await findActiveStaffWithClinicByCode(staffCode);
  // Counted per account (one staff ID is one account), so a lockout holds
  // however the request is made.
  const subject: LockoutSubject = staff ? `staff:${staff.id}` : `unknown:staff:${staffCode}`;

  if (await isLockedOut(subject)) {
    res.status(429).json({ error: lockoutMessage() });
    return;
  }

  const isValid = staff ? await verifyStaffPin(staff, parsed.data.pin) : false;

  if (!staff || !isValid) {
    const nowLocked = await recordWrongPin(subject);
    res.status(nowLocked ? 429 : 401).json({ error: nowLocked ? lockoutMessage() : 'Invalid staff ID or PIN' });
    return;
  }

  await clearLockout(subject);

  const token = await createDashboardSession({
    staffId: staff.id,
    staffCode: staff.staffCode,
    staffName: staff.name,
    role: staff.role,
    clinicId: staff.clinicId,
    clinicName: staff.clinic.name,
    departmentId: staff.departmentId,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    // req.secure (not env.NODE_ENV, which Railway never sets to
    // 'production') reflects whether this request actually arrived over
    // HTTPS, via the trust proxy setting in app.ts honoring
    // X-Forwarded-Proto from the platform's TLS-terminating edge proxy.
    secure: req.secure,
    sameSite: 'lax',
    maxAge: dashboardSessionTtlSeconds(staff.role) * 1000,
  });

  res.json({ staffName: staff.name, clinicName: staff.clinic.name, role: staff.role });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await destroyDashboardSession(token);
  }
  res.clearCookie(SESSION_COOKIE_NAME);
  res.status(204).send();
});

authRouter.get('/me', requireStaffSession, (req, res) => {
  res.json((req as AuthenticatedRequest).dashboardSession);
});

function otpRequestRateLimitKey(staffCode: string): string {
  return `dashboard:otp_requests:${staffCode}`;
}

const forgotPinSchema = z.object({ staffCode: z.string().min(1) });

/**
 * Self-service "forgot PIN" for staff and doctors: texts a one-time code to
 * the phone number on their account. Always returns the same generic
 * response whether or not the staff ID exists, so it can't be used to
 * discover valid staff IDs. Rate-limited per staff ID so it can't be used
 * to flood someone's phone with SMS.
 */
authRouter.post('/forgot-pin', async (req, res) => {
  const parsed = forgotPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Staff ID is required' });
    return;
  }

  const staffCode = parsed.data.staffCode.trim().toUpperCase();
  const k = otpRequestRateLimitKey(staffCode);
  if (Number((await redis.get(k)) ?? 0) >= OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    return;
  }
  const count = await redis.incr(k);
  if (count === 1) {
    await redis.expire(k, OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS);
  }

  // Deactivated staff (or staff at a deactivated clinic) can't log in, so
  // there's no point letting them reset a PIN either.
  const staff = await findActiveStaffWithClinicByCode(staffCode);
  if (staff) {
    try {
      await requestStaffPinResetOtp(staff);
    } catch (err) {
      logger.error({ err }, 'Failed to send staff PIN reset OTP');
    }
  }

  res.json({ message: 'If that staff ID exists, we sent a one-time code by SMS to the phone number on the account.' });
});

const resetPinSchema = z.object({
  staffCode: z.string().min(1),
  code: z.string().min(1),
  newPin: z.string().min(1),
});

/**
 * Completes the self-service reset. On success the staff member is also
 * unlocked (their failed-login counter is cleared, so a lockout from
 * guessing doesn't outlast the reset) and logged out of every existing
 * session, since the old PIN may be what someone else was using.
 */
authRouter.post('/reset-pin', async (req, res) => {
  const parsed = resetPinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid code and new PIN are required' });
    return;
  }

  const staffCode = parsed.data.staffCode.trim().toUpperCase();
  const staff = await findActiveStaffWithClinicByCode(staffCode);
  if (!staff) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  // Checked before the code, so a rejected PIN doesn't use up the one-time
  // code — they can fix the PIN and resubmit.
  const pinError = pinPolicyError(parsed.data.newPin, { phoneNumber: staff.phoneNumber });
  if (pinError) {
    res.status(400).json({ error: pinError });
    return;
  }

  if (!(await verifyStaffPinResetOtp(staff.id, parsed.data.code.trim()))) {
    res.status(400).json({ error: 'Invalid or expired code' });
    return;
  }

  try {
    await resetStaffPinBySelf(staff.id, parsed.data.newPin);
  } catch (err) {
    if (err instanceof InvalidPinFormatError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  // resetStaffPinBySelf has lifted any lockout and logged out every session.
  res.json({ message: 'PIN updated. You can now log in with your new PIN.' });
});

export async function requireStaffSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const session = await loadDashboardSession(token);
    if (!session) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }
    (req as AuthenticatedRequest).dashboardSession = session;
    next();
  } catch (err) {
    logger.error({ err }, 'Failed to validate dashboard session');
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const { role } = (req as AuthenticatedRequest).dashboardSession;
  if (role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
