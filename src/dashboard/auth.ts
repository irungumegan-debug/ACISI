import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { LOGIN_RATE_LIMIT_MAX_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS, DASHBOARD_SESSION_TTL_SECONDS } from '../config/constants';
import { InvalidPhoneNumberError, toE164 } from '../utils/phone';
import { isRateLimited as isKeyRateLimited, recordAttempt, clearRateLimit as clearKeyRateLimit } from '../utils/rateLimit';
import { findActiveStaffWithClinicByPhone, verifyStaffPin } from '../services/staffService';
import {
  createDashboardSession,
  destroyDashboardSession,
  loadDashboardSession,
  DashboardSession,
  SESSION_COOKIE_NAME,
} from './session';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  dashboardSession: DashboardSession;
}

function rateLimitKey(phoneNumberE164: string): string {
  return `dashboard:login_attempts:${phoneNumberE164}`;
}

async function isRateLimited(phoneNumberE164: string): Promise<boolean> {
  return isKeyRateLimited(rateLimitKey(phoneNumberE164), LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
}

async function recordFailedAttempt(phoneNumberE164: string): Promise<void> {
  await recordAttempt(rateLimitKey(phoneNumberE164), LOGIN_RATE_LIMIT_WINDOW_SECONDS);
}

async function clearRateLimit(phoneNumberE164: string): Promise<void> {
  await clearKeyRateLimit(rateLimitKey(phoneNumberE164));
}

const loginSchema = z.object({
  phoneNumber: z.string().min(1),
  pin: z.string().min(1),
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Phone number and PIN are required' });
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

  if (await isRateLimited(phoneE164)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    return;
  }

  const staff = await findActiveStaffWithClinicByPhone(phoneE164);
  const isValid = staff ? await verifyStaffPin(staff, parsed.data.pin) : false;

  if (!staff || !isValid) {
    await recordFailedAttempt(phoneE164);
    res.status(401).json({ error: 'Invalid phone number or PIN' });
    return;
  }

  await clearRateLimit(phoneE164);

  const token = await createDashboardSession({
    staffId: staff.id,
    staffName: staff.name,
    clinicId: staff.clinicId,
    clinicName: staff.clinic.name,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DASHBOARD_SESSION_TTL_SECONDS * 1000,
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
